/** logicalName: newAdminModeAssetPriceEditor — 서버 경유 관리자 시세 수정 */
import { doc, getDoc, setDoc, serverDb } from './firestoreServer';
import { AdminPriceUpdateReason, CustomAsset } from '../src/types';
import {
  computeKrwEquivalent,
  DEFAULT_EXCHANGE_RATE,
  getDefaultDisplayCurrency,
  inferAssetMarketRegion,
} from '../src/utils';
import { tryWriteCollection, writeSharedMarketPrice, readSharedConfig } from './sharedConfigStore';
import { recalculateAllPortfolios } from './portfolioRecalculation';

const PRESET_ASSET_ID_PREFIX = '__preset__';

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

export function verifyAdminPassword(password: unknown): boolean {
  const expected =
    process.env.ADMIN_PASSWORD?.trim() ||
    process.env.VITE_ADMIN_PASSWORD?.trim() ||
    '1234';
  return typeof password === 'string' && password.trim() === expected;
}

export async function updateAdminAssetPriceOnServer(
  asset: CustomAsset,
  newPrice: number,
  reason: AdminPriceUpdateReason
): Promise<{ success: boolean; message: string }> {
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
    const sharedConfig = await readSharedConfig();
    const exchangeRate =
      typeof sharedConfig.exchangeRate === 'number' && sharedConfig.exchangeRate > 0
        ? sharedConfig.exchangeRate
        : DEFAULT_EXCHANGE_RATE;

    const snap = await tryWriteCollection(() =>
      getDoc(doc(serverDb, 'customAssets', docId))
    );
    const existing: CustomAsset = snap?.exists()
      ? ({ ...(snap.data() as CustomAsset), id: docId } as CustomAsset)
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

    // portfolios/appSharedConfig — 원격 Firestore 규칙에서도 쓰기 가능
    await writeSharedMarketPrice(existing.name, priceKrw);

    const baseFields: Partial<CustomAsset> = snap?.exists()
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

    await tryWriteCollection(() =>
      setDoc(
        doc(serverDb, 'customAssets', docId),
        stripUndefinedDeep({ ...baseFields, ...payload }),
        { merge: true }
      )
    );

    await tryWriteCollection(() =>
      setDoc(
        doc(serverDb, 'customPrices', existing.name.trim()),
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

    const shared = await readSharedConfig();
    await recalculateAllPortfolios(
      { ...(shared.marketPrices ?? {}), [existing.name.trim()]: priceKrw },
      exchangeRate
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
    console.error('[updateAdminAssetPriceOnServer] failed:', error);
    const message = error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.';
    if (message.includes('PERMISSION_DENIED') || message.includes('permission')) {
      return {
        success: false,
        message:
          'Firestore 저장 권한이 없습니다. 터미널에서 `npx firebase-tools@latest deploy --only firestore:rules` 실행 후 다시 시도해주세요.',
      };
    }
    return { success: false, message };
  }
}
