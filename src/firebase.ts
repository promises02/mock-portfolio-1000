import { initializeApp } from 'firebase/app';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  getFirestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { ALL_PRESETS, FOREIGN_PRESETS, getPresetByName } from './presets';
import { AssetType, AssetMarket, CustomAsset, DisplayCurrency, Portfolio, ValidationResult, BuyRequest, AssetItem, Transaction, TransactionStats, TransactionPeriodFilter, TransactionListFilters, TransactionMonthlyStat, TransactionDetailRow, BuyAssetError, SellAssetError, SellAssetRequest, SellAssetResult, RealtimePriceQuote, RealtimePriceSnapshot, MarketPriceMap, AdminPriceUpdateReason, AdminExchangeRateUpdateReason, AdminPriceUpdateResult, PurchaseRecord } from './types';
import { DEFAULT_EXCHANGE_RATE, computeKrwEquivalent, getDefaultDisplayCurrency, inferAssetMarketRegion, enrichAssetCurrencyFields, inferAssetMarket, inferAssetSector, formatCommas } from './utils';
import {
  derivePortfolioCash,
  getPurchaseUnitKrw,
  getPurchasePriceUsd,
  resolvePurchaseExchangeRate,
  calculateUnrealizedProfit,
  PORTFOLIO_STARTING_CAPITAL,
  buildUsAssetOnFirstBuy,
  mergeUsAssetOnBuy,
  buildCatalogPriceMap,
  isUsMarketAsset,
  normalizeUsAssetPurchaseBasis,
  portfolioCashNeedsRepair,
  getTotalPurchaseAmountKrw,
  type CatalogPriceMap,
} from './utils/portfolioPnL';
export type { CatalogPriceMap } from './utils/portfolioPnL';

async function getGeminiClient() {
  const apiKey = import.meta.env.VITE_GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey });
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId); /* CRITICAL: The app will break without this line */

export interface UnifiedAsset {
  name: string;
  type: AssetType;
  price: number;
  priceUSD?: number;
  priceKRW?: number;
  priceCrypto?: string;
  ticker?: string;
  sector?: string;
  market?: string;
  marketRegion?: AssetMarket;
  displayCurrency?: DisplayCurrency;
  sourceUrl?: string;
  isCustom?: boolean;
}

// Error logging specifications for AI Studio
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  nickname?: string | null;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  nickname?: string | null
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    nickname: nickname ?? null,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function sanitizeDocId(value: string): string {
  return value.replace(/\s+/g, '_').replace(/[/\\.#$[\]]/g, '_');
}

function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }

  const input = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(input)) {
    if (nested !== undefined) {
      result[key] = stripUndefinedDeep(nested);
    }
  }
  return result as T;
}

function parseGeminiJson(text: string): Record<string, unknown> {
  let cleanText = text.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```(?:json)?\n?/, '');
    cleanText = cleanText.replace(/\n?```$/, '');
    cleanText = cleanText.trim();
  }
  return JSON.parse(cleanText) as Record<string, unknown>;
}

export async function validateAsset(
  assetName: string,
  market: string,
  priceInput: string
): Promise<ValidationResult> {
  const trimmedName = assetName.trim();

  const failResult = (apiError = true): ValidationResult => ({
    isValid: false,
    assetName: trimmedName,
    confidence: 0,
    message: '검증 실패. 계속 진행하시겠어요?',
    apiError,
  });

  const ai = await getGeminiClient();
  if (!ai) {
    return failResult(true);
  }

  const prompt = `${trimmedName}은(는) ${market} 자산인가? 실제로 존재하나? 티커 심볼과 업종을 추정해줘.
입력된 가격: ${priceInput}

다음 JSON 형식으로만 응답하세요 (마크다운 코드블록이나 추가 설명 없이 JSON만):
{
  "isValid": true,
  "ticker": "MU",
  "sector": "반도체",
  "market": "미국 주식",
  "confidence": 95,
  "message": "마이크론은 실제 NASDAQ 상장 기업입니다. Ticker: MU, 업종: 반도체"
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });

    const responseText = response.text?.trim();
    if (!responseText) {
      return failResult(true);
    }

    const parsed = parseGeminiJson(responseText);
    const isValid = Boolean(parsed.isValid);
    const confidence = Math.min(100, Math.max(0, Number(parsed.confidence) || 0));
    const ticker = typeof parsed.ticker === 'string' && parsed.ticker !== 'null'
      ? parsed.ticker.trim()
      : undefined;
    const sector = typeof parsed.sector === 'string' && parsed.sector !== 'null'
      ? parsed.sector.trim()
      : undefined;
    const confirmedMarket = typeof parsed.market === 'string' ? parsed.market.trim() : market;
    const message = typeof parsed.message === 'string' && parsed.message.trim()
      ? parsed.message.trim()
      : isValid
        ? `${trimmedName}은(는) 유효한 ${market} 자산으로 확인되었습니다.`
        : '입력하신 정보를 확인해주세요.';

    return {
      isValid,
      assetName: trimmedName,
      ticker,
      sector,
      market: confirmedMarket,
      confidence,
      message,
    };
  } catch (error) {
    console.error('Asset validation failed:', error);
    return failResult(true);
  }
}

export async function addCustomAsset(
  nickname: string,
  assetName: string,
  type: CustomAsset['type'],
  inputPrice: number | string,
  displayCurrency: DisplayCurrency,
  ticker?: string,
  sector?: string,
  market?: string,
  sourceUrl?: string,
  marketRegion?: AssetMarket,
  isVerified?: boolean,
  verificationStatus?: string
): Promise<CustomAsset> {
  const trimmedName = assetName.trim();
  const timestamp = Date.now();
  const id = sanitizeDocId(`${trimmedName}_${nickname}_${timestamp}`);
  const resolvedMarketRegion =
    marketRegion ?? inferAssetMarketRegion(trimmedName, type);

  const numericPrice =
    typeof inputPrice === 'string' ? parseFloat(inputPrice) : inputPrice;

  let priceUSD: number | undefined;
  let priceKRW: number | undefined;
  let priceCrypto: string | undefined;
  let purchasePriceUSD: number | undefined;
  let purchasePriceKRW: number | undefined;
  let purchasePriceCrypto: string | undefined;

  if (displayCurrency === 'USD') {
    priceUSD = numericPrice;
    purchasePriceUSD = numericPrice;
  } else if (displayCurrency === 'KRW') {
    priceKRW = Math.round(numericPrice);
    purchasePriceKRW = Math.round(numericPrice);
  } else {
    priceCrypto = String(inputPrice).trim();
    purchasePriceCrypto = String(inputPrice).trim();
  }

  const price = computeKrwEquivalent(displayCurrency, numericPrice, await getGlobalExchangeRate());

  const asset: CustomAsset = {
    id,
    name: trimmedName,
    type,
    price,
    quantity: 1,
    addedBy: nickname,
    addedAt: new Date(),
    marketRegion: resolvedMarketRegion,
    displayCurrency,
    ...(priceUSD != null ? { priceUSD } : {}),
    ...(priceKRW != null ? { priceKRW } : {}),
    ...(priceCrypto != null ? { priceCrypto } : {}),
    ...(purchasePriceUSD != null ? { purchasePriceUSD } : {}),
    ...(purchasePriceKRW != null ? { purchasePriceKRW } : {}),
    ...(purchasePriceCrypto != null ? { purchasePriceCrypto } : {}),
    ...(ticker?.trim() ? { ticker: ticker.trim() } : {}),
    ...(sector?.trim() ? { sector: sector.trim() } : {}),
    ...(market?.trim() ? { market: market.trim() } : {}),
    ...(sourceUrl?.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
    ...(isVerified != null ? { isVerified } : {}),
    ...(verificationStatus?.trim() ? { verificationStatus: verificationStatus.trim() } : {}),
  };

  await setDoc(doc(db, 'customAssets', id), asset);
  return asset;
}

function sanitizeNumeric(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(num) ? num : undefined;
}

function isSpaceXAsset(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.includes('스페이스') || normalized.includes('spacex') || normalized.includes('space x');
}

function isForeignPresetName(name: string): boolean {
  const key = name.trim().toLowerCase();
  return FOREIGN_PRESETS.some((preset) => preset.name.trim().toLowerCase() === key);
}

function applyForeignPresetMarketFields(asset: CustomAsset): void {
  if (!isForeignPresetName(asset.name)) return;

  const preset = getPresetByName(asset.name);
  asset.marketRegion = 'US';
  asset.displayCurrency = 'USD';
  asset.market = '미국 주식';

  let priceUSD = sanitizeNumeric(asset.priceUSD);
  if ((!priceUSD || priceUSD <= 0) && preset?.usdPrice != null && preset.usdPrice > 0) {
    priceUSD = preset.usdPrice;
    asset.priceUSD = priceUSD;
  }
  if (priceUSD && priceUSD > 0) {
    asset.price = Math.round(priceUSD * DEFAULT_EXCHANGE_RATE);
    delete asset.priceKRW;
  }
}

/** logicalName: assetCardDebugAndCompact — Firestore customAssets NaN/잘못된 가격 보정 */
export function normalizeCustomAsset(data: CustomAsset, docId: string): CustomAsset {
  const asset: CustomAsset = { ...data, id: docId };
  let priceUSD = sanitizeNumeric(asset.priceUSD);
  let priceKRW = sanitizeNumeric(asset.priceKRW);
  let price = sanitizeNumeric(asset.price);

  if (isSpaceXAsset(asset.name)) {
    asset.displayCurrency = asset.displayCurrency ?? 'USD';
    asset.marketRegion = asset.marketRegion ?? 'US';
    asset.market = asset.market ?? '미국 주식';
    priceUSD = priceUSD && priceUSD > 0 ? priceUSD : 106.95;
    asset.priceUSD = priceUSD;
    price = Math.round(priceUSD * DEFAULT_EXCHANGE_RATE);
    if (priceKRW === 160) {
      delete asset.priceKRW;
    }
  } else {
    applyForeignPresetMarketFields(asset);
    priceUSD = sanitizeNumeric(asset.priceUSD);
    priceKRW = sanitizeNumeric(asset.priceKRW);
  }

  if (asset.displayCurrency === 'USD' && priceUSD && priceUSD > 0) {
    price = Math.round(priceUSD * DEFAULT_EXCHANGE_RATE);
  } else if (priceKRW && priceKRW > 0) {
    price = Math.round(priceKRW);
  }

  if (!price || price <= 0 || Number.isNaN(price)) {
    price =
      priceKRW && priceKRW > 0
        ? priceKRW
        : priceUSD && priceUSD > 0
          ? Math.round(priceUSD * DEFAULT_EXCHANGE_RATE)
          : 0;
  }

  asset.price = Math.round(price);
  if (priceUSD != null) asset.priceUSD = priceUSD;
  if (priceKRW != null) asset.priceKRW = priceKRW;

  return asset;
}

function mapBuyError(error: unknown, context: string): never {
  console.error(`[buyAsset] ${context}:`, error);

  if (error instanceof BuyAssetError) {
    throw error;
  }

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('permission') || message.includes('PERMISSION_DENIED')) {
    throw new BuyAssetError('다시 시도해주세요. (저장 권한 오류)');
  }
  if (message.includes('offline') || message.includes('unavailable')) {
    throw new BuyAssetError('다시 시도해주세요. (네트워크 연결 오류)');
  }
  if (message.includes('undefined') || message.includes('Unsupported field value')) {
    throw new BuyAssetError('다시 시도해주세요. (데이터 저장 오류)');
  }

  throw new BuyAssetError('다시 시도해주세요.');
}

/** logicalName: tickerSearchSupport */
function matchesAssetSearch(
  name: string,
  ticker: string | undefined,
  searchQueryUpper: string
): boolean {
  if (!searchQueryUpper) return false;
  const nameUpper = name.toUpperCase();
  const tickerUpper = ticker?.toUpperCase() ?? '';
  return nameUpper.includes(searchQueryUpper) || tickerUpper.includes(searchQueryUpper);
}

export async function searchAssets(searchQuery: string): Promise<UnifiedAsset[]> {
  const queryUpper = searchQuery.trim().toUpperCase();
  if (!queryUpper) return [];

  const customSnap = await getDocs(collection(db, 'customAssets'));
  const customResults: (UnifiedAsset & { addedAtMs: number })[] = [];

  customSnap.forEach((docSnap) => {
    const raw = docSnap.data() as CustomAsset;
    const data = normalizeCustomAsset(raw, docSnap.id);
    if (!matchesAssetSearch(data.name ?? '', data.ticker, queryUpper)) return;

    const addedAtMs =
      data.addedAt instanceof Date
        ? data.addedAt.getTime()
        : typeof data.addedAt?.toDate === 'function'
          ? data.addedAt.toDate().getTime()
          : typeof data.addedAt === 'number'
            ? data.addedAt
            : 0;

    customResults.push({
      name: data.name,
      type: data.type as AssetType,
      price: data.price,
      priceUSD: data.priceUSD,
      priceKRW: data.priceKRW,
      priceCrypto: data.priceCrypto,
      ticker: data.ticker,
      sector: data.sector,
      market: data.market,
      marketRegion: data.marketRegion ?? inferAssetMarketRegion(data.name, data.type),
      displayCurrency:
        data.displayCurrency ??
        getDefaultDisplayCurrency(
          data.marketRegion ?? inferAssetMarketRegion(data.name, data.type)
        ),
      sourceUrl: data.sourceUrl,
      isCustom: true,
      addedAtMs,
    });
  });

  customResults.sort((a, b) => b.addedAtMs - a.addedAtMs);

  const presetResults: UnifiedAsset[] = ALL_PRESETS.filter((preset) =>
    matchesAssetSearch(
      preset.name,
      'ticker' in preset ? (preset as { ticker?: string }).ticker : undefined,
      queryUpper
    )
  ).map((preset) => {
    const marketRegion = inferAssetMarketRegion(preset.name, preset.type);
    const presetTicker = 'ticker' in preset ? (preset as { ticker?: string }).ticker : undefined;
    return {
      name: preset.name,
      type: preset.type,
      price: preset.price,
      ...(presetTicker ? { ticker: presetTicker } : {}),
      marketRegion,
      displayCurrency: getDefaultDisplayCurrency(marketRegion),
      isCustom: false,
    };
  });

  const seen = new Set<string>();
  const merged: UnifiedAsset[] = [];

  for (const asset of customResults) {
    const key = asset.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const { addedAtMs: _, ...rest } = asset;
    merged.push(rest);
  }

  for (const asset of presetResults) {
    const key = asset.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(asset);
  }

  return merged.slice(0, 8);
}

function validateCustomAssetUpdates(updates: Partial<CustomAsset>): void {
  if (updates.quantity != null && updates.quantity <= 0) {
    throw new Error('수량은 0보다 커야 합니다.');
  }
  if (updates.priceUSD != null && updates.priceUSD <= 0) {
    throw new Error('현재가(USD)는 0보다 커야 합니다.');
  }
  if (updates.priceKRW != null && updates.priceKRW <= 0) {
    throw new Error('현재가(KRW)는 0보다 커야 합니다.');
  }
  if (updates.priceCrypto != null && parseFloat(updates.priceCrypto) <= 0) {
    throw new Error('현재가(CRYPTO)는 0보다 커야 합니다.');
  }
  if (updates.purchasePriceUSD != null && updates.purchasePriceUSD <= 0) {
    throw new Error('매수가(USD)는 0보다 커야 합니다.');
  }
  if (updates.purchasePriceKRW != null && updates.purchasePriceKRW <= 0) {
    throw new Error('매수가(KRW)는 0보다 커야 합니다.');
  }
  if (updates.purchasePriceCrypto != null && parseFloat(updates.purchasePriceCrypto) <= 0) {
    throw new Error('매수가(CRYPTO)는 0보다 커야 합니다.');
  }
  if (updates.price != null && updates.price <= 0) {
    throw new Error('가격은 0보다 커야 합니다.');
  }
}

async function assertCustomAssetOwner(nickname: string, assetId: string): Promise<CustomAsset> {
  const docRef = doc(db, 'customAssets', assetId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) {
    throw new Error('자산을 찾을 수 없습니다.');
  }
  const asset = snap.data() as CustomAsset;
  if (asset.addedBy !== nickname) {
    throw new Error('이 자산을 수정할 권한이 없습니다.');
  }
  return { ...asset, id: assetId };
}

function getCustomAssetAddedAtMs(addedAt: CustomAsset['addedAt']): number {
  if (addedAt instanceof Date) return addedAt.getTime();
  if (typeof addedAt?.toDate === 'function') return addedAt.toDate().getTime();
  if (typeof addedAt === 'number') return addedAt;
  return 0;
}

function sortCustomAssetsByAddedAt(results: CustomAsset[]): CustomAsset[] {
  return results.sort(
    (a, b) => getCustomAssetAddedAtMs(b.addedAt) - getCustomAssetAddedAtMs(a.addedAt)
  );
}

/** logicalName: communityCustomAssetMarket — 시장에 등록된 전체 참여자 추가 자산 */
export async function getAllCommunityCustomAssets(): Promise<CustomAsset[]> {
  const snap = await getDocs(collection(db, 'customAssets'));
  const results: CustomAsset[] = [];

  snap.forEach((docSnap) => {
    const raw = docSnap.data() as CustomAsset;
    const data = normalizeCustomAsset(raw, docSnap.id);
    results.push(data);
  });

  return sortCustomAssetsByAddedAt(results);
}

/** logicalName: communityCustomAssetMarket — customAssets 실시간 구독 */
export function subscribeCommunityCustomAssets(
  onUpdate: (assets: CustomAsset[]) => void,
  onError?: (error: Error) => void
): () => void {
  let collectionAssets: CustomAsset[] = [];
  let sharedAssets: CustomAsset[] = [];

  const emit = () => {
    onUpdate(mergeCustomAssetLists(collectionAssets, sharedAssets));
  };

  const unsubCollection = onSnapshot(
    collection(db, 'customAssets'),
    (snapshot) => {
      collectionAssets = [];
      snapshot.forEach((docSnap) => {
        collectionAssets.push(normalizeCustomAsset(docSnap.data() as CustomAsset, docSnap.id));
      });
      emit();
    },
    (error) => {
      console.warn('[subscribeCommunityCustomAssets] collection listener error:', error);
      onError?.(error);
    }
  );

  const unsubShared = onSnapshot(
    sharedConfigRef(),
    (snapshot) => {
      const raw = snapshot.data()?.customAssets;
      sharedAssets = Array.isArray(raw)
        ? raw.map((item, index) =>
            normalizeCustomAsset(item as CustomAsset, (item as CustomAsset).id ?? `shared_${index}`)
          )
        : [];
      emit();
    },
    (error) => {
      console.warn('[subscribeCommunityCustomAssets] shared config listener error:', error);
    }
  );

  return () => {
    unsubCollection();
    unsubShared();
  };
}

const PRESET_ASSET_ID_PREFIX = '__preset__';

function presetToAdminAsset(
  preset: (typeof ALL_PRESETS)[number],
  marketPrices: MarketPriceMap
): CustomAsset {
  const marketRegion = inferAssetMarketRegion(preset.name, preset.type);
  const displayCurrency = getDefaultDisplayCurrency(marketRegion);
  const presetTicker = 'ticker' in preset ? (preset as { ticker?: string }).ticker : undefined;
  const priceOverride = marketPrices[preset.name.trim()];

  let price = preset.price;
  let priceUSD = preset.usdPrice;
  let priceKRW = displayCurrency === 'KRW' ? preset.price : undefined;

  if (priceOverride !== undefined) {
    price = priceOverride;
    if (displayCurrency === 'KRW') {
      priceKRW = priceOverride;
    }
  }

  return {
    id: `${PRESET_ASSET_ID_PREFIX}${sanitizeDocId(preset.name)}`,
    name: preset.name,
    type: preset.type as CustomAsset['type'],
    price,
    priceUSD,
    priceKRW,
    ticker: presetTicker,
    marketRegion,
    displayCurrency,
    market:
      marketRegion === 'Korea'
        ? '국내 주식'
        : marketRegion === 'US'
          ? '미국 주식'
          : '암호화폐',
    addedBy: 'system',
    addedAt: new Date(0),
  };
}

function applyMarketPriceOverride(asset: CustomAsset, marketPrices: MarketPriceMap): CustomAsset {
  const override = marketPrices[asset.name.trim()];
  if (override === undefined) return asset;

  const displayCurrency =
    asset.displayCurrency ?? getDefaultDisplayCurrency(asset.marketRegion ?? 'Korea');

  if (displayCurrency === 'KRW') {
    return { ...asset, price: override, priceKRW: override };
  }

  return { ...asset, price: override };
}

/** logicalName: newAdminModeAssetPriceEditor — 프리셋 + customAssets 전체 목록 */
export function buildAdminAssetList(
  customAssets: CustomAsset[],
  marketPrices: MarketPriceMap = {}
): CustomAsset[] {
  const byName = new Map<string, CustomAsset>();

  for (const asset of customAssets) {
    byName.set(
      asset.name.trim().toLowerCase(),
      applyMarketPriceOverride(asset, marketPrices)
    );
  }

  for (const preset of ALL_PRESETS) {
    const key = preset.name.trim().toLowerCase();
    if (byName.has(key)) continue;
    byName.set(key, presetToAdminAsset(preset, marketPrices));
  }

  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'ko')
  );
}

export async function getAllAdminAssets(
  marketPrices: MarketPriceMap = {}
): Promise<CustomAsset[]> {
  const customAssets = await getAllCommunityCustomAssets();
  return buildAdminAssetList(customAssets, marketPrices);
}

/** logicalName: assetEditDeleteFeature */
export async function getUserCustomAssets(nickname: string): Promise<CustomAsset[]> {
  const q = query(collection(db, 'customAssets'), where('addedBy', '==', nickname));
  const snap = await getDocs(q);
  const results: CustomAsset[] = [];

  snap.forEach((docSnap) => {
    const raw = docSnap.data() as CustomAsset;
    const data = normalizeCustomAsset(raw, docSnap.id);
    if (data.hiddenByOwner) return;
    results.push(data);
  });

  return sortCustomAssetsByAddedAt(results);
}

export async function editAsset(
  nickname: string,
  assetId: string,
  updates: Partial<CustomAsset>
): Promise<void> {
  validateCustomAssetUpdates(updates);
  const existing = await assertCustomAssetOwner(nickname, assetId);

  const displayCurrency =
    updates.displayCurrency ?? existing.displayCurrency ?? getDefaultDisplayCurrency(existing.marketRegion ?? 'Korea');

  let price = updates.price ?? existing.price;
  if (displayCurrency === 'USD' && updates.priceUSD != null) {
    price = computeKrwEquivalent('USD', updates.priceUSD, DEFAULT_EXCHANGE_RATE);
  } else if (displayCurrency === 'KRW' && updates.priceKRW != null) {
    price = updates.priceKRW;
  } else if (displayCurrency === 'CRYPTO' && updates.priceCrypto != null) {
    price = computeKrwEquivalent('CRYPTO', parseFloat(updates.priceCrypto), DEFAULT_EXCHANGE_RATE);
  }

  const { id: _id, ...restUpdates } = updates;
  const payload: Partial<CustomAsset> = {
    ...restUpdates,
    price,
  };

  try {
    await setDoc(doc(db, 'customAssets', assetId), payload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `customAssets/${assetId}`, nickname);
  }
}

export async function deleteAsset(nickname: string, assetId: string): Promise<void> {
  await assertCustomAssetOwner(nickname, assetId);
  try {
    await setDoc(
      doc(db, 'customAssets', assetId),
      { hiddenByOwner: true },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `customAssets/${assetId}`, nickname);
  }
}

function createBuyPurchaseRecord(options: {
  assetId: string;
  quantity: number;
  pricePerUnit: number;
  amountInKrw: number;
  isUsBuy: boolean;
  exchangeRate: number;
}): PurchaseRecord {
  const { assetId, quantity, pricePerUnit, amountInKrw, isUsBuy, exchangeRate } = options;
  return {
    id: `${Date.now()}_buy_${sanitizeDocId(assetId)}`,
    type: 'BUY',
    quantity,
    price: pricePerUnit,
    amount: isUsBuy ? pricePerUnit : amountInKrw,
    exchangeRateAtTransaction: isUsBuy ? exchangeRate : undefined,
    amountInKRW: amountInKrw,
    timestamp: new Date(),
    date: new Date().toISOString().slice(0, 10),
  };
}

/** logicalName: buyAssetAveragePriceFixUSD */
function resolveUsBuyAmounts(
  pricePerUnit: number,
  quantity: number,
  totalAmount: number,
  displayCurrency: 'USD' | 'KRW',
  exchangeRate: number,
  isUsBuy: boolean
): { priceUsd: number; priceKrw: number; amountInKrw: number } {
  if (!isUsBuy) {
    const priceKrw = Math.round(pricePerUnit);
    const amountInKrw = Math.round(totalAmount);
    return { priceUsd: 0, priceKrw, amountInKrw };
  }

  const priceUsd =
    displayCurrency === 'USD' ? pricePerUnit : exchangeRate > 0 ? pricePerUnit / exchangeRate : 0;
  const priceKrw = Math.round(priceUsd * exchangeRate);
  const amountInKrw = Math.round(priceUsd * exchangeRate * quantity);

  const expectedKrw =
    displayCurrency === 'USD'
      ? Math.round(pricePerUnit * exchangeRate * quantity)
      : Math.round(totalAmount);

  if (Math.abs(expectedKrw - totalAmount) > quantity && displayCurrency === 'USD') {
    console.warn('[buyAsset] totalAmount KRW mismatch, using computed value', {
      totalAmount,
      expectedKrw,
      amountInKrw,
    });
  }

  return {
    priceUsd,
    priceKrw,
    amountInKrw: displayCurrency === 'USD' ? amountInKrw : Math.round(totalAmount),
  };
}

/** logicalName: tradingSystemPhase5 | assetCardDebugAndCompact | buyAssetAveragePriceFixUSD */
export async function buyAsset(nickname: string, request: BuyRequest): Promise<void> {
  const trimmedNickname = nickname?.trim();
  const { assetId, assetName, quantity, pricePerUnit, totalAmount, displayCurrency, ticker } = request;

  console.info('[buyAsset] start', {
    nickname: trimmedNickname,
    assetId,
    assetName,
    quantity,
    pricePerUnit,
    totalAmount,
    displayCurrency,
  });

  if (!trimmedNickname) {
    console.error('[buyAsset] invalid nickname:', nickname);
    throw new BuyAssetError('다시 시도해주세요.');
  }
  if (!assetId?.trim()) {
    console.error('[buyAsset] missing assetId');
    throw new BuyAssetError('자산을 찾을 수 없습니다.');
  }
  if (!assetName?.trim()) {
    console.error('[buyAsset] missing assetName');
    throw new BuyAssetError('자산을 찾을 수 없습니다.');
  }
  if (!Number.isFinite(quantity) || Number.isNaN(quantity) || quantity <= 0) {
    console.error('[buyAsset] invalid quantity:', quantity);
    throw new BuyAssetError('수량은 0보다 커야 합니다.');
  }
  if (!Number.isFinite(pricePerUnit) || Number.isNaN(pricePerUnit) || pricePerUnit <= 0) {
    console.error('[buyAsset] invalid pricePerUnit:', pricePerUnit);
    throw new BuyAssetError('다시 시도해주세요. (가격 오류)');
  }
  if (!Number.isFinite(totalAmount) || Number.isNaN(totalAmount) || totalAmount <= 0) {
    console.error('[buyAsset] invalid totalAmount:', totalAmount);
    throw new BuyAssetError('다시 시도해주세요. (금액 계산 오류)');
  }

  const docRef = doc(db, 'portfolios', trimmedNickname);
  let snap;
  try {
    snap = await getDoc(docRef);
  } catch (error) {
    mapBuyError(error, 'portfolio read failed');
  }

  const rate = await getGlobalExchangeRate();
  const portfolio: Portfolio = snap!.exists()
    ? ({ nickname: trimmedNickname, ...snap!.data() } as Portfolio)
    : createPortfolio(trimmedNickname, rate);

  const cumulativeProfit = portfolio.cumulativeRealizedProfit ?? 0;
  const currentAssets = portfolio.assets ?? [];
  const previousSavings = derivePortfolioCash(
    currentAssets,
    cumulativeProfit,
    portfolio.savings,
    rate
  );

  const trimmedName = assetName.trim();
  const preset = getPresetByName(trimmedName.toLowerCase());
  const inferredType = preset?.type ?? 'stock';
  const inferredRegion = inferAssetMarketRegion(trimmedName, inferredType);
  const isUsBuy = displayCurrency === 'USD' || inferredRegion === 'US';
  const { priceUsd, priceKrw, amountInKrw } = resolveUsBuyAmounts(
    pricePerUnit,
    quantity,
    totalAmount,
    displayCurrency,
    rate,
    isUsBuy
  );

  if (!isUsBuy) {
    const expectedTotal = Math.round(pricePerUnit * quantity);
    if (Math.abs(expectedTotal - totalAmount) > 1) {
      console.warn('[buyAsset] totalAmount mismatch', { expectedTotal, totalAmount });
    }
  } else if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    console.error('[buyAsset] invalid priceUsd:', priceUsd);
    throw new BuyAssetError('다시 시도해주세요. (USD 가격 오류)');
  }

  console.info('[buyAsset] portfolio state', {
    previousSavings,
    amountInKrw,
    priceUsd: isUsBuy ? priceUsd : undefined,
    purchaseExchangeRate: isUsBuy ? rate : undefined,
    assetCount: currentAssets.length,
  });

  if (amountInKrw > previousSavings) {
    console.error('[buyAsset] insufficient cash', { amountInKrw, previousSavings });
    throw new BuyAssetError('현금이 부족합니다.');
  }

  if (!Number.isFinite(priceKrw) || priceKrw <= 0) {
    console.error('[buyAsset] invalid priceKrw conversion:', priceKrw);
    throw new BuyAssetError('다시 시도해주세요. (환율 변환 오류)');
  }

  const existingIndex = currentAssets.findIndex(
    (a) => a.name.trim().toLowerCase() === trimmedName.toLowerCase()
  );

  const buyRecord = createBuyPurchaseRecord({
    assetId: assetId.trim(),
    quantity,
    pricePerUnit: isUsBuy ? priceUsd : priceKrw,
    amountInKrw,
    isUsBuy,
    exchangeRate: rate,
  });

  let nextAssets: AssetItem[];
  if (existingIndex >= 0) {
    const existing = currentAssets[existingIndex];
    if (isUsBuy) {
      const merged = mergeUsAssetOnBuy(existing, quantity, priceKrw, priceUsd, rate);
      nextAssets = currentAssets.map((asset, index) =>
        index === existingIndex
          ? stripUndefinedDeep({
              ...asset,
              ...merged,
              displayCurrency: 'USD' as const,
              market: asset.market ?? 'US',
              purchaseHistory: [...(existing.purchaseHistory ?? []), buyRecord],
            })
          : stripUndefinedDeep(asset)
      );
    } else {
      const newQty = existing.quantity + quantity;
      const newAvgPrice = Math.round(
        (existing.price * existing.quantity + priceKrw * quantity) / newQty
      );
      const totalPurchaseAmount = Math.round(newAvgPrice * newQty);
      nextAssets = currentAssets.map((asset, index) =>
        index === existingIndex
          ? stripUndefinedDeep({
              ...asset,
              quantity: newQty,
              price: newAvgPrice,
              averagePurchasePrice: newAvgPrice,
              currentPrice: priceKrw,
              totalPurchaseAmount,
              priceKRW: pricePerUnit,
              displayCurrency: 'KRW' as const,
              purchaseHistory: [...(existing.purchaseHistory ?? []), buyRecord],
            })
          : stripUndefinedDeep(asset)
      );
    }
  } else if (isUsBuy) {
    const usFields = buildUsAssetOnFirstBuy(priceKrw, priceUsd, rate, quantity);
    nextAssets = [
      ...currentAssets.map((asset) => stripUndefinedDeep(asset)),
      stripUndefinedDeep({
        name: trimmedName,
        type: inferredType,
        quantity,
        market: 'US' as AssetMarket,
        displayCurrency: 'USD' as const,
        marketGroup: inferAssetMarket(trimmedName, inferredType),
        sector: inferAssetSector(trimmedName, inferredType),
        purchaseHistory: [buyRecord],
        ...usFields,
      }),
    ];
  } else {
    nextAssets = [
      ...currentAssets.map((asset) => stripUndefinedDeep(asset)),
      stripUndefinedDeep(
        enrichAssetCurrencyFields(
          {
            name: trimmedName,
            type: inferredType,
            price: priceKrw,
            quantity,
            averagePurchasePrice: priceKrw,
            currentPrice: priceKrw,
            totalPurchaseAmount: amountInKrw,
            market: inferredRegion,
            displayCurrency: 'KRW' as const,
            priceKRW: pricePerUnit,
            marketGroup: inferAssetMarket(trimmedName, inferredType),
            sector: inferAssetSector(trimmedName, inferredType),
            purchaseHistory: [buyRecord],
          },
          rate
        )
      ),
    ];
  }

  const newSavings = derivePortfolioCash(nextAssets, cumulativeProfit, undefined, rate);

  const sharedSnap = await getDoc(sharedConfigRef());
  const marketPrices = parseSharedMarketPrices(sharedSnap.data());
  const catalogPrices = buildCatalogPriceMap([], rate);
  const initialCapital = resolveInitialCapital(portfolio);
  const portfolioValues = updatePortfolioValues(
    nextAssets,
    newSavings,
    initialCapital,
    marketPrices,
    rate,
    catalogPrices
  );
  const hasRealPrices = portfolioValues.assets.some((a) => a.currentPrice !== a.price);

  const presetTicker = getPresetByName(trimmedName)?.ticker;
  const transaction: Transaction = stripUndefinedDeep({
    id: buyRecord.id,
    assetName: trimmedName,
    type: 'BUY',
    quantity,
    price: isUsBuy ? Math.round(priceUsd * 100) / 100 : priceKrw,
    totalAmount: amountInKrw,
    ...(ticker?.trim() ? { ticker: ticker.trim() } : presetTicker ? { ticker: presetTicker } : {}),
    ...(isUsBuy
      ? {
          priceUsd: Math.round(priceUsd * 100) / 100,
          exchangeRateAtPurchase: rate,
          amountInKRW: amountInKrw,
        }
      : {}),
    transactionDate: buyRecord.date,
    timestamp: new Date(),
  });

  const existingTransactions = (portfolio.transactions ?? []).map((item) =>
    stripUndefinedDeep({
      ...item,
      timestamp:
        item.timestamp instanceof Date
          ? item.timestamp
          : typeof item.timestamp?.toDate === 'function'
            ? item.timestamp.toDate()
            : item.timestamp,
    })
  );

  try {
    await setDoc(
      docRef,
      stripUndefinedDeep({
        nickname: trimmedNickname,
        assets: portfolioValues.assets,
        savings: newSavings,
        exchangeRate: rate,
        initialCapital,
        totalCurrentValue: portfolioValues.totalCurrentValue,
        profitAmount: portfolioValues.profitAmount,
        profitRate: portfolioValues.profitRate,
        totalAssets: portfolioValues.totalAssets,
        totalProfitAmount: portfolioValues.totalProfitAmount,
        totalProfitRate: portfolioValues.totalProfitRate,
        totalPurchaseAmount: portfolioValues.totalPurchaseAmount,
        unrealizedProfitAmount: portfolioValues.profitAmount,
        hasRealPrices: portfolio.hasRealPrices ?? hasRealPrices,
        transactions: [...existingTransactions, transaction],
        updatedAt: new Date(),
        totalBudget: PORTFOLIO_STARTING_CAPITAL + cumulativeProfit,
        cumulativeRealizedProfit: cumulativeProfit,
        ...(portfolio.reason != null ? { reason: portfolio.reason } : {}),
      }),
      { merge: true }
    );
    console.info('[buyAsset] portfolio updated', {
      nickname: trimmedNickname,
      newSavings,
      totalAssets: portfolioValues.totalAssets,
      totalProfitRate: portfolioValues.totalProfitRate,
    });
  } catch (error) {
    mapBuyError(error, 'portfolio write failed');
  }

  try {
    const customDocId = sanitizeDocId(assetId.trim());
    const customRef = doc(db, 'customAssets', customDocId);
    const customSnap = await getDoc(customRef);
    const inferredMarket = inferAssetMarket(trimmedName, inferredType);

    if (customSnap.exists()) {
      const existingCustom = normalizeCustomAsset(customSnap.data() as CustomAsset, customDocId);
      await setDoc(
        customRef,
        stripUndefinedDeep({
          name: trimmedName,
          price: priceKrw,
          ...(displayCurrency === 'KRW' ? { priceKRW: pricePerUnit } : {}),
          ...(displayCurrency === 'USD' ? { priceUSD: pricePerUnit } : {}),
          quantity: (existingCustom.quantity ?? 0) + quantity,
          ...(ticker ? { ticker } : {}),
        }),
        { merge: true }
      );
    } else {
      await setDoc(
        customRef,
        stripUndefinedDeep({
          id: customDocId,
          name: trimmedName,
          type: inferredType,
          price: priceKrw,
          ...(displayCurrency === 'KRW' ? { priceKRW: pricePerUnit } : {}),
          ...(displayCurrency === 'USD' ? { priceUSD: pricePerUnit } : {}),
          displayCurrency: displayCurrency === 'USD' ? 'USD' : 'KRW',
          marketRegion: inferredRegion,
          market: inferredMarket,
          addedBy: trimmedNickname,
          quantity,
          addedAt: new Date(),
          ...(ticker ? { ticker } : {}),
        } as CustomAsset)
      );
    }
    console.info('[buyAsset] customAsset updated', { assetId: customDocId });
  } catch (error) {
    console.error('[buyAsset] customAsset write failed (portfolio already saved):', error);
  }
}

function mapSellError(error: unknown, context: string): never {
  console.error(`[sellAsset] ${context}:`, error);
  if (error instanceof SellAssetError) throw error;
  if (error instanceof Error && error.message.includes('offline')) {
    throw new SellAssetError('네트워크 연결을 확인해 주세요.');
  }
  throw new SellAssetError('매도 처리 중 오류가 발생했습니다. 다시 시도해 주세요.');
}

/** logicalName: totalProfitRateCalculationFix — 초기 자본 (레거시 포트폴리오 fallback) */
export function resolveInitialCapital(portfolio?: Pick<Portfolio, 'initialCapital'> | null): number {
  return portfolio?.initialCapital != null && portfolio.initialCapital > 0
    ? portfolio.initialCapital
    : PORTFOLIO_STARTING_CAPITAL;
}

/** logicalName: phase8TransactionHistory — Firestore timestamp → Date */
export function normalizeTransactionTimestamp(tx: Pick<Transaction, 'timestamp' | 'transactionDate'>): Date {
  const ts = tx.timestamp;
  if (ts instanceof Date && !Number.isNaN(ts.getTime())) return ts;
  if (ts != null && typeof ts === 'object' && typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate();
  }
  if (tx.transactionDate) {
    const parsed = new Date(tx.transactionDate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

/** logicalName: phase8TransactionHistory — 거래 시각 (HH:MM:SS) */
export function formatTransactionTime(tx: Pick<Transaction, 'timestamp' | 'transactionDate'>): string {
  const d = normalizeTransactionTimestamp(tx);
  if (d.getTime() === 0) return '-';
  return d.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function resolveTransactionExchangeRate(tx: Transaction): number | undefined {
  const rate = tx.exchangeRateAtSale ?? tx.exchangeRateAtPurchase ?? tx.exchangeRateAtTransaction;
  return rate != null && rate > 0 ? rate : undefined;
}

function inferUsSellPriceUsd(tx: Transaction, rate: number): number {
  if (tx.priceUsd != null && tx.priceUsd > 0) return tx.priceUsd;
  const qty = tx.quantity || 1;
  const amountKrw = Math.round(tx.amountInKRW ?? tx.totalAmount ?? 0);
  const krwPerShare = amountKrw / qty;
  if (krwPerShare > 0 && Math.abs(tx.price - krwPerShare) < 2) {
    return tx.price / rate;
  }
  return tx.price;
}

/** logicalName: phase8TransactionHistory — 거래 상세 정보 행 생성 */
export function buildTransactionDetailRows(
  tx: Transaction,
  options?: { ticker?: string }
): TransactionDetailRow[] {
  const rate = resolveTransactionExchangeRate(tx);
  const isUs = rate != null;
  const amountKrw = Math.round(tx.amountInKRW ?? tx.totalAmount ?? 0);
  const qty = tx.quantity || 0;
  const rows: TransactionDetailRow[] = [];

  if (tx.type === 'BUY') {
    if (isUs) {
      const priceUsd = tx.priceUsd ?? tx.price;
      const krwPerShare =
        rate != null && rate > 0
          ? Math.round(priceUsd * rate)
          : qty > 0
            ? Math.round(amountKrw / qty)
            : 0;
      rows.push({
        label: '매수가',
        value: `${priceUsd.toFixed(2)} USD · ${formatCommas(krwPerShare)}원`,
      });
    } else {
      rows.push({ label: '매수가', value: `${formatCommas(Math.round(tx.price))}원` });
    }
    rows.push({ label: '수량', value: `${qty}주` });
    rows.push({ label: '총액', value: `${formatCommas(amountKrw)}원` });
  } else {
    if (isUs) {
      const sellUsd = inferUsSellPriceUsd(tx, rate);
      rows.push({ label: '매도가', value: `${sellUsd.toFixed(2)} USD` });
    } else {
      rows.push({ label: '매도가', value: `${formatCommas(Math.round(tx.price))}원` });
    }
    rows.push({ label: '수량', value: `${qty}주` });
    if (isUs && rate != null) {
      const sellUsd = inferUsSellPriceUsd(tx, rate);
      rows.push({
        label: '총액',
        value: `${formatCommas(amountKrw)}원 (${sellUsd.toFixed(2)} USD × ${formatCommas(rate)}원/USD)`,
      });
    } else {
      rows.push({ label: '총액', value: `${formatCommas(amountKrw)}원` });
    }
    if (tx.averagePriceAtSale != null) {
      rows.push({
        label: '평균 매입가',
        value: isUs
          ? `${tx.averagePriceAtSale.toFixed(2)} USD`
          : `${formatCommas(Math.round(tx.averagePriceAtSale))}원`,
      });
    }
    if (tx.realizedProfit != null) {
      const profit = tx.realizedProfit;
      rows.push({
        label: '손익액',
        value: `${profit >= 0 ? '+' : ''}${formatCommas(profit)}원 ${profit > 0 ? '▲' : profit < 0 ? '▼' : ''}`,
        valueClass: profit > 0 ? 'text-rose-655' : profit < 0 ? 'text-blue-655' : undefined,
      });
    }
    if (tx.profitRate != null) {
      const ratePct = tx.profitRate;
      rows.push({
        label: '수익률',
        value: `${ratePct >= 0 ? '+' : ''}${ratePct.toFixed(2)}% ${ratePct > 0 ? '▲' : ratePct < 0 ? '▼' : ''}`,
        valueClass: ratePct > 0 ? 'text-rose-655' : ratePct < 0 ? 'text-blue-655' : undefined,
      });
    }
    if (isUs && rate != null) {
      rows.push({ label: '평가환율', value: `${formatCommas(rate)}원/USD` });
    }
  }

  rows.push({ label: '시간', value: formatTransactionTime(tx) });

  return rows;
}

export function formatTransactionAssetLabel(tx: Transaction, ticker?: string): string {
  const resolved = ticker?.trim() || tx.ticker?.trim();
  return resolved ? `${tx.assetName} (${resolved})` : tx.assetName;
}

/** logicalName: phase8TransactionHistory — 자산 purchaseHistory → Transaction */
export function purchaseRecordToTransaction(assetName: string, record: PurchaseRecord): Transaction {
  const qty = record.quantity || 0;
  const amountKrw =
    record.amountInKRW != null && record.amountInKRW > 0
      ? Math.round(record.amountInKRW)
      : Math.round((record.amount || record.price || 0) * (qty > 0 ? qty : 1));
  const rate = record.exchangeRateAtTransaction;
  const isUs = rate != null && rate > 0;
  const priceUsd =
    isUs && record.type === 'SELL'
      ? (() => {
          const qty = record.quantity || 1;
          const amountKrw =
            record.amountInKRW != null && record.amountInKRW > 0
              ? Math.round(record.amountInKRW)
              : Math.round((record.amount || record.price || 0) * qty);
          const krwPerShare = amountKrw / qty;
          if (krwPerShare > 0 && Math.abs(record.price - krwPerShare) < 2) {
            return record.price / rate;
          }
          return record.price;
        })()
      : isUs && record.type === 'BUY'
        ? record.price
        : undefined;

  return stripUndefinedDeep({
    id: record.id,
    assetName: assetName.trim(),
    type: record.type,
    quantity: qty,
    price: record.price,
    ...(priceUsd != null ? { priceUsd } : {}),
    totalAmount: amountKrw,
    amountInKRW: amountKrw,
    ...(rate != null && rate > 0
      ? record.type === 'SELL'
        ? { exchangeRateAtSale: rate, exchangeRateAtPurchase: rate }
        : { exchangeRateAtPurchase: rate }
      : {}),
    ...(record.averagePriceAtSale != null ? { averagePriceAtSale: record.averagePriceAtSale } : {}),
    ...(record.averageExchangeRateAtSale != null
      ? { averageExchangeRateAtSale: record.averageExchangeRateAtSale }
      : {}),
    transactionDate: record.date,
    timestamp: record.timestamp ?? record.date,
    ...(record.realizedProfit != null ? { realizedProfit: record.realizedProfit } : {}),
    ...(record.realizedProfitRate != null ? { profitRate: record.realizedProfitRate } : {}),
  }) as Transaction;
}

/** logicalName: phase8TransactionHistory — portfolios.transactions + purchaseHistory 통합 */
export function collectPortfolioTransactions(portfolio: Portfolio): Transaction[] {
  const map = new Map<string, Transaction>();

  for (const tx of portfolio.transactions ?? []) {
    if (!tx?.id) continue;
    map.set(tx.id, stripUndefinedDeep({ ...tx }) as Transaction);
  }

  for (const asset of portfolio.assets ?? []) {
    const name = asset.name?.trim();
    if (!name) continue;
    for (const record of asset.purchaseHistory ?? []) {
      if (!record?.id || map.has(record.id)) continue;
      map.set(record.id, purchaseRecordToTransaction(name, record));
    }
  }

  return Array.from(map.values()).sort(
    (a, b) =>
      normalizeTransactionTimestamp(b).getTime() - normalizeTransactionTimestamp(a).getTime()
  );
}

/** logicalName: transactionHistoryPhase8 — 포트폴리오의 모든 거래 조회 (통합 Transaction) */
export function getAllTransactions(portfolio: Portfolio): Transaction[] {
  return collectPortfolioTransactions(portfolio);
}

/** logicalName: transactionHistoryPhase8 — purchaseHistory 원본 + 자산명 */
export function getPurchaseHistoryRecords(
  portfolio: Portfolio
): Array<PurchaseRecord & { assetName: string }> {
  const records: Array<PurchaseRecord & { assetName: string }> = [];
  for (const asset of portfolio.assets ?? []) {
    const name = asset.name?.trim();
    if (!name || !asset.purchaseHistory?.length) continue;
    for (const record of asset.purchaseHistory) {
      records.push({ ...record, assetName: name });
    }
  }
  records.sort((a, b) => {
    const timeA = normalizeTransactionTimestamp({
      timestamp: a.timestamp,
      transactionDate: a.date,
    });
    const timeB = normalizeTransactionTimestamp({
      timestamp: b.timestamp,
      transactionDate: b.date,
    });
    return timeB.getTime() - timeA.getTime();
  });
  return records;
}

/** logicalName: phase8TransactionHistory — 기간 필터 기준일 */
function getTransactionPeriodCutoff(period: TransactionPeriodFilter): Date | null {
  if (period === 'ALL') return null;
  const cutoff = new Date();
  if (period === '1M') cutoff.setMonth(cutoff.getMonth() - 1);
  else if (period === '3M') cutoff.setMonth(cutoff.getMonth() - 3);
  else if (period === '1Y') cutoff.setFullYear(cutoff.getFullYear() - 1);
  return cutoff;
}

/** logicalName: transactionHistoryPhase8 — 거래 필터링 */
export function filterTransactions(
  transactions: Transaction[],
  options?: {
    type?: 'BUY' | 'SELL';
    assetName?: string;
    startDate?: Date;
    endDate?: Date;
    period?: TransactionPeriodFilter;
    searchQuery?: string;
  }
): Transaction[] {
  const type = options?.type;
  const asset = options?.assetName?.trim();
  const period = options?.period ?? 'ALL';
  const search = options?.searchQuery?.trim().toLowerCase() ?? '';
  const cutoff = getTransactionPeriodCutoff(period);
  const startDate = options?.startDate;
  const endDate = options?.endDate;

  return transactions.filter((tx) => {
    if (type && tx.type !== type) return false;
    if (asset && asset !== 'ALL' && tx.assetName?.trim() !== asset) return false;
    if (search && !tx.assetName?.toLowerCase().includes(search)) return false;

    const txDate = normalizeTransactionTimestamp(tx);
    if (cutoff && txDate.getTime() < cutoff.getTime()) return false;
    if (startDate && txDate.getTime() < startDate.getTime()) return false;
    if (endDate && txDate.getTime() > endDate.getTime()) return false;
    return true;
  });
}

/** logicalName: phase8TransactionHistory — 거래 목록 필터 (filterTransactions 래퍼) */
export function filterPortfolioTransactions(
  transactions: Transaction[],
  filters: TransactionListFilters
): Transaction[] {
  const type =
    filters.type && filters.type !== 'ALL' ? (filters.type as 'BUY' | 'SELL') : undefined;
  return filterTransactions(transactions, {
    type,
    assetName: filters.assetName,
    period: filters.period,
    searchQuery: filters.searchQuery,
    startDate: filters.startDate,
    endDate: filters.endDate,
  });
}

/** logicalName: phase8TransactionHistory — 매수/매도 통계 */
export function computeTransactionStats(transactions: Transaction[]): TransactionStats {
  let buyCount = 0;
  let sellCount = 0;
  let totalBuyAmountKrw = 0;
  let totalSellAmountKrw = 0;
  let totalRealizedProfitKrw = 0;
  let profitRateSum = 0;
  let profitRateCount = 0;
  const assetNames = new Set<string>();
  const monthlyMap = new Map<string, number>();

  for (const tx of transactions) {
    const name = tx.assetName?.trim();
    if (name) assetNames.add(name);
    const amount = Math.round(tx.amountInKRW ?? tx.totalAmount ?? 0);
    const txDate = normalizeTransactionTimestamp(tx);
    const monthKey = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}`;
    monthlyMap.set(monthKey, (monthlyMap.get(monthKey) ?? 0) + 1);

    if (tx.type === 'BUY') {
      buyCount += 1;
      totalBuyAmountKrw += amount;
    } else {
      sellCount += 1;
      totalSellAmountKrw += amount;
      totalRealizedProfitKrw += tx.realizedProfit ?? 0;
      if (tx.profitRate != null && Number.isFinite(tx.profitRate)) {
        profitRateSum += tx.profitRate;
        profitRateCount += 1;
      }
    }
  }

  const monthlyBreakdown: TransactionMonthlyStat[] = Array.from(monthlyMap.entries())
    .map(([monthKey, count]) => ({
      monthKey,
      label: `${parseInt(monthKey.split('-')[1] ?? '0', 10)}월`,
      count,
    }))
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey));

  return {
    totalCount: transactions.length,
    buyCount,
    sellCount,
    totalBuyAmountKrw: Math.round(totalBuyAmountKrw),
    totalSellAmountKrw: Math.round(totalSellAmountKrw),
    totalRealizedProfitKrw: Math.round(totalRealizedProfitKrw),
    uniqueAssetCount: assetNames.size,
    averageProfitRate: profitRateCount > 0 ? profitRateSum / profitRateCount : 0,
    monthlyBreakdown,
  };
}

/** logicalName: transactionHistoryPhase8 — 통계 계산 (computeTransactionStats 별칭) */
export function calculateTransactionStats(transactions: Transaction[]): TransactionStats {
  return computeTransactionStats(transactions);
}

/** logicalName: transactionHistoryPhase8 — 목록용 가격 × 수량 텍스트 */
export function formatTransactionPriceQuantity(tx: Transaction): string {
  const rate = resolveTransactionExchangeRate(tx);
  const qty = tx.quantity || 0;
  if (rate != null) {
    const usd =
      tx.type === 'BUY' ? tx.priceUsd ?? tx.price : inferUsSellPriceUsd(tx, rate);
    return `${usd.toFixed(2)} USD × ${qty}주`;
  }
  return `${formatCommas(Math.round(tx.price))}원 × ${qty}주`;
}

/** logicalName: transactionHistoryPhase8 — 날짜 + 시간 */
export function formatTransactionDateTime(tx: Transaction): string {
  const d = normalizeTransactionTimestamp(tx);
  if (d.getTime() === 0) return tx.transactionDate || '-';
  const date = tx.transactionDate || d.toISOString().slice(0, 10);
  return `${date} ${formatTransactionTime(tx)}`;
}

function csvEscape(value: string | number | undefined | null): string {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** logicalName: transactionHistoryPhase8 — CSV 내보내기 */
export function exportTransactionsToCsv(transactions: Transaction[]): string {
  const headers = [
    '날짜',
    '시간',
    '유형',
    '자산명',
    '티커',
    '단가',
    '수량',
    '총액(KRW)',
    '손익(KRW)',
    '수익률(%)',
  ];
  const rows = transactions.map((tx) => {
    const amountKrw = Math.round(tx.amountInKRW ?? tx.totalAmount ?? 0);
    const rate = resolveTransactionExchangeRate(tx);
    const unitPrice =
      rate != null
        ? `${(tx.type === 'BUY' ? tx.priceUsd ?? tx.price : inferUsSellPriceUsd(tx, rate)).toFixed(2)} USD`
        : `${Math.round(tx.price)} KRW`;
    return [
      tx.transactionDate || normalizeTransactionTimestamp(tx).toISOString().slice(0, 10),
      formatTransactionTime(tx),
      tx.type,
      tx.assetName,
      tx.ticker ?? '',
      unitPrice,
      tx.quantity,
      amountKrw,
      tx.realizedProfit ?? '',
      tx.profitRate != null ? tx.profitRate.toFixed(2) : '',
    ]
      .map(csvEscape)
      .join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

/** logicalName: phase8TransactionHistory — Firestore에서 거래 이력 조회 */
export async function fetchPortfolioTransactions(nickname: string): Promise<Transaction[]> {
  const trimmed = nickname.trim();
  if (!trimmed) return [];

  const snap = await getDoc(doc(db, 'portfolios', trimmed));
  if (!snap.exists()) return [];

  const portfolio = { nickname: trimmed, ...snap.data() } as Portfolio;
  return collectPortfolioTransactions(portfolio);
}

/** logicalName: totalProfitRateCalculationFix — 신규 포트폴리오 초기 문서 */
export function createPortfolio(nickname: string, exchangeRate: number = DEFAULT_EXCHANGE_RATE): Portfolio {
  const initialCapital = PORTFOLIO_STARTING_CAPITAL;
  return {
    nickname,
    assets: [],
    savings: initialCapital,
    exchangeRate,
    lastExchangeRateUpdate: new Date(),
    initialCapital,
    totalCurrentValue: 0,
    profitAmount: 0,
    profitRate: 0,
    totalAssets: initialCapital,
    totalProfitAmount: 0,
    totalProfitRate: 0,
    totalPurchaseAmount: 0,
    cumulativeRealizedProfit: 0,
    totalBudget: initialCapital,
    hasRealPrices: false,
    transactions: [],
    updatedAt: new Date(),
  };
}

export interface PortfolioValueUpdate {
  assets: AssetItem[];
  totalCurrentValue: number;
  profitAmount: number;
  profitRate: number;
  totalAssets: number;
  totalProfitAmount: number;
  totalProfitRate: number;
  totalPurchaseAmount: number;
  totalUnrealizedProfit: number;
  totalRealizedProfit: number;
}

/** logicalName: accurateProfitCalculationV2_withExchangeRate — re-export */
export { calculateUnrealizedProfit, buildCatalogPriceMap } from './utils/portfolioPnL';

export function resolveAveragePurchasePrice(asset: AssetItem): number {
  const market = asset.market ?? inferAssetMarketRegion(asset.name, asset.type || 'stock');
  if (market === 'US') {
    return getPurchasePriceUsd(asset, asset.purchaseExchangeRate ?? DEFAULT_EXCHANGE_RATE);
  }
  return asset.averagePurchasePrice ?? asset.price;
}

export function resolveAssetDisplayName(asset: AssetItem): string {
  return asset.assetName?.trim() || asset.name.trim();
}

/** logicalName: accurateProfitCalculationV2_withExchangeRate — 자산별 미실현 손익 */
export function calculateAssetUnrealizedProfit(
  asset: AssetItem,
  currentExchangeRate: number,
  marketPrices?: MarketPriceMap,
  catalogPrices?: CatalogPriceMap
): { profit: number; profitRate: number; currentAmount: number; purchaseAmount: number } {
  const result = calculateUnrealizedProfit(
    asset,
    marketPrices,
    currentExchangeRate,
    catalogPrices
  );
  return {
    profit: result.unrealizedProfit,
    profitRate: result.unrealizedProfitRate,
    currentAmount: result.currentAmount,
    purchaseAmount: result.purchaseAmount,
  };
}

/** purchaseHistory SELL 기록에서 실현손익 합산 */
export function sumRealizedProfitFromAssets(assets: AssetItem[]): number {
  return assets.reduce((total, asset) => {
    const sells = (asset.purchaseHistory ?? []).filter(
      (record) => record.type === 'SELL' && record.realizedProfit != null
    );
    return total + sells.reduce((sum, record) => sum + (record.realizedProfit ?? 0), 0);
  }, 0);
}

/** logicalName: accurateProfitCalculationV2_withExchangeRate — 평균매입가 재계산 (매수) */
export function applyBuyToAsset(
  asset: AssetItem,
  quantity: number,
  price: number,
  currentExchangeRate: number
): AssetItem {
  const market = asset.market ?? inferAssetMarketRegion(asset.name, asset.type || 'stock');
  const existingQty = asset.quantity || 0;
  const totalQty = existingQty + quantity;

  if (market === 'US') {
    const purchaseExchangeRate =
      existingQty === 0 ? currentExchangeRate : resolvePurchaseExchangeRate(asset, currentExchangeRate);
    const existingUsd = resolveAveragePurchasePrice(asset);
    const newAvgUsd =
      existingQty === 0
        ? price
        : (existingUsd * existingQty + price * quantity) / totalQty;
    const priceKrw = Math.round(newAvgUsd * purchaseExchangeRate);

    return {
      ...asset,
      quantity: totalQty,
      averagePurchasePrice: newAvgUsd,
      purchasePriceUSD: newAvgUsd,
      priceUSD: price,
      price: priceKrw,
      purchaseExchangeRate,
      totalPurchaseAmount: Math.round(priceKrw * totalQty),
    };
  }

  const existingPrice = asset.averagePurchasePrice ?? asset.price;
  const newAvg =
    existingQty === 0
      ? price
      : (existingPrice * existingQty + price * quantity) / totalQty;

  return {
    ...asset,
    quantity: totalQty,
    averagePurchasePrice: newAvg,
    price: Math.round(newAvg),
    priceKRW: Math.round(newAvg),
    purchaseExchangeRate: 1,
    totalPurchaseAmount: Math.round(newAvg * totalQty),
  };
}

/** logicalName: accurateProfitCalculationV2_withExchangeRate — 실현손익 (매도) */
export function applySellToAsset(
  asset: AssetItem,
  quantity: number,
  price: number,
  currentExchangeRate: number
): { asset: AssetItem; realizedProfit: number; realizedProfitRate: number; sellAmountKrw: number } {
  const heldQty = asset.quantity || 0;
  if (quantity > heldQty) {
    throw new SellAssetError(
      `${resolveAssetDisplayName(asset)}: 보유량(${heldQty})이 매도량(${quantity})보다 적습니다.`
    );
  }

  const market = asset.market ?? inferAssetMarketRegion(asset.name, asset.type || 'stock');
  const purchaseUnitKrw = getPurchaseUnitKrw(asset, currentExchangeRate);
  const sellUnitKrw =
    market === 'US' ? Math.round(price * currentExchangeRate) : Math.round(price);
  const realizedProfit = Math.round((sellUnitKrw - purchaseUnitKrw) * quantity);
  const realizedProfitRate =
    purchaseUnitKrw > 0 ? ((sellUnitKrw - purchaseUnitKrw) / purchaseUnitKrw) * 100 : 0;
  const sellAmountKrw = Math.round(sellUnitKrw * quantity);

  return {
    asset: {
      ...asset,
      quantity: heldQty - quantity,
    },
    realizedProfit,
    realizedProfitRate,
    sellAmountKrw,
  };
}

/** logicalName: accurateProfitCalculationV2_withExchangeRate — 포트폴리오 전체 손익 재계산 */
export function recalculatePortfolioValues(
  portfolio: Pick<
    Portfolio,
    'assets' | 'savings' | 'initialCapital' | 'exchangeRate' | 'cumulativeRealizedProfit'
  >,
  marketPrices?: MarketPriceMap,
  catalogPrices?: CatalogPriceMap,
  newExchangeRate?: number
): PortfolioValueUpdate {
  const currentExchangeRate = newExchangeRate ?? portfolio.exchangeRate ?? DEFAULT_EXCHANGE_RATE;
  const initialCapital = resolveInitialCapital(portfolio as Portfolio);
  const savings =
    portfolio.savings ??
    derivePortfolioCash(
      portfolio.assets ?? [],
      portfolio.cumulativeRealizedProfit ?? 0,
      undefined,
      currentExchangeRate
    );

  const totalRealizedProfit =
    portfolio.cumulativeRealizedProfit ?? sumRealizedProfitFromAssets(portfolio.assets ?? []);

  const base = updatePortfolioValues(
    portfolio.assets ?? [],
    savings,
    initialCapital,
    marketPrices,
    currentExchangeRate,
    catalogPrices
  );

  const totalProfitAmount = Math.round(totalRealizedProfit + base.profitAmount);
  const totalProfitRate =
    initialCapital > 0 ? (totalProfitAmount / initialCapital) * 100 : 0;

  return {
    ...base,
    totalUnrealizedProfit: base.profitAmount,
    totalRealizedProfit,
    totalProfitAmount,
    totalProfitRate,
  };
}

export interface RealizedProfitOnSell {
  sellAmount: number;
  purchaseAmount: number;
  realizedProfit: number;
  profitRate: number;
  cashInflow: number;
  purchasePriceKrw: number;
  purchaseUsd?: number;
  purchaseRate?: number;
  sellPriceUsd?: number;
  isUsAsset: boolean;
}

/** logicalName: realizedProfitWithCashFlowFixed — 매도 실현 손익 + 현금 유입 */
export function computeRealizedProfitOnSell(
  asset: AssetItem,
  sellQuantity: number,
  sellPriceKrw: number,
  exchangeRate: number
): RealizedProfitOnSell {
  const market = asset.market ?? inferAssetMarketRegion(asset.name, asset.type || 'stock');
  const qty = Math.max(0, Math.floor(sellQuantity));

  if (market === 'US') {
    const purchasePriceKrw = getPurchaseUnitKrw(asset, exchangeRate);
    const sellAmount = Math.round(sellPriceKrw * qty);
    const purchaseAmount = Math.round(purchasePriceKrw * qty);
    const realizedProfit = sellAmount - purchaseAmount;
    const profitRate = purchaseAmount > 0 ? (realizedProfit / purchaseAmount) * 100 : 0;
    const purchaseUsd = getPurchasePriceUsd(asset, exchangeRate);
    const purchaseRate = resolvePurchaseExchangeRate(asset, exchangeRate);
    const sellPriceUsd = exchangeRate > 0 ? sellPriceKrw / exchangeRate : undefined;

    return {
      sellAmount,
      purchaseAmount,
      realizedProfit,
      profitRate,
      cashInflow: sellAmount,
      purchasePriceKrw,
      purchaseUsd,
      purchaseRate,
      sellPriceUsd,
      isUsAsset: true,
    };
  }

  const purchasePriceKrw =
    market === 'Crypto' && asset.quantity > 0 && asset.totalPurchaseAmount
      ? Math.round(asset.totalPurchaseAmount / asset.quantity)
      : getPurchaseUnitKrw(asset, exchangeRate);
  const sellAmount = Math.round(sellPriceKrw * qty);
  const purchaseAmount = Math.round(purchasePriceKrw * qty);
  const realizedProfit = sellAmount - purchaseAmount;
  const profitRate = purchaseAmount > 0 ? (realizedProfit / purchaseAmount) * 100 : 0;

  return {
    sellAmount,
    purchaseAmount,
    realizedProfit,
    profitRate,
    cashInflow: sellAmount,
    purchasePriceKrw,
    isUsAsset: false,
  };
}

/** logicalName: accurateProfitCalculationV2_withExchangeRate — 포트폴리오 평가·손익 일괄 계산 */
export function updatePortfolioValues(
  assets: AssetItem[],
  savings: number,
  initialCapital: number,
  marketPrices: MarketPriceMap | undefined,
  exchangeRate: number,
  catalogPrices?: CatalogPriceMap
): PortfolioValueUpdate {
  let totalCurrentValue = 0;
  let totalPurchaseAmountKRW = 0;
  let totalUnrealizedProfit = 0;

  const normalizedAssets = assets.map((asset) =>
    isUsMarketAsset(asset) ? normalizeUsAssetPurchaseBasis(asset, exchangeRate) : asset
  );

  const updatedAssets = normalizedAssets.map((asset) => {
    const profitInfo = calculateUnrealizedProfit(
      asset,
      marketPrices,
      exchangeRate,
      catalogPrices
    );
    totalCurrentValue += profitInfo.currentAmount;
    totalUnrealizedProfit += profitInfo.unrealizedProfit;
    totalPurchaseAmountKRW += profitInfo.purchaseAmount;

    return stripUndefinedDeep({
      ...asset,
      unrealizedProfit: profitInfo.unrealizedProfit,
      unrealizedProfitRate: profitInfo.unrealizedProfitRate,
      totalPurchaseAmount: profitInfo.purchaseAmount,
    });
  });

  const roundedEvaluation = Math.round(totalCurrentValue);
  const roundedSavings = Math.round(savings);
  const totalAssets = roundedSavings + roundedEvaluation;
  const totalProfitAmountFromNav = totalAssets - initialCapital;
  const profitRate =
    totalPurchaseAmountKRW > 0 ? (totalUnrealizedProfit / totalPurchaseAmountKRW) * 100 : 0;

  return {
    assets: updatedAssets,
    totalCurrentValue: roundedEvaluation,
    profitAmount: Math.round(totalUnrealizedProfit),
    profitRate,
    totalAssets,
    totalProfitAmount: totalProfitAmountFromNav,
    totalProfitRate:
      initialCapital > 0 ? (totalProfitAmountFromNav / initialCapital) * 100 : 0,
    totalPurchaseAmount: Math.round(totalPurchaseAmountKRW),
    totalUnrealizedProfit: Math.round(totalUnrealizedProfit),
    totalRealizedProfit: 0,
  };
}

/** 종합 실질 수익률: (현금 + 평가금액) − 초기자본 */
export function computeOverallPortfolioReturn(
  savings: number,
  assetEvaluation: number,
  initialCapital: number = PORTFOLIO_STARTING_CAPITAL
): { totalAssets: number; profitAmount: number; profitRate: number } {
  const totalAssets = Math.round(savings + assetEvaluation);
  const profitAmount = totalAssets - initialCapital;
  const profitRate = initialCapital > 0 ? (profitAmount / initialCapital) * 100 : 0;
  return { totalAssets, profitAmount, profitRate };
}

/** logicalName: tradingSystemPhase5 — 포트폴리오 Firestore 저장 (매수/매도 후 자동 반영) */
export async function persistPortfolio(options: {
  nickname: string;
  assets: AssetItem[];
  reason?: string;
  cumulativeRealizedProfit?: number;
  marketPrices?: MarketPriceMap;
  exchangeRate?: number;
  catalogPrices?: CatalogPriceMap;
  /** 저장할 현금 — 미전달 시 보유 매입원가 기준으로 자동 산출 */
  savings?: number;
}): Promise<{ assets: AssetItem[]; savings: number; cumulativeRealizedProfit: number }> {
  const trimmedNickname = options.nickname.trim();
  if (!trimmedNickname) {
    throw new Error('닉네임이 필요합니다.');
  }

  const reason = options.reason ?? '';
  const cumulativeRealizedProfit = options.cumulativeRealizedProfit ?? 0;
  const marketPrices = options.marketPrices ?? {};
  const exchangeRate = options.exchangeRate ?? DEFAULT_EXCHANGE_RATE;
  const activeTotalBudget = PORTFOLIO_STARTING_CAPITAL + cumulativeRealizedProfit;

  const existingSnap = await getDoc(doc(db, 'portfolios', trimmedNickname));
  const existingPortfolio = existingSnap.exists()
    ? ({ nickname: trimmedNickname, ...existingSnap.data() } as Portfolio)
    : null;
  const initialCapital = resolveInitialCapital(existingPortfolio);

  const cleanAssets = options.assets.filter(
    (a) => a.name.trim() !== '' && a.price > 0 && a.quantity > 0
  );

  const normalizedAssets = cleanAssets.map((asset) =>
    isUsMarketAsset(asset) ? normalizeUsAssetPurchaseBasis(asset, exchangeRate) : asset
  );

  const catalogPrices = options.catalogPrices ?? buildCatalogPriceMap([], exchangeRate);

  const assetsWithRealPrices = normalizedAssets.map((asset) => {
    const activeCurrentPrice =
      marketPrices[asset.name.trim()] !== undefined
        ? marketPrices[asset.name.trim()]
        : (asset.currentPrice ?? asset.price);
    return stripUndefinedDeep({
      ...asset,
      currentPrice: activeCurrentPrice,
      sourceUrl: asset.sourceUrl || '',
      searchReasoning: asset.searchReasoning || '',
    });
  });

  const hasRealPrices = assetsWithRealPrices.some((a) => a.currentPrice !== a.price);
  const cleanSavings = derivePortfolioCash(
    normalizedAssets,
    cumulativeRealizedProfit,
    undefined,
    exchangeRate
  );
  const portfolioValues = updatePortfolioValues(
    assetsWithRealPrices,
    cleanSavings,
    initialCapital,
    marketPrices,
    exchangeRate,
    catalogPrices
  );

  await setDoc(
    doc(db, 'portfolios', trimmedNickname),
    stripUndefinedDeep({
      nickname: trimmedNickname,
      assets: portfolioValues.assets,
      savings: cleanSavings,
      exchangeRate,
      initialCapital,
      totalCurrentValue: portfolioValues.totalCurrentValue,
      profitAmount: portfolioValues.profitAmount,
      profitRate: portfolioValues.profitRate,
      totalAssets: portfolioValues.totalAssets,
      totalProfitAmount: portfolioValues.totalProfitAmount,
      totalProfitRate: portfolioValues.totalProfitRate,
      totalPurchaseAmount: portfolioValues.totalPurchaseAmount,
      unrealizedProfitAmount: portfolioValues.profitAmount,
      hasRealPrices,
      updatedAt: new Date(),
      reason: reason.trim(),
      totalBudget: activeTotalBudget,
      cumulativeRealizedProfit,
    }),
    { merge: true }
  );

  return {
    assets: portfolioValues.assets,
    savings: cleanSavings,
    cumulativeRealizedProfit,
  };
}

/** Firestore savings가 역산값과 다를 때 손익·예치금 필드 일괄 보정 (기존·신규 계정 공통) */
export async function repairPortfolioIfNeeded(
  nickname: string,
  options?: {
    marketPrices?: MarketPriceMap;
    exchangeRate?: number;
    catalogPrices?: CatalogPriceMap;
  }
): Promise<boolean> {
  const trimmedNickname = nickname.trim();
  if (!trimmedNickname) return false;

  const snap = await getDoc(doc(db, 'portfolios', trimmedNickname));
  if (!snap.exists()) return false;

  const portfolio = { nickname: trimmedNickname, ...snap.data() } as Portfolio;
  const exchangeRate =
    options?.exchangeRate != null && options.exchangeRate > 0
      ? options.exchangeRate
      : await getGlobalExchangeRate();

  if (!portfolioCashNeedsRepair(portfolio, exchangeRate)) {
    return false;
  }

  await persistPortfolio({
    nickname: trimmedNickname,
    assets: portfolio.assets ?? [],
    reason: portfolio.reason ?? '',
    cumulativeRealizedProfit: portfolio.cumulativeRealizedProfit ?? 0,
    marketPrices: options?.marketPrices ?? {},
    exchangeRate,
    catalogPrices: options?.catalogPrices,
  });

  return true;
}

/** logicalName: realizedProfitWithCashFlowFixed — enhancedSellSimulator */
export async function sellAsset(
  nickname: string,
  request: SellAssetRequest
): Promise<SellAssetResult> {
  const trimmedNickname = nickname.trim();
  const trimmedName = request.assetName.trim();
  const quantity = Math.floor(request.quantity);
  const sellPriceKrw = Math.round(request.sellPriceKrw);

  if (!trimmedNickname) throw new SellAssetError('닉네임이 필요합니다.');
  if (!trimmedName) throw new SellAssetError('매도할 종목을 선택해 주세요.');
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new SellAssetError('매도 수량은 1 이상의 정수여야 합니다.');
  }
  if (!Number.isFinite(sellPriceKrw) || sellPriceKrw <= 0) {
    throw new SellAssetError('현재가 정보가 유효하지 않습니다.');
  }

  const docRef = doc(db, 'portfolios', trimmedNickname);
  let snap;
  try {
    snap = await getDoc(docRef);
  } catch (error) {
    mapSellError(error, 'portfolio read failed');
  }

  if (!snap!.exists()) {
    throw new SellAssetError('포트폴리오를 찾을 수 없습니다.');
  }

  const portfolio = { nickname: trimmedNickname, ...snap!.data() } as Portfolio;
  const currentAssets = portfolio.assets ?? [];
  const assetIndex = currentAssets.findIndex(
    (a) => a.name.trim().toLowerCase() === trimmedName.toLowerCase()
  );

  if (assetIndex < 0) {
    throw new SellAssetError('보유하고 있지 않은 자산은 매도할 수 없습니다.');
  }

  const existing = currentAssets[assetIndex];
  const heldQty = Math.floor(existing.quantity);

  if (heldQty <= 0) {
    throw new SellAssetError('보유 수량이 없습니다.');
  }
  if (quantity > heldQty) {
    throw new SellAssetError(`보유 수량(${heldQty}주)을 초과하여 매도할 수 없습니다.`);
  }

  const exchangeRate = await getGlobalExchangeRate();
  const sharedSnap = await getDoc(sharedConfigRef());
  const marketPrices = parseSharedMarketPrices(sharedSnap.data());
  const isUsAsset =
    (existing.market ?? inferAssetMarketRegion(existing.name, existing.type || 'stock')) === 'US';

  const sellResult = computeRealizedProfitOnSell(existing, quantity, sellPriceKrw, exchangeRate);
  const {
    sellAmount,
    purchaseAmount,
    realizedProfit,
    profitRate,
    cashInflow,
    purchasePriceKrw,
    purchaseUsd,
    purchaseRate,
    sellPriceUsd,
  } = sellResult;

  const cumulativeProfit = portfolio.cumulativeRealizedProfit ?? 0;
  const nextCumulativeProfit = cumulativeProfit + realizedProfit;
  const previousSavings = derivePortfolioCash(
    currentAssets,
    cumulativeProfit,
    undefined,
    exchangeRate
  );

  const sellRecord: PurchaseRecord = {
    id: `${Date.now()}_sell_${sanitizeDocId(trimmedName)}`,
    type: 'SELL',
    quantity,
    price: isUsAsset ? (sellPriceUsd ?? purchaseUsd ?? sellPriceKrw) : sellPriceKrw,
    amount: isUsAsset ? (sellPriceUsd ?? purchaseUsd ?? sellPriceKrw) : sellPriceKrw,
    exchangeRateAtTransaction: isUsAsset ? exchangeRate : undefined,
    amountInKRW: cashInflow,
    averagePriceAtSale: isUsAsset ? (purchaseUsd ?? 0) : purchasePriceKrw,
    averageExchangeRateAtSale: isUsAsset ? purchaseRate : undefined,
    realizedProfit,
    realizedProfitRate: Math.round(profitRate * 100) / 100,
    timestamp: new Date(),
    date: new Date().toISOString().slice(0, 10),
  };

  const remainingQty = heldQty - quantity;
  let nextAssets: AssetItem[];

  if (remainingQty <= 0) {
    nextAssets = currentAssets
      .filter((_, index) => index !== assetIndex)
      .map((asset) => stripUndefinedDeep(asset));
  } else {
    const remainingHistory = [...(existing.purchaseHistory ?? []), sellRecord];
    const avgUsd = purchaseUsd ?? getPurchasePriceUsd(existing, exchangeRate);
    const avgRate = purchaseRate ?? resolvePurchaseExchangeRate(existing, exchangeRate);
    const totalPurchaseAmount = isUsAsset
      ? Math.round(avgUsd * remainingQty * avgRate)
      : Math.round(purchasePriceKrw * remainingQty);

    nextAssets = currentAssets.map((asset, index) =>
      index === assetIndex
        ? stripUndefinedDeep({
            ...asset,
            quantity: remainingQty,
            currentPrice: sellPriceKrw,
            totalPurchaseAmount,
            purchaseHistory: remainingHistory,
            // purchasePriceUSD, purchaseExchangeRate, price — 절대 변경하지 않음
          })
        : stripUndefinedDeep(asset)
    );
  }

  const nextAssetsWithPrices = nextAssets.map((asset) => {
    const activeCurrentPrice =
      marketPrices[asset.name.trim()] !== undefined
        ? marketPrices[asset.name.trim()]
        : (asset.currentPrice ?? asset.price);
    return stripUndefinedDeep({
      ...asset,
      currentPrice: activeCurrentPrice,
      sourceUrl: asset.sourceUrl || '',
      searchReasoning: asset.searchReasoning || '',
    });
  });

  const catalogPrices = buildCatalogPriceMap([], exchangeRate);
  const newSavings = derivePortfolioCash(
    nextAssets,
    nextCumulativeProfit,
    undefined,
    exchangeRate
  );
  const initialCapital = resolveInitialCapital(portfolio);
  const portfolioValues = updatePortfolioValues(
    nextAssetsWithPrices,
    newSavings,
    initialCapital,
    marketPrices,
    exchangeRate,
    catalogPrices
  );

  const sellPresetTicker = getPresetByName(trimmedName)?.ticker;
  const transaction: Transaction = stripUndefinedDeep({
    id: sellRecord.id,
    assetName: trimmedName,
    type: 'SELL',
    quantity,
    price: sellPriceKrw,
    totalAmount: sellAmount,
    amountInKRW: sellAmount,
    ...(sellPresetTicker ? { ticker: sellPresetTicker } : {}),
    ...(isUsAsset
      ? {
          priceUsd: sellPriceUsd != null ? Math.round(sellPriceUsd * 100) / 100 : undefined,
          exchangeRateAtSale: exchangeRate,
          exchangeRateAtPurchase: exchangeRate,
          averagePriceAtSale: purchaseUsd,
          averageExchangeRateAtSale: purchaseRate,
        }
      : {
          averagePriceAtSale: purchasePriceKrw,
        }),
    realizedProfit,
    profitRate: Math.round(profitRate * 100) / 100,
    transactionDate: sellRecord.date,
    timestamp: new Date(),
  });

  const existingTransactions = (portfolio.transactions ?? []).map((item) =>
    stripUndefinedDeep({
      ...item,
      timestamp:
        item.timestamp instanceof Date
          ? item.timestamp
          : typeof item.timestamp?.toDate === 'function'
            ? item.timestamp.toDate()
            : item.timestamp,
    })
  );

  try {
    await setDoc(
      docRef,
      stripUndefinedDeep({
        nickname: trimmedNickname,
        assets: portfolioValues.assets,
        savings: newSavings,
        exchangeRate,
        initialCapital,
        totalCurrentValue: portfolioValues.totalCurrentValue,
        profitAmount: portfolioValues.profitAmount,
        profitRate: portfolioValues.profitRate,
        totalAssets: portfolioValues.totalAssets,
        totalProfitAmount: portfolioValues.totalProfitAmount,
        totalProfitRate: portfolioValues.totalProfitRate,
        totalPurchaseAmount: portfolioValues.totalPurchaseAmount,
        unrealizedProfitAmount: portfolioValues.profitAmount,
        hasRealPrices:
          portfolio.hasRealPrices ??
          portfolioValues.assets.some((a) => a.currentPrice !== a.price),
        transactions: [...existingTransactions, transaction],
        updatedAt: new Date(),
        totalBudget: PORTFOLIO_STARTING_CAPITAL + nextCumulativeProfit,
        cumulativeRealizedProfit: nextCumulativeProfit,
        ...(portfolio.reason != null ? { reason: portfolio.reason } : {}),
      }),
      { merge: true }
    );
    console.info('[sellAsset] portfolio updated', {
      nickname: trimmedNickname,
      assetName: trimmedName,
      quantity,
      sellAmount,
      realizedProfit,
      previousSavings,
      newSavings,
    });
  } catch (error) {
    mapSellError(error, 'portfolio write failed');
  }

  return {
    assetName: trimmedName,
    quantity,
    sellPriceKrw,
    sellAmount,
    cashInflow,
    purchasePriceKrw,
    purchaseAmount,
    realizedProfit,
    profitRate,
    previousSavings,
    newSavings,
    newCumulativeRealizedProfit: nextCumulativeProfit,
    assets: portfolioValues.assets,
    message: `${trimmedName} ${quantity}주를 매도했습니다. 실현손익 ${realizedProfit >= 0 ? '+' : ''}${realizedProfit.toLocaleString()}원 (${profitRate.toFixed(2)}%), 입금액 ${cashInflow.toLocaleString()}원`,
  };
}

export const GLOBAL_SETTINGS_DOC_ID = 'app';
export const SHARED_CONFIG_DOC_ID = 'appSharedConfig';

function globalSettingsRef() {
  return doc(db, 'settings', GLOBAL_SETTINGS_DOC_ID);
}

function sharedConfigRef() {
  return doc(db, 'portfolios', SHARED_CONFIG_DOC_ID);
}

function parseGlobalExchangeRate(data: Record<string, unknown> | undefined): number | null {
  const rate = data?.exchangeRate;
  return typeof rate === 'number' && rate > 0 ? rate : null;
}

function parseSharedMarketPrices(data: Record<string, unknown> | undefined): MarketPriceMap {
  const raw = data?.marketPrices;
  if (!raw || typeof raw !== 'object') return {};
  const prices: MarketPriceMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      prices[key] = value;
    }
  }
  return prices;
}

function mergeMarketPriceMaps(...maps: MarketPriceMap[]): MarketPriceMap {
  return Object.assign({}, ...maps);
}

function mergeCustomAssetLists(
  collectionAssets: CustomAsset[],
  sharedAssets: CustomAsset[]
): CustomAsset[] {
  const byName = new Map<string, CustomAsset>();
  for (const asset of sharedAssets) {
    byName.set(asset.name.trim().toLowerCase(), asset);
  }
  for (const asset of collectionAssets) {
    byName.set(asset.name.trim().toLowerCase(), asset);
  }
  return sortCustomAssetsByAddedAt(Array.from(byName.values()));
}

/** logicalName: multiCurrencySupport — 전역 환율 조회 (모든 참여자 공통) */
export async function getGlobalExchangeRate(): Promise<number> {
  const sharedSnap = await getDoc(sharedConfigRef());
  const sharedRate = parseGlobalExchangeRate(sharedSnap.data());
  if (sharedRate != null) return sharedRate;

  const settingsSnap = await getDoc(globalSettingsRef());
  const settingsRate = parseGlobalExchangeRate(settingsSnap.data());
  if (settingsRate != null) return settingsRate;

  return DEFAULT_EXCHANGE_RATE;
}

/** logicalName: multiCurrencySupport — 전역 환율 실시간 구독 */
export function subscribeGlobalExchangeRate(
  onUpdate: (rate: number) => void,
  onError?: (error: Error) => void
): () => void {
  let sharedRate: number | null = null;
  let settingsRate: number | null = null;

  const emit = () => {
    onUpdate(sharedRate ?? settingsRate ?? DEFAULT_EXCHANGE_RATE);
  };

  const unsubShared = onSnapshot(
    sharedConfigRef(),
    (snapshot) => {
      sharedRate = parseGlobalExchangeRate(snapshot.data());
      emit();
    },
    (error) => {
      console.warn('[subscribeGlobalExchangeRate] shared config listener error:', error);
      onError?.(error);
    }
  );

  const unsubSettings = onSnapshot(
    globalSettingsRef(),
    (snapshot) => {
      settingsRate = parseGlobalExchangeRate(snapshot.data());
      emit();
    },
    (error) => {
      console.warn('[subscribeGlobalExchangeRate] settings listener error:', error);
    }
  );

  return () => {
    unsubShared();
    unsubSettings();
  };
}

/** @deprecated 포트폴리오별 환율 대신 전역 환율 사용 */
export async function getExchangeRate(_nickname?: string): Promise<number> {
  return getGlobalExchangeRate();
}

export async function updateExchangeRate(
  _nickname: string,
  _newRate: number
): Promise<Portfolio> {
  throw new Error('환율은 관리자 모드에서만 수정할 수 있습니다.');
}

function getAdminPassword(): string {
  return import.meta.env.VITE_ADMIN_PASSWORD?.trim() || '1234';
}

let adminSessionPassword: string | null = null;

/** logicalName: newAdminModeAssetPriceEditor — 클라이언트 관리자 로그인 검증 */
export function verifyAdminPassword(password: string): boolean {
  return password.trim() === getAdminPassword();
}

/** 관리자 로그인 성공 후 API 호출용 비밀번호 저장 */
export function setAdminSessionPassword(password: string): void {
  adminSessionPassword = password.trim();
}

export function clearAdminSessionPassword(): void {
  adminSessionPassword = null;
}

export function isAdminSessionActive(): boolean {
  return adminSessionPassword != null && verifyAdminPassword(adminSessionPassword);
}

function resolveAdminPassword(override?: string): string {
  const candidate = override?.trim() || adminSessionPassword?.trim();
  if (candidate) return candidate;
  return getAdminPassword();
}

export interface AdminAssetPriceDisplay {
  marketLabel: string;
  pricePrimary: string;
  priceSecondary?: string;
  priceKrw: number;
  isUsAsset: boolean;
}

export function getAdminMarketLabel(asset: CustomAsset): string {
  const region = asset.marketRegion ?? inferAssetMarketRegion(asset.name, asset.type);
  if (region === 'Korea') return '국내 주식';
  if (region === 'US') return '미국 주식';
  return '암호화폐';
}

export function formatAdminUpdatedLabel(asset: CustomAsset): string {
  const rawBy = asset.lastUpdatedBy ?? 'system';
  const by =
    rawBy === 'admin'
      ? '관리자'
      : rawBy === 'api'
        ? 'API'
        : rawBy;
  const raw = asset.lastUpdatedAt ?? asset.lastPriceUpdatedAt;
  let dateLabel = '-';
  if (raw instanceof Date) {
    dateLabel = raw.toISOString().slice(0, 10);
  } else if (raw && typeof raw === 'object' && 'toDate' in raw && typeof raw.toDate === 'function') {
    dateLabel = raw.toDate().toISOString().slice(0, 10);
  } else if (typeof raw === 'string') {
    dateLabel = raw.slice(0, 10);
  }
  return `${by} (${dateLabel})`;
}

export function resolveAdminAssetPriceDisplay(
  asset: CustomAsset,
  exchangeRate: number,
  marketPrices?: MarketPriceMap
): AdminAssetPriceDisplay {
  const marketLabel = getAdminMarketLabel(asset);
  const override = marketPrices?.[asset.name.trim()];
  const region = asset.marketRegion ?? inferAssetMarketRegion(asset.name, asset.type);
  const currency = asset.displayCurrency ?? getDefaultDisplayCurrency(region);
  const isUsAsset = currency === 'USD' && (asset.priceUSD != null || region === 'US');

  if (isUsAsset) {
    const priceUsd =
      asset.priceUSD != null && asset.priceUSD > 0
        ? asset.priceUSD
        : override != null && exchangeRate > 0
          ? override / exchangeRate
          : exchangeRate > 0
            ? asset.price / exchangeRate
            : 0;
    const priceKrw =
      override != null && override > 0
        ? Math.round(override)
        : Math.round(priceUsd * exchangeRate);
    return {
      marketLabel,
      isUsAsset: true,
      priceKrw,
      pricePrimary: `${priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`,
      priceSecondary: `${priceKrw.toLocaleString('ko-KR')}원`,
    };
  }

  const priceKrw =
    override != null && override > 0
      ? Math.round(override)
      : Math.round(asset.priceKRW ?? asset.price);
  return {
    marketLabel,
    isUsAsset: false,
    priceKrw,
    pricePrimary: `${priceKrw.toLocaleString('ko-KR')}원`,
  };
}

/** logicalName: newAdminModeAssetPriceEditor — 자산명·티커 검색 */
export function matchesAdminAssetSearch(asset: CustomAsset, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    asset.name.toLowerCase().includes(q) ||
    (asset.ticker ?? '').toLowerCase().includes(q)
  );
}

/** Firestore Timestamp 등 비직렬화 필드 제거 — admin API 요청용 */
function toAdminAssetPayload(asset: CustomAsset): CustomAsset {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    price: asset.price,
    priceUSD: asset.priceUSD,
    priceKRW: asset.priceKRW,
    priceCrypto: asset.priceCrypto,
    ticker: asset.ticker,
    market: asset.market,
    marketRegion: asset.marketRegion,
    displayCurrency: asset.displayCurrency,
    addedBy: asset.addedBy ?? 'admin',
    addedAt: new Date(),
  };
}

async function parseAdminApiResponse(
  response: Response
): Promise<AdminPriceUpdateResult & { shouldFallback?: boolean }> {
  const text = await response.text();
  if (!text.trim()) {
    if (response.status === 404) {
      return {
        success: false,
        message:
          '관리자 API를 찾을 수 없습니다. 터미널에서 npm run dev 로 서버를 재시작한 뒤 다시 시도해주세요.',
        shouldFallback: true,
      };
    }
    return {
      success: false,
      message: `서버 응답이 비어 있습니다 (HTTP ${response.status}).`,
      shouldFallback: !response.ok,
    };
  }

  try {
    const data = JSON.parse(text) as AdminPriceUpdateResult;
    if (!response.ok) {
      return {
        success: false,
        message: data.message || '저장 중 오류가 발생했습니다.',
        shouldFallback: response.status === 404 || response.status === 503,
      };
    }
    return data;
  } catch {
    return {
      success: false,
      message: '서버 응답을 처리하지 못했습니다.',
      shouldFallback: true,
    };
  }
}

async function tryClientFirestoreWrite(
  label: string,
  operation: () => Promise<void>
): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch (error) {
    console.warn(`[updateAdminAssetPriceDirect] ${label} failed:`, error);
    return false;
  }
}

function firestorePermissionHelpMessage(): string {
  return (
    'Firestore 저장 권한이 없습니다.\n\n' +
    '① Firebase Console → Firestore → 규칙에서 아래를 배포하거나\n' +
    '   npx firebase-tools login && npx firebase-tools deploy --only firestore:rules\n\n' +
    '② 또는 Vercel 환경변수 FIREBASE_SERVICE_ACCOUNT에 서비스 계정 JSON을 추가한 뒤 재배포'
  );
}

function isFirestorePermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Missing or insufficient permissions') ||
    message.includes('PERMISSION_DENIED') ||
    message.toLowerCase().includes('permission')
  );
}

async function writeSharedMarketPriceClient(assetName: string, priceKrw: number): Promise<void> {
  const trimmed = assetName.trim();
  const sharedSnap = await getDoc(sharedConfigRef());
  const existing = (sharedSnap.data() ?? {}) as Record<string, unknown>;
  const marketPrices = {
    ...parseSharedMarketPrices(existing),
    [trimmed]: priceKrw,
  };

  await setDoc(
    sharedConfigRef(),
    stripUndefinedDeep({
      nickname: SHARED_CONFIG_DOC_ID,
      assets: [],
      savings: 0,
      totalCurrentValue: 0,
      profitRate: 0,
      profitAmount: 0,
      hasRealPrices: false,
      marketPrices,
      ...(typeof existing.exchangeRate === 'number' ? { exchangeRate: existing.exchangeRate } : {}),
      updatedAt: new Date(),
    }),
    { merge: true }
  );
}

/** logicalName: transactionHistoryPhase8 — Vercel 등 정적 배포용 Firestore 직접 시세 수정 */
async function updateAdminAssetPriceDirect(
  asset: CustomAsset,
  newPrice: number,
  reason: AdminPriceUpdateReason
): Promise<AdminPriceUpdateResult> {
  if (!isAdminSessionActive()) {
    return { success: false, message: '관리자 권한이 없습니다.' };
  }

  const assetId = asset.id?.trim();
  if (!assetId) {
    return { success: false, message: '자산 ID가 필요합니다.' };
  }

  const docId = assetId.startsWith(PRESET_ASSET_ID_PREFIX)
    ? sanitizeDocId(asset.name.trim())
    : assetId;
  const exchangeRate = await getGlobalExchangeRate();
  const snap = await getDoc(doc(db, 'customAssets', docId));
  const existing: CustomAsset = snap.exists()
    ? ({ ...(snap.data() as CustomAsset), id: docId } as CustomAsset)
    : asset;

  const marketRegion = existing.marketRegion ?? inferAssetMarketRegion(existing.name, existing.type);
  const displayCurrency = existing.displayCurrency ?? getDefaultDisplayCurrency(marketRegion);
  const now = new Date();

  const meta = {
    lastUpdatedBy: 'admin' as const,
    lastUpdatedAt: now,
    updateReason: reason,
    priceSource: 'admin',
    lastPriceUpdatedAt: now,
  };

  const payload: Partial<CustomAsset> = { ...meta };

  if (displayCurrency === 'USD') {
    payload.priceUSD = newPrice;
    payload.price = Math.round(computeKrwEquivalent('USD', newPrice, exchangeRate));
  } else if (displayCurrency === 'CRYPTO') {
    payload.priceCrypto = String(newPrice);
    payload.price = Math.round(computeKrwEquivalent('CRYPTO', newPrice, exchangeRate));
  } else {
    payload.priceKRW = newPrice;
    payload.price = Math.round(newPrice);
  }

  const priceKrw = payload.price!;
  const trimmedName = existing.name.trim();

  const customPricesOk = await tryClientFirestoreWrite('customPrices', () =>
    setDoc(
      doc(db, 'customPrices', trimmedName),
      {
        price: priceKrw,
        updatedAt: now,
        source: 'admin_override',
        lastUpdatedBy: 'admin',
        updateReason: reason,
      },
      { merge: true }
    )
  );

  const sharedConfigOk = await tryClientFirestoreWrite('sharedConfig', () =>
    writeSharedMarketPriceClient(trimmedName, priceKrw)
  );

  const baseFields: Partial<CustomAsset> = snap.exists()
    ? {}
    : stripUndefinedDeep({
        name: existing.name,
        type: existing.type,
        ticker: existing.ticker,
        market: existing.market,
        marketRegion,
        displayCurrency,
        addedBy: 'admin',
        addedAt: now,
      });

  await tryClientFirestoreWrite('customAssets', () =>
    setDoc(
      doc(db, 'customAssets', docId),
      stripUndefinedDeep({ ...baseFields, ...payload }),
      { merge: true }
    )
  );

  if (!customPricesOk && !sharedConfigOk) {
    return { success: false, message: firestorePermissionHelpMessage() };
  }

  const formattedPrice =
    displayCurrency === 'USD'
      ? `${newPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
      : `${Math.round(newPrice).toLocaleString('ko-KR')}원`;

  return {
    success: true,
    message: `✅ ${existing.name} 가격이 ${formattedPrice}으로 업데이트되었습니다.\n   모든 사용자의 포트폴리오에 반영됩니다.`,
  };
}

/** logicalName: multiCurrencySupport — 관리자 환율 조회 */
export async function getAdminExchangeRate(): Promise<number> {
  try {
    const response = await fetch('/api/admin/exchange-rate');
    if (!response.ok) return DEFAULT_EXCHANGE_RATE;
    const text = await response.text();
    if (!text.trim()) return DEFAULT_EXCHANGE_RATE;
    const data = JSON.parse(text) as { rate?: number };
    return typeof data.rate === 'number' && data.rate > 0 ? data.rate : DEFAULT_EXCHANGE_RATE;
  } catch {
    return DEFAULT_EXCHANGE_RATE;
  }
}

/** logicalName: multiCurrencySupport — 관리자 환율 수정 (전체 포트폴리오) */
export async function updateAdminExchangeRate(
  nickname: string,
  newRate: number,
  reason?: AdminExchangeRateUpdateReason
): Promise<AdminPriceUpdateResult> {
  if (!Number.isFinite(newRate) || newRate <= 0) {
    return { success: false, message: '유효한 환율을 입력해주세요.' };
  }

  try {
    const response = await fetch('/api/admin/update-exchange-rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: resolveAdminPassword(),
        nickname,
        newRate,
        reason,
      }),
    });

    return parseAdminApiResponse(response);
  } catch (error) {
    console.error('[updateAdminExchangeRate] failed:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : '환율 저장 중 오류가 발생했습니다.',
    };
  }
}

/** logicalName: adminAddAsset — 관리자 상품 추가 (전체 참여자 공유) */
export async function addAdminCustomAsset(input: {
  assetName: string;
  type: CustomAsset['type'];
  inputPrice: number | string;
  displayCurrency: DisplayCurrency;
  ticker?: string;
  sector?: string;
  market?: string;
  sourceUrl?: string;
  marketRegion?: AssetMarket;
}): Promise<AdminPriceUpdateResult & { asset?: CustomAsset }> {
  try {
    const response = await fetch('/api/admin/add-asset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: resolveAdminPassword(),
        ...input,
      }),
    });

    const text = await response.text();
    if (!text.trim()) {
      return {
        success: false,
        message: response.status === 404
          ? '관리자 API를 찾을 수 없습니다. npm run dev 로 서버를 재시작해주세요.'
          : `서버 응답이 비어 있습니다 (HTTP ${response.status}).`,
      };
    }

    const data = JSON.parse(text) as AdminPriceUpdateResult & { asset?: CustomAsset };
    if (!response.ok) {
      return {
        success: false,
        message: data.message || '상품 추가 중 오류가 발생했습니다.',
      };
    }
    return data;
  } catch (error) {
    console.error('[addAdminCustomAsset] failed:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : '상품 추가 중 오류가 발생했습니다.',
    };
  }
}

/** logicalName: realtimePriceApiPhase6 — 서버 실시간 시세 스냅샷 조회 */
export async function fetchRealtimePriceSnapshot(): Promise<RealtimePriceSnapshot> {
  const response = await fetch('/api/realtime-prices');
  if (!response.ok) {
    throw new Error('실시간 가격 조회에 실패했습니다.');
  }
  const data = (await response.json()) as RealtimePriceSnapshot & { success?: boolean };
  return {
    usdKrw: data.usdKrw ?? DEFAULT_EXCHANGE_RATE,
    updatedAt: data.updatedAt ?? null,
    prices: data.prices ?? {},
  };
}

/** logicalName: realtimePriceApiPhase6 — 특정 자산 실시간 시세 조회 */
export async function queryRealtimePrices(
  names: string[],
  options?: { forceRefresh?: boolean }
): Promise<RealtimePriceQuote[]> {
  const response = await fetch('/api/realtime-prices/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      names,
      forceRefresh: options?.forceRefresh ?? false,
    }),
  });

  if (!response.ok) {
    throw new Error('실시간 가격 조회에 실패했습니다.');
  }

  const data = (await response.json()) as { quotes?: RealtimePriceQuote[] };
  return data.quotes ?? [];
}

/** logicalName: realtimePriceApiPhase6 — 서버 캐시 수동 갱신 트리거 */
export async function refreshRealtimePrices(): Promise<RealtimePriceSnapshot> {
  const response = await fetch('/api/realtime-prices/refresh', { method: 'POST' });
  if (!response.ok) {
    throw new Error('실시간 가격 갱신에 실패했습니다.');
  }
  const data = (await response.json()) as RealtimePriceSnapshot;
  return {
    usdKrw: data.usdKrw ?? DEFAULT_EXCHANGE_RATE,
    updatedAt: data.updatedAt ?? null,
    prices: data.prices ?? {},
  };
}

/** logicalName: adminModeEnhancedPriceUpdate — 관리자 시세 수정 (assetId + reason) */
export async function updateAdminAssetPriceById(
  assetId: string,
  newPrice: number,
  reason: AdminPriceUpdateReason,
  asset?: CustomAsset
): Promise<AdminPriceUpdateResult> {
  const trimmedId = assetId.trim();
  if (!trimmedId) {
    return { success: false, message: '자산 ID가 필요합니다.' };
  }

  if (asset) {
    return updateAdminAssetPrice(asset, newPrice, reason);
  }

  return {
    success: false,
    message: '자산 정보가 필요합니다.',
  };
}

/** logicalName: adminModeEnhancedPriceUpdate — 관리자 시세 수정 (서버 API 경유) */
export async function updateAdminAssetPrice(
  asset: CustomAsset,
  newPrice: number,
  reason: AdminPriceUpdateReason
): Promise<AdminPriceUpdateResult> {
  const assetId = asset.id?.trim();
  if (!assetId) {
    return { success: false, message: '자산 ID가 필요합니다.' };
  }
  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    return { success: false, message: '유효한 가격을 입력해주세요.' };
  }

  try {
    const response = await fetch('/api/admin/update-asset-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: resolveAdminPassword(),
        asset: toAdminAssetPayload(asset),
        newPrice,
        reason,
      }),
    });

    const apiResult = await parseAdminApiResponse(response);
    if (apiResult.success) {
      return apiResult;
    }
    if (apiResult.shouldFallback) {
      console.info('[updateAdminAssetPrice] API unavailable — falling back to Firestore direct write');
      return updateAdminAssetPriceDirect(asset, newPrice, reason);
    }
    return apiResult;
  } catch (error) {
    console.warn('[updateAdminAssetPrice] API failed — falling back to Firestore direct write:', error);
    try {
      return await updateAdminAssetPriceDirect(asset, newPrice, reason);
    } catch (directError) {
      console.error('[updateAdminAssetPrice] direct write failed:', directError);
      const directMessage =
        directError instanceof Error ? directError.message : '저장 중 오류가 발생했습니다.';
      return {
        success: false,
        message: isFirestorePermissionError(directError)
          ? firestorePermissionHelpMessage()
          : directMessage,
      };
    }
  }
}

/** logicalName: deleteExistingAdminMode — Firestore marketPrices(customPrices) 구독 */
export function subscribeMarketPrices(
  onUpdate: (prices: MarketPriceMap) => void,
  onError?: (error: Error) => void
): () => void {
  let collectionPrices: MarketPriceMap = {};
  let sharedPrices: MarketPriceMap = {};

  const emit = () => {
    onUpdate(mergeMarketPriceMaps(collectionPrices, sharedPrices));
  };

  const unsubCollection = onSnapshot(
    query(collection(db, 'customPrices')),
    (snapshot) => {
      collectionPrices = {};
      snapshot.forEach((snapDoc) => {
        const data = snapDoc.data();
        const isAdminPrice =
          data.lastUpdatedBy === 'admin' || data.source === 'admin_override';
        if (!isAdminPrice) return;

        const value = data.price;
        if (typeof value === 'number' && Number.isFinite(value)) {
          collectionPrices[snapDoc.id] = value;
        }
      });
      emit();
    },
    (error) => {
      console.warn('[subscribeMarketPrices] collection listener error:', error);
      onError?.(error);
    }
  );

  const unsubShared = onSnapshot(
    sharedConfigRef(),
    (snapshot) => {
      sharedPrices = parseSharedMarketPrices(snapshot.data());
      emit();
    },
    (error) => {
      console.warn('[subscribeMarketPrices] shared config listener error:', error);
    }
  );

  return () => {
    unsubCollection();
    unsubShared();
  };
}

/** logicalName: deleteExistingAdminMode — 시세 수동 조정 저장 */
export async function upsertMarketPrice(assetName: string, priceKrw: number): Promise<void> {
  await setDoc(
    doc(db, 'customPrices', assetName.trim()),
    { price: priceKrw, updatedAt: new Date(), source: 'admin_override' },
    { merge: true }
  );
}

/** logicalName: deleteExistingAdminMode — 시세 조정 초기화 */
export async function deleteMarketPrice(assetName: string): Promise<void> {
  await deleteDoc(doc(db, 'customPrices', assetName.trim()));
}

/** @deprecated 실시간 API → Firestore 반영 비활성화 (관리자 수동 시세만 허용) */
export async function syncRealtimeQuotesToCustomPrices(
  _quotes: RealtimePriceQuote[]
): Promise<void> {
  console.warn(
    '[syncRealtimeQuotesToCustomPrices] skipped — 시세는 관리자 모드에서만 변경됩니다.'
  );
}

/** logicalName: initialPortfolioDataV1_2026-05-29 — 모의투자 1회차 초기 포트폴리오 시드 */
export const INITIAL_PORTFOLIO_SEED_LOGICAL_NAME = 'initialPortfolioDataV1_2026-05-29';

const INITIAL_SEED_EXCHANGE_RATE = 1500;
const INITIAL_SEED_DATE = '2026-05-29';
const INITIAL_SEED_TIMESTAMP = new Date('2026-05-29T00:00:00+09:00');

const SEED_ASSET_NAME_ALIASES: Record<string, string> = {
  알파벳: '알파벳 Class A',
  하이닉스: 'SK하이닉스',
  MS: '마이크로소프트',
};

interface InitialSeedBuyLine {
  label: string;
  priceKrwPerShare: number;
  quantity: number;
}

interface InitialSeedPortfolioConfig {
  nickname: string;
  savings: number;
  buys: InitialSeedBuyLine[];
}

const INITIAL_PORTFOLIO_SEED_DATA: InitialSeedPortfolioConfig[] = [
  {
    nickname: '한영준',
    savings: 318_040,
    buys: [
      { label: '알파벳', priceKrwPerShare: 570_510, quantity: 10 },
      { label: '시놉시스', priceKrwPerShare: 713_430, quantity: 2 },
      { label: '루멘텀 홀딩스', priceKrwPerShare: 1_275_000, quantity: 2 },
    ],
  },
  {
    nickname: '김민정',
    savings: 463_800,
    buys: [
      { label: '알파벳', priceKrwPerShare: 570_510, quantity: 3 },
      { label: '애플', priceKrwPerShare: 468_090, quantity: 2 },
      { label: '하이닉스', priceKrwPerShare: 2_350_000, quantity: 1 },
      { label: '마이크론', priceKrwPerShare: 1_456_500, quantity: 2 },
      { label: '엔비디아', priceKrwPerShare: 316_710, quantity: 3 },
      { label: 'MS', priceKrwPerShare: 675_360, quantity: 1 },
    ],
  },
  {
    nickname: '이준성',
    savings: 277_310,
    buys: [
      { label: '록히드마틴', priceKrwPerShare: 796_755, quantity: 5 },
      { label: 'TSMC', priceKrwPerShare: 627_675, quantity: 5 },
      { label: '알파벳', priceKrwPerShare: 570_510, quantity: 4 },
      { label: '삼성전자', priceKrwPerShare: 318_500, quantity: 1 },
    ],
  },
  {
    nickname: '이현우',
    savings: 584_260,
    buys: [
      { label: '마이크론', priceKrwPerShare: 1_456_500, quantity: 4 },
      { label: '테슬라', priceKrwPerShare: 653_685, quantity: 4 },
      { label: 'SCHD', priceKrwPerShare: 48_750, quantity: 20 },
    ],
  },
];

function resolveSeedAssetName(label: string): string {
  return SEED_ASSET_NAME_ALIASES[label.trim()] ?? label.trim();
}

function resolveSeedAssetDocId(resolvedName: string): string {
  const preset = getPresetByName(resolvedName);
  if (preset) {
    return `${PRESET_ASSET_ID_PREFIX}${sanitizeDocId(preset.name)}`;
  }
  return sanitizeDocId(resolvedName);
}

function seedUsdFromKrw(priceKrwPerShare: number): number {
  return Math.round((priceKrwPerShare / INITIAL_SEED_EXCHANGE_RATE) * 100) / 100;
}

function createInitialSeedPurchaseRecord(options: {
  assetDocId: string;
  quantity: number;
  pricePerUnit: number;
  amountInKrw: number;
  isUsBuy: boolean;
}): PurchaseRecord {
  const { assetDocId, quantity, pricePerUnit, amountInKrw, isUsBuy } = options;
  return {
    id: `initial_20260529_buy_${sanitizeDocId(assetDocId)}`,
    type: 'BUY',
    quantity,
    price: pricePerUnit,
    amount: isUsBuy ? pricePerUnit : amountInKrw,
    exchangeRateAtTransaction: isUsBuy ? INITIAL_SEED_EXCHANGE_RATE : undefined,
    amountInKRW: amountInKrw,
    timestamp: INITIAL_SEED_TIMESTAMP,
    date: INITIAL_SEED_DATE,
  };
}

function buildInitialSeedAssetItem(buy: InitialSeedBuyLine): AssetItem {
  const name = resolveSeedAssetName(buy.label);
  const preset = getPresetByName(name);
  const type = (preset?.type ?? 'stock') as AssetType;
  const region = inferAssetMarketRegion(name, type);
  const isUsBuy = region === 'US';
  const amountInKrw = buy.priceKrwPerShare * buy.quantity;
  const assetDocId = resolveSeedAssetDocId(name);

  if (isUsBuy) {
    const priceUsd = seedUsdFromKrw(buy.priceKrwPerShare);
    const buyRecord = createInitialSeedPurchaseRecord({
      assetDocId,
      quantity: buy.quantity,
      pricePerUnit: priceUsd,
      amountInKrw,
      isUsBuy: true,
    });
    const usFields = buildUsAssetOnFirstBuy(
      buy.priceKrwPerShare,
      priceUsd,
      INITIAL_SEED_EXCHANGE_RATE,
      buy.quantity
    );
    return stripUndefinedDeep({
      name,
      type,
      quantity: buy.quantity,
      market: 'US' as AssetMarket,
      displayCurrency: 'USD' as DisplayCurrency,
      marketGroup: inferAssetMarket(name, type),
      sector: inferAssetSector(name, type),
      purchaseHistory: [buyRecord],
      ...usFields,
    });
  }

  const buyRecord = createInitialSeedPurchaseRecord({
    assetDocId,
    quantity: buy.quantity,
    pricePerUnit: buy.priceKrwPerShare,
    amountInKrw,
    isUsBuy: false,
  });

  return stripUndefinedDeep(
    enrichAssetCurrencyFields(
      {
        name,
        type,
        price: buy.priceKrwPerShare,
        quantity: buy.quantity,
        currentPrice: buy.priceKrwPerShare,
        totalPurchaseAmount: amountInKrw,
        market: region,
        displayCurrency: 'KRW' as DisplayCurrency,
        priceKRW: buy.priceKrwPerShare,
        marketGroup: inferAssetMarket(name, type),
        sector: inferAssetSector(name, type),
        purchaseHistory: [buyRecord],
      },
      INITIAL_SEED_EXCHANGE_RATE
    )
  );
}

function buildInitialSeedTransaction(
  buy: InitialSeedBuyLine,
  assetItem: AssetItem
): Transaction {
  const name = resolveSeedAssetName(buy.label);
  const preset = getPresetByName(name);
  const region = inferAssetMarketRegion(name, preset?.type ?? 'stock');
  const isUsBuy = region === 'US';
  const amountInKrw = buy.priceKrwPerShare * buy.quantity;
  const assetDocId = resolveSeedAssetDocId(name);
  const buyRecord = assetItem.purchaseHistory?.[0];

  return stripUndefinedDeep({
    id: buyRecord?.id ?? `initial_20260529_tx_${sanitizeDocId(assetDocId)}`,
    assetName: name,
    type: 'BUY',
    quantity: buy.quantity,
    price: isUsBuy ? seedUsdFromKrw(buy.priceKrwPerShare) : buy.priceKrwPerShare,
    totalAmount: amountInKrw,
    ...(preset?.ticker ? { ticker: preset.ticker } : {}),
    ...(isUsBuy
      ? {
          priceUsd: seedUsdFromKrw(buy.priceKrwPerShare),
          exchangeRateAtPurchase: INITIAL_SEED_EXCHANGE_RATE,
          amountInKRW: amountInKrw,
        }
      : {}),
    transactionDate: INITIAL_SEED_DATE,
    timestamp: INITIAL_SEED_TIMESTAMP,
  });
}

async function upsertInitialSeedCustomAsset(
  buy: InitialSeedBuyLine
): Promise<void> {
  const name = resolveSeedAssetName(buy.label);
  const preset = getPresetByName(name);
  const type = (preset?.type ?? 'stock') as CustomAsset['type'];
  const region: AssetMarket = isForeignPresetName(name)
    ? 'US'
    : inferAssetMarketRegion(name, type);
  const displayCurrency = getDefaultDisplayCurrency(region);
  const docId = resolveSeedAssetDocId(name);
  const priceUsd = displayCurrency === 'USD' ? seedUsdFromKrw(buy.priceKrwPerShare) : undefined;

  await setDoc(
    doc(db, 'customAssets', docId),
    stripUndefinedDeep({
      id: docId,
      name,
      type,
      price: buy.priceKrwPerShare,
      ...(priceUsd != null ? { priceUSD: priceUsd } : {}),
      ...(displayCurrency === 'KRW' ? { priceKRW: buy.priceKrwPerShare } : {}),
      ...(preset?.ticker ? { ticker: preset.ticker } : {}),
      marketRegion: region,
      displayCurrency,
      market:
        region === 'Korea' ? '국내 주식' : region === 'US' ? '미국 주식' : '암호화폐',
      addedBy: 'system',
      addedAt: INITIAL_SEED_TIMESTAMP,
      priceSource: 'admin',
      lastUpdatedBy: 'admin',
      lastUpdatedAt: INITIAL_SEED_TIMESTAMP,
      updateReason: '데이터 정정',
    }),
    { merge: true }
  );
}

async function seedSingleInitialPortfolio(
  config: InitialSeedPortfolioConfig
): Promise<void> {
  const initialCapital = PORTFOLIO_STARTING_CAPITAL;
  const assets = config.buys.map((buy) => buildInitialSeedAssetItem(buy));
  const transactions = config.buys.map((buy, index) =>
    buildInitialSeedTransaction(buy, assets[index])
  );
  const catalogPrices = buildCatalogPriceMap([], INITIAL_SEED_EXCHANGE_RATE);
  const buyTotalKrw = config.buys.reduce(
    (sum, buy) => sum + buy.priceKrwPerShare * buy.quantity,
    0
  );
  const portfolioValues = updatePortfolioValues(
    assets,
    config.savings,
    initialCapital,
    {},
    INITIAL_SEED_EXCHANGE_RATE,
    catalogPrices
  );

  await setDoc(
    doc(db, 'portfolios', config.nickname),
    stripUndefinedDeep({
      nickname: config.nickname,
      assets: portfolioValues.assets,
      savings: config.savings,
      exchangeRate: INITIAL_SEED_EXCHANGE_RATE,
      lastExchangeRateUpdate: INITIAL_SEED_TIMESTAMP,
      initialCapital,
      totalCurrentValue: buyTotalKrw,
      profitAmount: 0,
      profitRate: 0,
      totalAssets: config.savings + buyTotalKrw,
      totalProfitAmount: 0,
      totalProfitRate: 0,
      totalPurchaseAmount: buyTotalKrw,
      cumulativeRealizedProfit: 0,
      totalBudget: initialCapital,
      hasRealPrices: false,
      transactions,
      updatedAt: INITIAL_SEED_TIMESTAMP,
      reason: INITIAL_PORTFOLIO_SEED_LOGICAL_NAME,
    })
  );
}

/** logicalName: initialPortfolioDataV1_2026-05-29 — 4명 초기 포트폴리오 + customAssets 일괄 입력 */
export async function seedInitialPortfolios20260529(): Promise<{
  success: boolean;
  message: string;
  logicalName: string;
  seededNicknames: string[];
}> {
  const seededNicknames: string[] = [];
  const seenCustomAssets = new Set<string>();

  try {
    for (const config of INITIAL_PORTFOLIO_SEED_DATA) {
      await seedSingleInitialPortfolio(config);
      seededNicknames.push(config.nickname);

      for (const buy of config.buys) {
        const name = resolveSeedAssetName(buy.label);
        if (seenCustomAssets.has(name)) continue;
        seenCustomAssets.add(name);
        await upsertInitialSeedCustomAsset(buy);
      }
    }

    await setDoc(
      sharedConfigRef(),
      stripUndefinedDeep({
        nickname: SHARED_CONFIG_DOC_ID,
        assets: [],
        savings: 0,
        totalCurrentValue: 0,
        profitRate: 0,
        profitAmount: 0,
        hasRealPrices: false,
        exchangeRate: INITIAL_SEED_EXCHANGE_RATE,
        updatedAt: INITIAL_SEED_TIMESTAMP,
      }),
      { merge: true }
    );

    await setDoc(
      globalSettingsRef(),
      stripUndefinedDeep({
        exchangeRate: INITIAL_SEED_EXCHANGE_RATE,
        updatedAt: INITIAL_SEED_TIMESTAMP,
      }),
      { merge: true }
    );

    return {
      success: true,
      logicalName: INITIAL_PORTFOLIO_SEED_LOGICAL_NAME,
      seededNicknames,
      message: `✅ 초기 포트폴리오 ${seededNicknames.length}명 입력 완료 (${seededNicknames.join(', ')})`,
    };
  } catch (error) {
    console.error(`[${INITIAL_PORTFOLIO_SEED_LOGICAL_NAME}] failed:`, error);
    return {
      success: false,
      logicalName: INITIAL_PORTFOLIO_SEED_LOGICAL_NAME,
      seededNicknames,
      message: error instanceof Error ? error.message : '초기 포트폴리오 입력 중 오류가 발생했습니다.',
    };
  }
}

/** logicalName: initialPortfolioDataV1_2026-05-29 — 5/29 기준 종목별 매수가 (KRW/주) */
export const REFERENCE_PURCHASE_PRICES_KRW_20260529: Record<string, number> = {
  'SK하이닉스': 2_350_000,
  삼성전자: 318_500,
  현대차: 733_000,
  두산에너빌리티: 106_805,
  'TIGER 반도체TOP10': 50_450,
  'KODEX 미국S&P500': 25_800,
  'KODEX 미국나스닥100': 30_250,
  AMD: 774_150,
  '알파벳 Class A': 570_510,
  아마존: 405_960,
  애플: 468_090,
  브로드컴: 670_155,
  메타: 948_765,
  마이크로소프트: 675_360,
  마이크론: 1_456_500,
  엔비디아: 316_710,
  팔란티어: 234_810,
  SPY: 1_134_720,
  SCHD: 48_750,
  시놉시스: 713_430,
  TSMC: 627_675,
  VOO: 1_043_235,
  ASML: 2_419_500,
  GLD: 625_215,
  '노키아 ADR': 22_380,
  록히드마틴: 796_755,
  '루멘텀 홀딩스': 1_275_000,
  브룩필드: 68_385,
};

function lookupReferencePurchasePriceKrw(assetName: string): number | undefined {
  const canonical = resolveSeedAssetName(assetName);
  return (
    REFERENCE_PURCHASE_PRICES_KRW_20260529[canonical] ??
    REFERENCE_PURCHASE_PRICES_KRW_20260529[assetName.trim()]
  );
}

function applyReferencePriceToAssetItem(
  asset: AssetItem,
  exchangeRate: number = INITIAL_SEED_EXCHANGE_RATE
): AssetItem {
  const canonicalName = resolveSeedAssetName(asset.name);
  const refKrw = lookupReferencePurchasePriceKrw(asset.name);
  if (refKrw == null) {
    return stripUndefinedDeep({ ...asset, name: canonicalName });
  }

  const preset = getPresetByName(canonicalName);
  const type = (asset.type ?? preset?.type ?? 'stock') as AssetType;
  const region = inferAssetMarketRegion(canonicalName, type);
  const quantity = asset.quantity;
  const amountInKrw = refKrw * quantity;
  const assetDocId = resolveSeedAssetDocId(canonicalName);
  const currentPrice = asset.currentPrice ?? refKrw;

  if (region === 'US') {
    const priceUsd = seedUsdFromKrw(refKrw);
    const usFields = buildUsAssetOnFirstBuy(refKrw, priceUsd, exchangeRate, quantity);
    const buyRecord = createInitialSeedPurchaseRecord({
      assetDocId,
      quantity,
      pricePerUnit: priceUsd,
      amountInKrw,
      isUsBuy: true,
    });
    return stripUndefinedDeep({
      ...asset,
      name: canonicalName,
      type,
      quantity,
      market: 'US' as AssetMarket,
      displayCurrency: 'USD' as DisplayCurrency,
      marketGroup: inferAssetMarket(canonicalName, type),
      sector: inferAssetSector(canonicalName, type),
      currentPrice,
      purchaseHistory: [buyRecord],
      ...usFields,
    });
  }

  const buyRecord = createInitialSeedPurchaseRecord({
    assetDocId,
    quantity,
    pricePerUnit: refKrw,
    amountInKrw,
    isUsBuy: false,
  });

  return stripUndefinedDeep(
    enrichAssetCurrencyFields(
      {
        ...asset,
        name: canonicalName,
        type,
        price: refKrw,
        quantity,
        currentPrice,
        totalPurchaseAmount: amountInKrw,
        market: region,
        displayCurrency: 'KRW' as DisplayCurrency,
        priceKRW: refKrw,
        marketGroup: inferAssetMarket(canonicalName, type),
        sector: inferAssetSector(canonicalName, type),
        purchaseHistory: [buyRecord],
      },
      exchangeRate
    )
  );
}

function rebuild529TransactionsFromAssets(assets: AssetItem[]): Transaction[] {
  return assets.map((asset) => buildInitialSeedTransaction(
    {
      label: asset.name,
      priceKrwPerShare: lookupReferencePurchasePriceKrw(asset.name) ?? asset.price,
      quantity: asset.quantity,
    },
    asset
  ));
}

/** logicalName: initialPortfolioDataV1_2026-05-29 — 기존 포트폴리오에 5/29 매수가·USD 메타 반영 */
export async function apply529ReferencePricesToPortfolios(
  nicknames: string[]
): Promise<{ success: boolean; message: string; updated: string[] }> {
  const updated: string[] = [];

  try {
    for (const nickname of nicknames) {
      const trimmed = nickname.trim();
      if (!trimmed) continue;

      const snap = await getDoc(doc(db, 'portfolios', trimmed));
      if (!snap.exists()) continue;

      const portfolio = { nickname: trimmed, ...snap.data() } as Portfolio;
      const exchangeRate = portfolio.exchangeRate ?? INITIAL_SEED_EXCHANGE_RATE;
      const assets = (portfolio.assets ?? []).map((asset) =>
        applyReferencePriceToAssetItem(asset, exchangeRate)
      );
      const buyTotalKrw = assets.reduce(
        (sum, asset) => sum + getTotalPurchaseAmountKrw(asset, exchangeRate),
        0
      );
      const savings = portfolio.savings ?? Math.max(0, PORTFOLIO_STARTING_CAPITAL - buyTotalKrw);
      const initialCapital = resolveInitialCapital(portfolio);
      const portfolioValues = updatePortfolioValues(
        assets,
        savings,
        initialCapital,
        {},
        exchangeRate,
        buildCatalogPriceMap([], exchangeRate)
      );

      await setDoc(
        doc(db, 'portfolios', trimmed),
        stripUndefinedDeep({
          ...portfolio,
          nickname: trimmed,
          assets: portfolioValues.assets,
          savings,
          exchangeRate: INITIAL_SEED_EXCHANGE_RATE,
          lastExchangeRateUpdate: INITIAL_SEED_TIMESTAMP,
          totalCurrentValue: buyTotalKrw,
          totalPurchaseAmount: buyTotalKrw,
          totalAssets: savings + buyTotalKrw,
          profitAmount: 0,
          profitRate: 0,
          totalProfitAmount: 0,
          totalProfitRate: 0,
          transactions: rebuild529TransactionsFromAssets(assets),
          updatedAt: INITIAL_SEED_TIMESTAMP,
        })
      );
      updated.push(trimmed);
    }

    return {
      success: true,
      updated,
      message: `✅ 5/29 매수가 반영 완료: ${updated.join(', ') || '(없음)'}`,
    };
  } catch (error) {
    console.error('[apply529ReferencePricesToPortfolios] failed:', error);
    return {
      success: false,
      updated,
      message: error instanceof Error ? error.message : '매수가 반영 중 오류가 발생했습니다.',
    };
  }
}

/** 【범용 가격 업데이트】 매 회차마다 재사용 — 브라우저 콘솔: await window.updateAssetPricesForSession?.(batch) */
export interface PriceUpdateEntry {
  usd?: number;
  krw: number;
}

export interface PriceUpdateBatch {
  sessionDate: string;
  exchangeRate?: number;
  priceUpdates: Record<string, PriceUpdateEntry>;
}

export interface PriceUpdateLogEntry {
  name: string;
  type: 'USD' | 'KRW';
  oldPrice?: number;
  newPrice: number;
  changePercent: string;
}

const PRICE_UPDATE_NAME_ALIASES: Record<string, string> = {
  알파벳: '알파벳 Class A',
};

function resolveBulkPriceUpdateName(rawName: string): string {
  const trimmed = rawName.trim();
  const alias = PRICE_UPDATE_NAME_ALIASES[trimmed];
  if (alias) return alias;
  const preset = getPresetByName(trimmed);
  return preset?.name ?? trimmed;
}

function lookupSessionPriceUpdate(
  assetName: string,
  priceUpdates: Record<string, PriceUpdateEntry>
): { canonicalName: string; update: PriceUpdateEntry } | null {
  const target = resolveBulkPriceUpdateName(assetName).toLowerCase();
  for (const [key, update] of Object.entries(priceUpdates)) {
    const canonical = resolveBulkPriceUpdateName(key);
    if (canonical.toLowerCase() === target) {
      return { canonicalName: canonical, update };
    }
  }
  return null;
}

function formatChangePercent(oldValue: number | undefined, newValue: number): string {
  if (oldValue == null || oldValue <= 0) return 'N/A';
  return (((newValue - oldValue) / oldValue) * 100).toFixed(2);
}

async function applySessionExchangeRate(
  exchangeRate: number,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return;
  const now = new Date();
  await setDoc(
    sharedConfigRef(),
    stripUndefinedDeep({
      exchangeRate,
      lastExchangeRateUpdate: now,
      lastUpdatedBy: 'admin',
      updatedAt: now,
    }),
    { merge: true }
  );
  await setDoc(
    globalSettingsRef(),
    stripUndefinedDeep({
      exchangeRate,
      lastExchangeRateUpdate: now,
    }),
    { merge: true }
  );
}

async function applySessionPriceUpdate(
  canonicalName: string,
  update: PriceUpdateEntry,
  sessionDate: string,
  exchangeRate: number,
  dryRun: boolean,
  targetDocId?: string
): Promise<{ oldPrice?: number; oldPriceUSD?: number; isUsd: boolean }> {
  const preset = getPresetByName(canonicalName);
  const type = (preset?.type ?? 'stock') as CustomAsset['type'];
  const marketRegion: AssetMarket = isForeignPresetName(canonicalName)
    ? 'US'
    : inferAssetMarketRegion(canonicalName, type);
  const isUsdAsset =
    update.usd != null &&
    update.usd > 0 &&
    (isForeignPresetName(canonicalName) || marketRegion === 'US');
  const displayCurrency: DisplayCurrency = isUsdAsset ? 'USD' : 'KRW';

  const docId = targetDocId ?? resolveSeedAssetDocId(canonicalName);
  const snap = await getDoc(doc(db, 'customAssets', docId));
  const existing = snap.exists() ? (snap.data() as CustomAsset) : undefined;
  const oldPrice = existing?.price;
  const oldPriceUSD = existing?.priceUSD;

  if (dryRun) {
    return { oldPrice, oldPriceUSD, isUsd: isUsdAsset };
  }

  const now = new Date();
  const updateReason = `${sessionDate} 회차 가격 일괄 업데이트` as AdminPriceUpdateReason;
  const meta = {
    lastUpdatedBy: 'admin' as const,
    lastUpdatedAt: now,
    updateReason,
    priceSource: 'admin',
    lastPriceUpdatedAt: now,
    sessionDate,
  };

  const payload: Partial<CustomAsset> = {
    ...meta,
    name: canonicalName,
    type,
    marketRegion: isUsdAsset ? 'US' : marketRegion,
    displayCurrency,
    market: isUsdAsset
      ? '미국 주식'
      : marketRegion === 'Korea'
        ? '국내 주식'
        : '암호화폐',
    ...(preset?.ticker ? { ticker: preset.ticker } : {}),
  };

  if (isUsdAsset && update.usd != null) {
    payload.priceUSD = update.usd;
    payload.price = Math.round(update.krw);
  } else {
    payload.priceKRW = update.krw;
    payload.price = Math.round(update.krw);
  }

  const priceKrw = payload.price!;

  await setDoc(
    doc(db, 'customPrices', canonicalName),
    {
      price: priceKrw,
      updatedAt: now,
      source: 'admin_override',
      lastUpdatedBy: 'admin',
      updateReason,
      sessionDate,
    },
    { merge: true }
  );

  await writeSharedMarketPriceClient(canonicalName, priceKrw);

  await setDoc(
    doc(db, 'customAssets', docId),
    stripUndefinedDeep({
      id: docId,
      addedBy: existing?.addedBy ?? 'admin',
      addedAt: existing?.addedAt ?? now,
      ...payload,
    }),
    { merge: true }
  );

  return { oldPrice, oldPriceUSD, isUsd: isUsdAsset };
}

export async function updateAssetPricesForSession(
  batch: PriceUpdateBatch,
  options?: { dryRun?: boolean }
): Promise<{ updateCount: number; updateLog: PriceUpdateLogEntry[] }> {
  const { sessionDate, exchangeRate: batchExchangeRate, priceUpdates } = batch;
  const isDryRun = options?.dryRun ?? false;
  const exchangeRate = batchExchangeRate ?? (await getGlobalExchangeRate());

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📋 가격 업데이트 배치 (${sessionDate})`);
  console.log(`${'='.repeat(60)}`);
  if (isDryRun) console.log('🔍 [드라이런 모드] 실제 저장 안 함');
  console.log('\n');

  let updateCount = 0;
  const updateLog: PriceUpdateLogEntry[] = [];
  const processedDocIds = new Set<string>();
  const processedCanonical = new Set<string>();

  const recordUpdate = async (
    canonicalName: string,
    update: PriceUpdateEntry,
    docId?: string
  ): Promise<void> => {
    const key = canonicalName.toLowerCase();
    if (processedCanonical.has(key) && !docId) return;

    const resolvedDocId = docId ?? resolveSeedAssetDocId(canonicalName);
    if (processedDocIds.has(resolvedDocId)) return;

    const { oldPrice, oldPriceUSD, isUsd } = await applySessionPriceUpdate(
      canonicalName,
      update,
      sessionDate,
      exchangeRate,
      isDryRun,
      docId
    );

    if (isUsd && update.usd != null) {
      const changePercent = formatChangePercent(oldPriceUSD, update.usd);
      console.log(`✅ ${canonicalName} (USD)`);
      console.log(`   ${oldPriceUSD ?? 'N/A'} USD → ${update.usd} USD (${changePercent}%)`);
      console.log(`   ${oldPrice ?? 'N/A'}원 → ${update.krw}원`);
      updateLog.push({
        name: canonicalName,
        type: 'USD',
        oldPrice: oldPriceUSD,
        newPrice: update.usd,
        changePercent,
      });
    } else {
      const changePercent = formatChangePercent(oldPrice, update.krw);
      console.log(`✅ ${canonicalName} (KRW)`);
      console.log(`   ${oldPrice ?? 'N/A'}원 → ${update.krw}원 (${changePercent}%)`);
      updateLog.push({
        name: canonicalName,
        type: 'KRW',
        oldPrice: oldPrice,
        newPrice: update.krw,
        changePercent,
      });
    }

    processedDocIds.add(resolvedDocId);
    processedCanonical.add(key);
    updateCount++;
  };

  for (const [assetName, update] of Object.entries(priceUpdates)) {
    try {
      const canonicalName = resolveBulkPriceUpdateName(assetName);
      await recordUpdate(canonicalName, update);
    } catch (error) {
      console.warn(`⚠️ ${assetName} 업데이트 실패:`, error);
    }
  }

  const customSnap = await getDocs(collection(db, 'customAssets'));
  for (const docSnap of customSnap.docs) {
    const raw = docSnap.data() as CustomAsset & { assetName?: string };
    const assetName = (raw.name ?? raw.assetName ?? '').trim();
    if (!assetName) continue;

    const match = lookupSessionPriceUpdate(assetName, priceUpdates);
    if (!match) continue;
    if (processedDocIds.has(docSnap.id)) continue;

    try {
      await recordUpdate(match.canonicalName, match.update, docSnap.id);
    } catch (error) {
      console.warn(`⚠️ ${assetName} (추가 doc) 업데이트 실패:`, error);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(
    `📊 요약: 총 ${updateCount}개 자산 업데이트${isDryRun ? ' (미실행)' : ' (저장됨)'}`
  );
  console.log(`${'='.repeat(60)}\n`);

  // 환율 업데이트 (임시 비활성화 - 보안 규칙 수정 후 재활성화)
  /*
  if (batchExchangeRate != null && batchExchangeRate > 0) {
    console.log(`\n💱 환율 업데이트: ${batchExchangeRate}원/USD`);
    if (!isDryRun) {
      await applySessionExchangeRate(batchExchangeRate, false);
      console.log('✅ 환율 저장됨');
    }
  }
  */

  if (!isDryRun) {
    console.log('\n⏳ 포트폴리오 재계산 중...');
    await recalculateAllPortfolios();
    console.log('✅ 모든 포트폴리오 손익 재계산 완료!\n');
  } else {
    console.log('\n💡 드라이런 완료. 문제없으면 { dryRun: false }로 실행하세요.\n');
  }

  return { updateCount, updateLog };
}

/** 6/13 회차 catalog 시세 (KRW 또는 USD) — updateAssetPricesForSession용 레거시 맵 */
const PRICE_UPDATES_20260613: Record<string, number> = {
  SK하이닉스: 2_150_000,
  삼성전자: 322_500,
  현대차: 607_000,
  두산에너빌리티: 106_805,
  LG화학: 358_000,
  NAVER: 212_000,
  카카오: 45_800,
  셀트리온: 189_500,
  'TIGER 반도체TOP10': 53_000,
  'KODEX 미국S&P500': 25_420,
  'KODEX 미국나스닥100': 29_645,
  AMD: 511.57,
  '알파벳 Class A': 359.68,
  아마존: 238.55,
  애플: 291.13,
  브로드컴: 382.07,
  메타: 566.98,
  마이크로소프트: 390.74,
  마이크론: 981.61,
  엔비디아: 205.19,
  팔란티어: 127.99,
  시놉시스: 453.89,
  TSMC: 423.93,
  테슬라: 420.0,
  ASML: 1_863.55,
  '노키아 ADR': 14.08,
  록히드마틴: 540.33,
  '루멘텀 홀딩스': 921.56,
  브룩필드: 45.21,
  '스페이스 X': 106.95,
  SPY: 741.75,
  SCHD: 32.82,
  VOO: 681.95,
  GLD: 386.54,
};

function build613PriceUpdateBatch(): PriceUpdateBatch {
  const priceUpdates: Record<string, PriceUpdateEntry> = {};
  for (const [name, price] of Object.entries(PRICE_UPDATES_20260613)) {
    if (isForeignPresetName(name)) {
      priceUpdates[name] = {
        usd: price,
        krw: Math.round(price * DEFAULT_EXCHANGE_RATE),
      };
    } else {
      priceUpdates[name] = { krw: price };
    }
  }
  return { sessionDate: '2026-06-13', priceUpdates };
}

/** 【6/13 가격 일괄 업데이트】 — 브라우저 콘솔: await window.updatePricesFor20260613?.() */
export async function updatePricesFor20260613(): Promise<{ updateCount: number }> {
  const result = await updateAssetPricesForSession(build613PriceUpdateBatch());
  return { updateCount: result.updateCount };
}

/** 모든 포트폴리오 조회 */
export async function getAllPortfolios(): Promise<Portfolio[]> {
  const snap = await getDocs(collection(db, 'portfolios'));
  const results: Portfolio[] = [];
  snap.forEach((docSnap) => {
    if (docSnap.id === SHARED_CONFIG_DOC_ID) return;
    results.push({
      nickname: docSnap.id,
      ...(docSnap.data() as Omit<Portfolio, 'nickname'>),
    });
  });
  return results;
}

/** 모든 포트폴리오 손익·평가액 재계산 */
export async function recalculateAllPortfolios(): Promise<{ portfolioCount: number }> {
  const exchangeRate = await getGlobalExchangeRate();
  const customAssets = await getAllCommunityCustomAssets();
  const catalogPrices = buildCatalogPriceMap(customAssets, exchangeRate);
  const sharedSnap = await getDoc(sharedConfigRef());
  const marketPrices = parseSharedMarketPrices(sharedSnap.data());

  const portfolios = await getAllPortfolios();
  console.log(`\n${portfolios.length}개 포트폴리오 재계산 중...`);

  for (const portfolio of portfolios) {
    const portfolioExchangeRate = portfolio.exchangeRate ?? exchangeRate;
    const updated = recalculatePortfolioValues(
      portfolio,
      marketPrices,
      catalogPrices,
      portfolioExchangeRate
    );

    await setDoc(
      doc(db, 'portfolios', portfolio.nickname),
      stripUndefinedDeep({
        assets: updated.assets,
        totalCurrentValue: updated.totalCurrentValue,
        totalUnrealizedProfit: updated.totalUnrealizedProfit,
        totalRealizedProfit: updated.totalRealizedProfit,
        totalAssets: updated.totalAssets,
        totalProfitAmount: updated.totalProfitAmount,
        totalProfitRate: updated.totalProfitRate,
        profitAmount: updated.profitAmount,
        profitRate: updated.profitRate,
        totalPurchaseAmount: updated.totalPurchaseAmount,
        updatedAt: new Date(),
      }),
      { merge: true }
    );

    console.log(`✅ ${portfolio.nickname} 재계산 완료`);
  }

  return { portfolioCount: portfolios.length };
}

const MICRON_TESLA_MARKET_FIX_TARGETS = ['마이크론', '테슬라'] as const;

/** Firestore customAssets — 마이크론·테슬라 marketRegion을 US로 정정 */
export async function fixMicronTeslaMarketRegionInFirestore(): Promise<{
  updated: string[];
}> {
  const updated: string[] = [];
  const now = new Date();
  const exchangeRate = await getGlobalExchangeRate();

  const applyFix = async (docId: string, raw: CustomAsset): Promise<void> => {
    const name = raw.name?.trim();
    if (!name || !MICRON_TESLA_MARKET_FIX_TARGETS.includes(name as (typeof MICRON_TESLA_MARKET_FIX_TARGETS)[number])) {
      return;
    }
    if (raw.marketRegion === 'US' && raw.displayCurrency === 'USD') return;

    const preset = getPresetByName(name);
    const priceUSD =
      sanitizeNumeric(raw.priceUSD) && sanitizeNumeric(raw.priceUSD)! > 0
        ? sanitizeNumeric(raw.priceUSD)!
        : preset?.usdPrice;

    await setDoc(
      doc(db, 'customAssets', docId),
      stripUndefinedDeep({
        marketRegion: 'US',
        displayCurrency: 'USD',
        market: '미국 주식',
        ...(priceUSD != null && priceUSD > 0
          ? {
              priceUSD,
              price: Math.round(computeKrwEquivalent('USD', priceUSD, exchangeRate)),
            }
          : {}),
        lastUpdatedBy: 'admin',
        lastUpdatedAt: now,
        updateReason: '데이터 정정',
      }),
      { merge: true }
    );

    if (!updated.includes(name)) updated.push(name);
    console.log(`✅ ${name} → marketRegion: US`);
  };

  for (const name of MICRON_TESLA_MARKET_FIX_TARGETS) {
    const docId = resolveSeedAssetDocId(name);
    const snap = await getDoc(doc(db, 'customAssets', docId));
    if (snap.exists()) {
      await applyFix(docId, { ...(snap.data() as CustomAsset), id: docId });
    }
  }

  const customSnap = await getDocs(collection(db, 'customAssets'));
  for (const docSnap of customSnap.docs) {
    const raw = docSnap.data() as CustomAsset;
    await applyFix(docSnap.id, { ...raw, id: docSnap.id });
  }

  console.log(`\n총 ${updated.length}개 자산 marketRegion US로 정정 완료`);
  return { updated };
}

if (typeof window !== 'undefined') {
  window.updatePricesFor20260613 = updatePricesFor20260613;
  window.updateAssetPricesForSession = updateAssetPricesForSession;
  window.recalculateAllPortfolios = recalculateAllPortfolios;
  window.fixMicronTeslaMarketRegionInFirestore = fixMicronTeslaMarketRegionInFirestore;
}
