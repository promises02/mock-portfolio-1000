/** logicalName: adminAddAsset — 관리자 상품 추가 (전체 참여자 공유) */
import { doc, setDoc, serverDb } from './firestoreServer';
import { getAdminExchangeRateOnServer } from './adminExchangeRateAPI';
import { appendSharedCustomAsset, tryWriteCollection } from './sharedConfigStore';
import { AssetMarket, CustomAsset, DisplayCurrency } from '../src/types';
import {
  computeKrwEquivalent,
  getDefaultDisplayCurrency,
  inferAssetMarketRegion,
} from '../src/utils';

function sanitizeDocId(value: string): string {
  return value.replace(/\s+/g, '_').replace(/[/\\.#$[\]]/g, '_');
}

function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined) return value;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => stripUndefinedDeep(item)) as T;

  const input = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(input)) {
    if (nested !== undefined) result[key] = stripUndefinedDeep(nested);
  }
  return result as T;
}

export interface AdminAddAssetInput {
  assetName: string;
  type: CustomAsset['type'];
  inputPrice: number | string;
  displayCurrency: DisplayCurrency;
  ticker?: string;
  sector?: string;
  market?: string;
  sourceUrl?: string;
  marketRegion?: AssetMarket;
}

export async function addAdminAssetOnServer(
  input: AdminAddAssetInput
): Promise<{ success: boolean; message: string; asset?: CustomAsset }> {
  const trimmedName = input.assetName?.trim();
  if (!trimmedName) {
    return { success: false, message: '자산명을 입력해주세요.' };
  }

  const numericPrice =
    typeof input.inputPrice === 'string' ? parseFloat(input.inputPrice) : input.inputPrice;
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    return { success: false, message: '올바른 가격을 입력해주세요.' };
  }

  const resolvedMarketRegion =
    input.marketRegion ?? inferAssetMarketRegion(trimmedName, input.type);
  const displayCurrency =
    input.displayCurrency ?? getDefaultDisplayCurrency(resolvedMarketRegion);
  const exchangeRate = await getAdminExchangeRateOnServer();
  const now = new Date();
  const timestamp = Date.now();
  const id = sanitizeDocId(`${trimmedName}_admin_${timestamp}`);

  let priceUSD: number | undefined;
  let priceKRW: number | undefined;
  let priceCrypto: string | undefined;

  if (displayCurrency === 'USD') {
    priceUSD = numericPrice;
  } else if (displayCurrency === 'KRW') {
    priceKRW = Math.round(numericPrice);
  } else {
    priceCrypto = String(input.inputPrice).trim();
  }

  const price = Math.round(
    computeKrwEquivalent(displayCurrency, numericPrice, exchangeRate)
  );

  const asset: CustomAsset = stripUndefinedDeep({
    id,
    name: trimmedName,
    type: input.type,
    price,
    quantity: 1,
    addedBy: 'admin',
    addedAt: now,
    marketRegion: resolvedMarketRegion,
    displayCurrency,
    priceUSD,
    priceKRW,
    priceCrypto,
    ticker: input.ticker?.trim() || undefined,
    sector: input.sector?.trim() || undefined,
    market: input.market?.trim() || undefined,
    sourceUrl: input.sourceUrl?.trim() || undefined,
    lastUpdatedBy: 'admin',
    lastUpdatedAt: now,
    priceSource: 'admin',
    isVerified: true,
    verificationStatus: 'admin_added',
  });

  try {
    await appendSharedCustomAsset(asset);

    await tryWriteCollection(() =>
      setDoc(doc(serverDb, 'customAssets', id), asset)
    );

    await tryWriteCollection(() =>
      setDoc(
        doc(serverDb, 'customPrices', trimmedName),
        {
          price,
          updatedAt: now,
          source: 'admin_added',
          lastUpdatedBy: 'admin',
        },
        { merge: true }
      )
    );

    return {
      success: true,
      message: `"${trimmedName}" 상품이 추가되었습니다.`,
      asset,
    };
  } catch (error) {
    console.error('[addAdminAssetOnServer] failed:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : '상품 추가 중 오류가 발생했습니다.',
    };
  }
}
