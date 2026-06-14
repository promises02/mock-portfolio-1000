/** logicalName: sharedConfigStore — portfolios/appSharedConfig 공유 설정 (규칙 배포 없이 전역 동기화) */
import { doc, getDoc, setDoc, serverDb } from './firestoreServer';
import { CustomAsset } from '../src/types';

export const SHARED_CONFIG_DOC_ID = 'appSharedConfig';

export interface SharedConfigDoc {
  nickname: string;
  assets: [];
  savings: number;
  totalCurrentValue: number;
  profitRate: number;
  profitAmount: number;
  hasRealPrices: boolean;
  updatedAt: Date;
  marketPrices?: Record<string, number>;
  exchangeRate?: number;
  customAssets?: CustomAsset[];
}

const PORTFOLIO_STUB: Omit<SharedConfigDoc, 'updatedAt'> = {
  nickname: SHARED_CONFIG_DOC_ID,
  assets: [],
  savings: 0,
  totalCurrentValue: 0,
  profitRate: 0,
  profitAmount: 0,
  hasRealPrices: false,
};

function sharedConfigRef() {
  return doc(serverDb, 'portfolios', SHARED_CONFIG_DOC_ID);
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

export async function readSharedConfig(): Promise<SharedConfigDoc> {
  const snap = await getDoc(sharedConfigRef());
  if (!snap.exists()) {
    return { ...PORTFOLIO_STUB, updatedAt: new Date() };
  }
  return snap.data() as SharedConfigDoc;
}

export async function writeSharedMarketPrice(
  assetName: string,
  priceKrw: number
): Promise<void> {
  const trimmed = assetName.trim();
  const existing = await readSharedConfig();
  const marketPrices = { ...(existing.marketPrices ?? {}), [trimmed]: priceKrw };

  await setDoc(
    sharedConfigRef(),
    stripUndefinedDeep({
      ...PORTFOLIO_STUB,
      marketPrices,
      ...(typeof existing.exchangeRate === 'number' ? { exchangeRate: existing.exchangeRate } : {}),
      ...(existing.customAssets?.length ? { customAssets: existing.customAssets } : {}),
      updatedAt: new Date(),
    }),
    { merge: true }
  );
}

export async function writeSharedMarketPrices(
  marketPrices: Record<string, number>,
  exchangeRate?: number,
  customAssets?: CustomAsset[]
): Promise<void> {
  const existing = await readSharedConfig();

  await setDoc(
    sharedConfigRef(),
    stripUndefinedDeep({
      ...PORTFOLIO_STUB,
      marketPrices,
      ...(exchangeRate != null && exchangeRate > 0
        ? { exchangeRate }
        : typeof existing.exchangeRate === 'number'
          ? { exchangeRate: existing.exchangeRate }
          : {}),
      ...(customAssets?.length
        ? { customAssets }
        : existing.customAssets?.length
          ? { customAssets: existing.customAssets }
          : {}),
      updatedAt: new Date(),
    }),
    { merge: true }
  );
}

export async function writeSharedExchangeRate(
  rate: number,
  updatedBy: string,
  options?: { reason?: string; marketPrices?: Record<string, number> }
): Promise<void> {
  const existing = await readSharedConfig();
  const marketPrices =
    options?.marketPrices ??
    (existing.marketPrices && Object.keys(existing.marketPrices).length > 0
      ? existing.marketPrices
      : undefined);

  await setDoc(
    sharedConfigRef(),
    stripUndefinedDeep({
      ...PORTFOLIO_STUB,
      exchangeRate: rate,
      ...(marketPrices ? { marketPrices } : {}),
      ...(existing.customAssets?.length ? { customAssets: existing.customAssets } : {}),
      exchangeRateUpdatedBy: updatedBy,
      exchangeRateUpdatedAt: new Date(),
      ...(options?.reason ? { exchangeRateUpdateReason: options.reason } : {}),
      updatedAt: new Date(),
    }),
    { merge: true }
  );
}

export async function appendSharedCustomAsset(asset: CustomAsset): Promise<void> {
  const existing = await readSharedConfig();
  const customAssets = [...(existing.customAssets ?? []), asset];

  await setDoc(
    sharedConfigRef(),
    stripUndefinedDeep({
      ...PORTFOLIO_STUB,
      customAssets,
      ...(existing.marketPrices && Object.keys(existing.marketPrices).length > 0
        ? { marketPrices: existing.marketPrices }
        : {}),
      ...(typeof existing.exchangeRate === 'number' ? { exchangeRate: existing.exchangeRate } : {}),
      updatedAt: new Date(),
    }),
    { merge: true }
  );
}

/** 컬렉션 쓰기 실패 시 무시 (규칙 미배포 환경 대비) */
export async function tryWriteCollection<T>(
  operation: () => Promise<T>
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    console.warn('[sharedConfigStore] collection write skipped:', error);
    return undefined;
  }
}
