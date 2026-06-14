/** logicalName: adminModeEnhancedPriceUpdate — 관리자 환율 수정 (서버 경유) */
import { doc, getDoc, setDoc, serverDb } from './firestoreServer';
import { verifyAdminPassword } from './adminAssetPriceAPI';
import {
  readSharedConfig,
  tryWriteCollection,
  writeSharedExchangeRate,
} from './sharedConfigStore';
import { AdminExchangeRateUpdateReason } from '../src/types';
import {
  recalculateAllPortfolios,
  refreshUsdMarketPricesForRate,
} from './portfolioRecalculation';

const GLOBAL_SETTINGS_DOC = 'settings/app';
const DEFAULT_EXCHANGE_RATE = 1500;

function globalSettingsRef() {
  return doc(serverDb, GLOBAL_SETTINGS_DOC);
}

export async function getAdminExchangeRateOnServer(): Promise<number> {
  const shared = await readSharedConfig();
  if (typeof shared.exchangeRate === 'number' && shared.exchangeRate > 0) {
    return shared.exchangeRate;
  }

  const snap = await tryWriteCollection(() => getDoc(globalSettingsRef()));
  if (snap?.exists()) {
    const rate = snap.data().exchangeRate;
    if (typeof rate === 'number' && rate > 0) {
      return rate;
    }
  }

  await writeSharedExchangeRate(DEFAULT_EXCHANGE_RATE, 'system');
  await tryWriteCollection(() =>
    setDoc(
      globalSettingsRef(),
      {
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        lastExchangeRateUpdate: new Date(),
        lastUpdatedBy: 'system',
      },
      { merge: true }
    )
  );

  return DEFAULT_EXCHANGE_RATE;
}

export async function updateAdminExchangeRateOnServer(
  nickname: string,
  newRate: number,
  reason?: AdminExchangeRateUpdateReason
): Promise<{ success: boolean; message: string; updatedCount?: number }> {
  if (!Number.isFinite(newRate) || newRate <= 0) {
    return { success: false, message: '유효한 환율을 입력해주세요.' };
  }

  const roundedRate = Math.round(newRate * 10) / 10;
  const now = new Date();
  const updatedBy = nickname.trim() || 'admin';

  try {
    const shared = await readSharedConfig();
    const oldRate =
      typeof shared.exchangeRate === 'number' && shared.exchangeRate > 0
        ? shared.exchangeRate
        : DEFAULT_EXCHANGE_RATE;

    const marketPrices = await refreshUsdMarketPricesForRate(roundedRate, oldRate);

    await writeSharedExchangeRate(roundedRate, updatedBy, {
      reason,
      marketPrices,
    });

    await tryWriteCollection(() =>
      setDoc(
        globalSettingsRef(),
        {
          exchangeRate: roundedRate,
          lastExchangeRateUpdate: now,
          lastUpdatedBy: updatedBy,
          ...(reason ? { exchangeRateUpdateReason: reason } : {}),
        },
        { merge: true }
      )
    );

    const updatedCount = await recalculateAllPortfolios(marketPrices, roundedRate);

    return {
      success: true,
      message: `✅ 환율이 ${roundedRate.toLocaleString('ko-KR')}원/USD로 업데이트되었습니다.\n   모든 미국 주식의 평가금액이 재계산됩니다.`,
      updatedCount,
    };
  } catch (error) {
    console.error('[updateAdminExchangeRateOnServer] failed:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : '환율 저장 중 오류가 발생했습니다.',
    };
  }
}

export { verifyAdminPassword };
