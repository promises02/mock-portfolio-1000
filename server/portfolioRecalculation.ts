/** logicalName: adminModeEnhancedPriceUpdate — 관리자 시세/환율 변경 후 전체 포트폴리오 손익 재계산 */
import { collection, doc, getDocs, setDoc, serverDb } from './firestoreServer';
import { AssetItem, MarketPriceMap, Portfolio } from '../src/types';
import {
  calculateUnrealizedProfit,
  PORTFOLIO_STARTING_CAPITAL,
  derivePortfolioCash,
  isUsMarketAsset,
  normalizeUsAssetPurchaseBasis,
  buildCatalogPriceMap,
} from '../src/utils/portfolioPnL';
import { DEFAULT_EXCHANGE_RATE, getDefaultDisplayCurrency, inferAssetMarketRegion } from '../src/utils';
import { ALL_PRESETS } from '../src/presets';
import { readSharedConfig, SHARED_CONFIG_DOC_ID, writeSharedMarketPrices } from './sharedConfigStore';

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

function resolveInitialCapital(portfolio: Portfolio): number {
  return portfolio.initialCapital != null && portfolio.initialCapital > 0
    ? portfolio.initialCapital
    : PORTFOLIO_STARTING_CAPITAL;
}

function updatePortfolioValues(
  assets: AssetItem[],
  savings: number,
  initialCapital: number,
  marketPrices: MarketPriceMap,
  exchangeRate: number,
  catalogPrices?: ReturnType<typeof buildCatalogPriceMap>
) {
  let totalCurrentValue = 0;
  let totalPurchaseAmountKRW = 0;
  let totalUnrealizedProfit = 0;

  const normalizedAssets = assets.map((asset) =>
    isUsMarketAsset(asset) ? normalizeUsAssetPurchaseBasis(asset, exchangeRate) : asset
  );

  const updatedAssets = normalizedAssets.map((asset) => {
    const profitInfo = calculateUnrealizedProfit(asset, marketPrices, exchangeRate, catalogPrices);
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
  const totalProfitAmount = totalAssets - initialCapital;
  const totalProfitRate = initialCapital > 0 ? (totalProfitAmount / initialCapital) * 100 : 0;
  const profitRate =
    totalPurchaseAmountKRW > 0 ? (totalUnrealizedProfit / totalPurchaseAmountKRW) * 100 : 0;

  return {
    assets: updatedAssets,
    totalCurrentValue: roundedEvaluation,
    profitAmount: Math.round(totalUnrealizedProfit),
    profitRate,
    totalAssets,
    totalProfitAmount,
    totalProfitRate,
    totalPurchaseAmount: Math.round(totalPurchaseAmountKRW),
  };
}

/** 환율 변경 시 USD 자산 marketPrices KRW 재산출 (USD 단가는 유지) */
export async function refreshUsdMarketPricesForRate(
  newRate: number,
  oldRate?: number
): Promise<MarketPriceMap> {
  const shared = await readSharedConfig();
  const previousRate =
    oldRate != null && oldRate > 0
      ? oldRate
      : typeof shared.exchangeRate === 'number' && shared.exchangeRate > 0
        ? shared.exchangeRate
        : DEFAULT_EXCHANGE_RATE;
  const marketPrices: MarketPriceMap = { ...(shared.marketPrices ?? {}) };

  const customAssetsSnap = await getDocs(collection(serverDb, 'customAssets'));
  const customAssetNames = new Set<string>();

  for (const assetDoc of customAssetsSnap.docs) {
    const data = assetDoc.data();
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) continue;
    customAssetNames.add(name);

    const priceUsd =
      typeof data.priceUSD === 'number' && data.priceUSD > 0
        ? data.priceUSD
        : undefined;

    if (priceUsd != null) {
      marketPrices[name] = Math.round(priceUsd * newRate);
      continue;
    }

    const displayCurrency = data.displayCurrency;
    const existingKrw = marketPrices[name];
    if (
      (displayCurrency === 'USD' || displayCurrency === 'CRYPTO') &&
      existingKrw != null &&
      existingKrw > 0 &&
      previousRate > 0
    ) {
      const derivedUsd = existingKrw / previousRate;
      marketPrices[name] = Math.round(derivedUsd * newRate);
    }
  }

  for (const preset of ALL_PRESETS) {
    const name = preset.name.trim();
    if (customAssetNames.has(name)) continue;

    const region = inferAssetMarketRegion(preset.name, preset.type);
    const currency = getDefaultDisplayCurrency(region);
    if (currency !== 'USD') continue;

    const usdPrice =
      'usdPrice' in preset && typeof preset.usdPrice === 'number' && preset.usdPrice > 0
        ? preset.usdPrice
        : previousRate > 0 && marketPrices[name] != null && marketPrices[name] > 0
          ? marketPrices[name] / previousRate
          : undefined;

    if (usdPrice != null) {
      marketPrices[name] = Math.round(usdPrice * newRate);
    }
  }

  await writeSharedMarketPrices(marketPrices, newRate, shared.customAssets);
  return marketPrices;
}

export async function recalculateAllPortfolios(
  marketPrices?: MarketPriceMap,
  exchangeRate?: number
): Promise<number> {
  const shared = await readSharedConfig();
  const activeMarketPrices = marketPrices ?? shared.marketPrices ?? {};
  const activeExchangeRate =
    exchangeRate != null && exchangeRate > 0
      ? exchangeRate
      : typeof shared.exchangeRate === 'number' && shared.exchangeRate > 0
        ? shared.exchangeRate
        : DEFAULT_EXCHANGE_RATE;

  const snapshot = await getDocs(collection(serverDb, 'portfolios'));
  let updatedCount = 0;

  for (const portfolioDoc of snapshot.docs) {
    if (portfolioDoc.id === SHARED_CONFIG_DOC_ID) continue;

    const portfolio = portfolioDoc.data() as Portfolio;
    const assets = Array.isArray(portfolio.assets) ? portfolio.assets : [];
    const initialCapital = resolveInitialCapital(portfolio);
    const cumulativeRealizedProfit = portfolio.cumulativeRealizedProfit ?? 0;
    const catalogPrices = buildCatalogPriceMap([], activeExchangeRate);
    const normalizedAssets = assets.map((asset) =>
      isUsMarketAsset(asset) ? normalizeUsAssetPurchaseBasis(asset, activeExchangeRate) : asset
    );
    const savings = derivePortfolioCash(
      normalizedAssets,
      cumulativeRealizedProfit,
      undefined,
      activeExchangeRate
    );

    const assetsWithPrices = normalizedAssets.map((asset) => {
      const override = activeMarketPrices[asset.name.trim()];
      const activeCurrentPrice =
        override != null && override > 0 ? override : (asset.currentPrice ?? asset.price);
      return stripUndefinedDeep({
        ...asset,
        currentPrice: activeCurrentPrice,
      });
    });

    const hasRealPrices = assetsWithPrices.some((a) => a.currentPrice !== a.price);
    const values = updatePortfolioValues(
      assetsWithPrices,
      savings,
      initialCapital,
      activeMarketPrices,
      activeExchangeRate,
      catalogPrices
    );

    await setDoc(
      doc(serverDb, 'portfolios', portfolioDoc.id),
      stripUndefinedDeep({
        assets: values.assets,
        savings,
        exchangeRate: activeExchangeRate,
        totalCurrentValue: values.totalCurrentValue,
        profitAmount: values.profitAmount,
        profitRate: values.profitRate,
        totalAssets: values.totalAssets,
        totalProfitAmount: values.totalProfitAmount,
        totalProfitRate: values.totalProfitRate,
        totalPurchaseAmount: values.totalPurchaseAmount,
        unrealizedProfitAmount: values.profitAmount,
        hasRealPrices,
        updatedAt: new Date(),
      }),
      { merge: true }
    );
    updatedCount += 1;
  }

  return updatedCount;
}
