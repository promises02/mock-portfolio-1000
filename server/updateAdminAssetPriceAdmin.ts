/** logicalName: vercelAdminPriceApi — Firebase Admin SDK로 관리자 시세 수정 */
import { CustomAsset, AdminPriceUpdateReason } from '../src/types';
import {
  computeKrwEquivalent,
  DEFAULT_EXCHANGE_RATE,
  getDefaultDisplayCurrency,
  inferAssetMarketRegion,
} from '../src/utils';
import { getAdminFirestoreDb } from './firebaseAdmin';
import { verifyAdminPassword } from './adminAssetPriceAPI';

const PRESET_ASSET_ID_PREFIX = '__preset__';
export const SHARED_CONFIG_DOC_ID = 'appSharedConfig';

function sanitizeDocId(value: string): string {
  return value.replace(/\s+/g, '_').replace(/[/\\.#$[\]]/g, '_');
}

function isPresetAdminAssetId(assetId: string): boolean {
  return assetId.startsWith(PRESET_ASSET_ID_PREFIX);
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

export async function updateAdminAssetPriceWithAdminSdk(
  asset: CustomAsset,
  newPrice: number,
  reason: AdminPriceUpdateReason
): Promise<{ success: boolean; message: string }> {
  const adminDb = getAdminFirestoreDb();
  if (!adminDb) {
    return {
      success: false,
      message:
        'Firebase Admin이 설정되지 않았습니다. Vercel에 FIREBASE_SERVICE_ACCOUNT 환경변수를 추가하거나 Firestore 규칙을 배포해주세요.',
    };
  }

  const assetId = asset.id?.trim();
  if (!assetId) {
    return { success: false, message: '자산 ID가 필요합니다.' };
  }
  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    return { success: false, message: '유효한 가격을 입력해주세요.' };
  }

  try {
    const docId = isPresetAdminAssetId(assetId)
      ? sanitizeDocId(asset.name.trim())
      : assetId;

    const sharedRef = adminDb.doc(`portfolios/${SHARED_CONFIG_DOC_ID}`);
    const sharedSnap = await sharedRef.get();
    const sharedData = sharedSnap.data() ?? {};
    const exchangeRate =
      typeof sharedData.exchangeRate === 'number' && sharedData.exchangeRate > 0
        ? sharedData.exchangeRate
        : DEFAULT_EXCHANGE_RATE;

    const customAssetRef = adminDb.doc(`customAssets/${docId}`);
    const customSnap = await customAssetRef.get();
    const existing: CustomAsset = customSnap.exists
      ? ({ ...(customSnap.data() as CustomAsset), id: docId } as CustomAsset)
      : asset;

    const marketRegion =
      existing.marketRegion ?? inferAssetMarketRegion(existing.name, existing.type);
    const displayCurrency =
      existing.displayCurrency ?? getDefaultDisplayCurrency(marketRegion);
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
      payload.price = Math.round(
        computeKrwEquivalent('CRYPTO', newPrice, exchangeRate)
      );
    } else {
      payload.priceKRW = newPrice;
      payload.price = Math.round(newPrice);
    }

    const priceKrw = payload.price!;
    const trimmedName = existing.name.trim();
    const existingMarketPrices =
      sharedData.marketPrices && typeof sharedData.marketPrices === 'object'
        ? (sharedData.marketPrices as Record<string, number>)
        : {};

    await adminDb.doc(`customPrices/${trimmedName}`).set(
      {
        price: priceKrw,
        updatedAt: now,
        source: 'admin_override',
        lastUpdatedBy: 'admin',
        updateReason: reason,
      },
      { merge: true }
    );

    await sharedRef.set(
      stripUndefinedDeep({
        nickname: SHARED_CONFIG_DOC_ID,
        assets: [],
        savings: 0,
        totalCurrentValue: 0,
        profitRate: 0,
        profitAmount: 0,
        hasRealPrices: false,
        marketPrices: { ...existingMarketPrices, [trimmedName]: priceKrw },
        ...(typeof sharedData.exchangeRate === 'number'
          ? { exchangeRate: sharedData.exchangeRate }
          : {}),
        updatedAt: now,
      }),
      { merge: true }
    );

    const baseFields: Partial<CustomAsset> = customSnap.exists
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

    await customAssetRef.set(
      stripUndefinedDeep({ ...baseFields, ...payload }),
      { merge: true }
    );

    const formattedPrice =
      displayCurrency === 'USD'
        ? `${newPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
        : `${Math.round(newPrice).toLocaleString('ko-KR')}원`;

    return {
      success: true,
      message: `✅ ${existing.name} 가격이 ${formattedPrice}으로 업데이트되었습니다.\n   모든 사용자의 포트폴리오에 반영됩니다.`,
    };
  } catch (error) {
    console.error('[updateAdminAssetPriceWithAdminSdk] failed:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.',
    };
  }
}

export { verifyAdminPassword };
