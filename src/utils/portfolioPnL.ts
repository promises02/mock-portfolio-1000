import { AssetItem, CustomAsset, Portfolio } from '../types';
import { RECOMMENDED_ASSETS, ALL_PRESETS, getPresetByName } from '../presets';
import { DEFAULT_EXCHANGE_RATE, getAssetYieldPercent, inferAssetMarketRegion, supportsFractionalQuantity, roundFractionalQuantity } from '../utils';

/** 미국 주식: 모의투자 환율 1,500원 고정 (표시·손익 계산 공통) */
export const US_STOCK_FIXED_EXCHANGE_RATE = DEFAULT_EXCHANGE_RATE;

function usStockRate(_exchangeRate?: number): number {
  return US_STOCK_FIXED_EXCHANGE_RATE;
}

/** 관리자 catalog(customAssets + preset) 기준가 — 외부 API 시세와 분리 */
export interface CatalogPriceEntry {
  priceUsd?: number;
  priceKrw?: number;
}

export type CatalogPriceMap = Record<string, CatalogPriceEntry>;

export function buildCatalogPriceMap(
  customAssets: CustomAsset[] = [],
  exchangeRate: number = DEFAULT_EXCHANGE_RATE
): CatalogPriceMap {
  const map: CatalogPriceMap = {};

  for (const preset of ALL_PRESETS) {
    const name = preset.name.trim();
    if (preset.usdPrice != null && preset.usdPrice > 0) {
      map[name] = {
        priceUsd: preset.usdPrice,
        priceKrw: Math.round(preset.usdPrice * US_STOCK_FIXED_EXCHANGE_RATE),
      };
    } else if (preset.price > 0) {
      map[name] = { priceKrw: preset.price };
    }
  }

  for (const asset of customAssets) {
    const name = asset.name.trim();
    if (!name) continue;
    if (!shouldUseCustomAssetAsCatalogPrice(asset)) continue;
    if (asset.priceUSD != null && asset.priceUSD > 0) {
      map[name] = {
        priceUsd: asset.priceUSD,
        priceKrw: Math.round(asset.priceUSD * US_STOCK_FIXED_EXCHANGE_RATE),
      };
    } else {
      const krw = asset.priceKRW ?? asset.price;
      if (krw > 0) map[name] = { priceKrw: Math.round(krw) };
    }
  }

  return map;
}

/** community customAssets 중 시장 catalog로 쓸 항목만 (시드·매수 스냅샷 제외) */
function shouldUseCustomAssetAsCatalogPrice(asset: CustomAsset): boolean {
  if (asset.addedBy === 'system') return false;
  if (asset.addedBy === 'admin') return true;
  return false;
}

function lookupCatalogEntry(name: string, catalogPrices?: CatalogPriceMap): CatalogPriceEntry | undefined {
  return catalogPrices?.[name.trim()];
}

export interface AssetPnLSummary {
  purchaseUnitKrw: number;
  currentUnitKrw: number;
  purchaseAmount: number;
  currentAmount: number;
  profitAmount: number;
  profitRate: number;
  priceChangeRate: number;
  /** 미국 주식: 매입 시점 환율 */
  purchaseExchangeRate?: number;
  /** 미국 주식: 주가 변동 손익 (KRW) */
  priceChangeProfit?: number;
  /** 미국 주식: 환율 변동 손익 (KRW) */
  exchangeRateProfit?: number;
}

export function resolveAssetTicker(
  name: string,
  customAssets: Array<Pick<import('../types').CustomAsset, 'name' | 'ticker'>> = []
): string | undefined {
  const trimmed = name.trim();
  const fromCustom = customAssets.find((a) => a.name.trim() === trimmed)?.ticker?.trim();
  if (fromCustom) return fromCustom;

  const fromRecommended = RECOMMENDED_ASSETS.find(
    (a) => a.name.trim().toLowerCase() === trimmed.toLowerCase()
  )?.ticker;
  return fromRecommended?.trim() || undefined;
}

export function isUsMarketAsset(asset: AssetItem): boolean {
  return (asset.market ?? inferAssetMarketRegion(asset.name, asset.type || 'stock')) === 'US';
}

/** 미국 주식: USD 평균매입가 (catalog priceUSD는 사용하지 않음) */
export function getPurchasePriceUsd(asset: AssetItem, exchangeRate: number): number {
  if (asset.averagePurchasePrice != null && asset.averagePurchasePrice > 0) {
    return asset.averagePurchasePrice;
  }
  if (asset.purchasePriceUSD != null && asset.purchasePriceUSD > 0) {
    return asset.purchasePriceUSD;
  }
  if (asset.price > 0) {
    const rate =
      asset.purchaseExchangeRate != null && asset.purchaseExchangeRate > 0
        ? asset.purchaseExchangeRate
        : exchangeRate > 0
          ? exchangeRate
          : DEFAULT_EXCHANGE_RATE;
    if (rate > 0) {
      return asset.price / rate;
    }
  }
  return 0;
}

/** 매입 시점 환율 — 저장값 우선 (미국: 첫 매수 환율 고정) */
export function resolvePurchaseExchangeRate(
  asset: AssetItem,
  fallbackRate: number = DEFAULT_EXCHANGE_RATE
): number {
  if (asset.purchaseExchangeRate != null && asset.purchaseExchangeRate > 0) {
    return asset.purchaseExchangeRate;
  }

  const purchaseUsd = asset.purchasePriceUSD ?? asset.averagePurchasePrice;
  if (purchaseUsd != null && purchaseUsd > 0 && asset.price > 0) {
    return Math.round(asset.price / purchaseUsd);
  }

  return fallbackRate > 0 ? fallbackRate : DEFAULT_EXCHANGE_RATE;
}

export function getTotalPurchaseAmountKrw(asset: AssetItem, fallbackRate: number): number {
  const qty = asset.quantity || 0;
  if (qty <= 0) return 0;

  if (asset.totalPurchaseAmount != null && asset.totalPurchaseAmount > 0) {
    return Math.round(asset.totalPurchaseAmount);
  }

  if (isUsMarketAsset(asset)) {
    return Math.round(getPurchaseUnitKrw(asset, fallbackRate) * qty);
  }

  return Math.round(getPurchaseUnitKrw(asset, fallbackRate) * qty);
}

export interface UnrealizedProfitResult {
  unrealizedProfit: number;
  unrealizedProfitRate: number;
  currentAmount: number;
  purchaseAmount: number;
  breakdown?: { priceChangeProfit: number; exchangeRateProfit: number };
}

/** logicalName: realizedProfitWithCashFlow — 미실현 손익 (환율·가격 변동, 현금 무관) */
export function calculateUnrealizedProfit(
  asset: AssetItem,
  marketPrices: Record<string, number> | undefined,
  currentExchangeRate: number,
  catalogPrices?: CatalogPriceMap
): UnrealizedProfitResult {
  const market = asset.market ?? inferAssetMarketRegion(asset.name, asset.type || 'stock');
  const qty = asset.quantity || 0;

  if (market === 'US') {
    const purchaseRate = resolvePurchaseExchangeRate(asset, currentExchangeRate);
    const purchaseAmount = getTotalPurchaseAmountKrw(asset, currentExchangeRate);
    const currentUnit = getCurrentUnitKrw(asset, marketPrices, currentExchangeRate, catalogPrices);
    const currentAmount = Math.round(currentUnit * qty);
    const unrealizedProfit = currentAmount - purchaseAmount;
    const unrealizedProfitRate =
      purchaseAmount > 0 ? (unrealizedProfit / purchaseAmount) * 100 : 0;

    const avgUsd = getPurchasePriceUsd(asset, currentExchangeRate);
    const currentUsd = getCurrentPriceUsd(asset, marketPrices, currentExchangeRate, catalogPrices);
    const priceChangeProfit = Math.round(
      (currentUsd - avgUsd) * purchaseRate * qty
    );
    const exchangeRateProfit = unrealizedProfit - priceChangeProfit;

    return {
      unrealizedProfit,
      unrealizedProfitRate,
      currentAmount,
      purchaseAmount,
      breakdown: {
        priceChangeProfit,
        exchangeRateProfit,
      },
    };
  }

  if (market === 'Crypto') {
    const purchaseAmount = getTotalPurchaseAmountKrw(asset, currentExchangeRate);
    const currentUnit = getCurrentUnitKrw(asset, marketPrices, currentExchangeRate, catalogPrices);
    const currentAmount = Math.round(currentUnit * qty);
    const unrealizedProfit = currentAmount - purchaseAmount;
    const unrealizedProfitRate =
      purchaseAmount > 0 ? (unrealizedProfit / purchaseAmount) * 100 : 0;
    return { unrealizedProfit, unrealizedProfitRate, currentAmount, purchaseAmount };
  }

  // Korea
  const purchaseAmount = getTotalPurchaseAmountKrw(asset, currentExchangeRate);
  const currentUnit = getCurrentUnitKrw(asset, marketPrices, currentExchangeRate, catalogPrices);
  const currentAmount = Math.round(currentUnit * qty);
  const unrealizedProfit = currentAmount - purchaseAmount;
  const unrealizedProfitRate =
    purchaseAmount > 0 ? (unrealizedProfit / purchaseAmount) * 100 : 0;

  return { unrealizedProfit, unrealizedProfitRate, currentAmount, purchaseAmount };
}

/** App.tsx live valuation — 관리자 marketPrices → catalog → currentPrice → price (KRW) */
function resolveActiveCurrentPriceKrw(
  asset: AssetItem,
  marketPrices: Record<string, number> | undefined,
  catalogPrices?: CatalogPriceMap,
  exchangeRate?: number
): number {
  const name = asset.name.trim();
  const krwRate = exchangeRate;

  const adminKrw = marketPrices?.[name];
  if (adminKrw !== undefined && adminKrw > 0) {
    return Math.round(adminKrw);
  }

  const catalog = lookupCatalogEntry(name, catalogPrices);
  if (catalog?.priceKrw != null && catalog.priceKrw > 0) {
    return Math.round(catalog.priceKrw);
  }
  if (
    catalog?.priceUsd != null &&
    catalog.priceUsd > 0 &&
    krwRate != null &&
    krwRate > 0
  ) {
    return Math.round(catalog.priceUsd * krwRate);
  }

  if (asset.currentPrice != null && asset.currentPrice > 0) {
    return Math.round(asset.currentPrice);
  }
  if (asset.price > 0) {
    return Math.round(asset.price);
  }
  if (asset.priceKRW != null && asset.priceKRW > 0) {
    return Math.round(asset.priceKRW);
  }
  return 0;
}

/**
 * 미국 주식 USD 현재가.
 * 우선순위: 관리자 marketPrices(KRW→USD) → asset.currentPrice → catalog → 매입가
 */
export function getCurrentPriceUsd(
  asset: AssetItem,
  marketPrices: Record<string, number> | undefined,
  exchangeRate: number,
  catalogPrices?: CatalogPriceMap
): number {
  const name = asset.name.trim();
  const adminKrw = marketPrices?.[name];

  if (adminKrw != null && adminKrw > 0 && exchangeRate > 0) {
    return adminKrw / exchangeRate;
  }

  if (asset.currentPrice != null && asset.currentPrice > 0 && exchangeRate > 0) {
    return asset.currentPrice / exchangeRate;
  }

  const catalog = lookupCatalogEntry(name, catalogPrices);

  if (catalog?.priceUsd != null && catalog.priceUsd > 0) {
    return catalog.priceUsd;
  }

  if (
    catalog?.priceKrw != null &&
    catalog.priceKrw > 0 &&
    exchangeRate > 0
  ) {
    return catalog.priceKrw / exchangeRate;
  }

  if (!catalogPrices) {
    const preset = getPresetByName(name.toLowerCase());
    if (preset?.usdPrice != null && preset.usdPrice > 0) {
      return preset.usdPrice;
    }
  }

  return getPurchasePriceUsd(asset, exchangeRate);
}

export function getCurrentUnitKrw(
  asset: AssetItem,
  marketPrices: Record<string, number> | undefined,
  exchangeRate: number,
  catalogPrices?: CatalogPriceMap
): number {
  if (isUsMarketAsset(asset)) {
    const currentUsd = getCurrentPriceUsd(asset, marketPrices, exchangeRate, catalogPrices);
    if (currentUsd > 0 && exchangeRate > 0) {
      return Math.round(currentUsd * exchangeRate);
    }
    return 0;
  }
  const activeKrw = resolveActiveCurrentPriceKrw(asset, marketPrices, catalogPrices, exchangeRate);
  return activeKrw > 0 ? activeKrw : 0;
}

export function getPurchaseUnitKrw(asset: AssetItem, fallbackRate: number): number {
  if (isUsMarketAsset(asset)) {
    const purchaseRate = resolvePurchaseExchangeRate(asset, fallbackRate);
    const purchaseUsd = getPurchasePriceUsd(asset, fallbackRate);
    if (purchaseUsd > 0) {
      return Math.round(purchaseUsd * purchaseRate);
    }
    if (asset.price > 0) {
      return Math.round(asset.price);
    }
  }

  if (asset.averagePurchasePrice != null && asset.averagePurchasePrice > 0) {
    return Math.round(asset.averagePurchasePrice);
  }
  if (asset.price > 0) {
    return Math.round(asset.price);
  }

  return 0;
}

/** 레거시: 매입 KRW(asset.price) 우선 — catalog USD(priceUSD)로 매입가를 덮어쓰지 않음 */
export function normalizeUsAssetPurchaseBasis(
  asset: AssetItem,
  fallbackRate: number
): AssetItem {
  if (!isUsMarketAsset(asset)) return asset;

  const purchaseRate = resolvePurchaseExchangeRate(asset, fallbackRate);
  const qty = asset.quantity || 0;
  let purchaseUsd = getPurchasePriceUsd(asset, fallbackRate);
  let purchaseUnitKrw =
    purchaseUsd > 0 ? Math.round(purchaseUsd * purchaseRate) : asset.price > 0 ? Math.round(asset.price) : 0;

  if (purchaseUsd <= 0 && purchaseUnitKrw > 0 && purchaseRate > 0) {
    purchaseUsd = purchaseUnitKrw / purchaseRate;
  }

  if (purchaseUsd <= 0 && purchaseUnitKrw <= 0) {
    return asset;
  }

  return {
    ...asset,
    averagePurchasePrice: purchaseUsd,
    purchasePriceUSD: purchaseUsd,
    price: purchaseUnitKrw,
    purchaseExchangeRate: purchaseRate,
    totalPurchaseAmount: Math.round(purchaseUnitKrw * qty),
  };
}

export function computeUsAssetProfitBreakdown(
  asset: AssetItem,
  marketPrices: Record<string, number> | undefined,
  exchangeRate: number,
  catalogPrices?: CatalogPriceMap
): { priceChangeProfit: number; exchangeRateProfit: number } {
  const rate = exchangeRate;
  const unrealized = calculateUnrealizedProfit(asset, marketPrices, rate, catalogPrices);
  return {
    priceChangeProfit: unrealized.unrealizedProfit,
    exchangeRateProfit: 0,
  };
}

export function computeAssetPnL(
  asset: AssetItem,
  marketPrices: Record<string, number> | undefined,
  exchangeRate: number,
  catalogPrices?: CatalogPriceMap
): AssetPnLSummary {
  const pnlRate = exchangeRate;
  const normalized = isUsMarketAsset(asset)
    ? normalizeUsAssetPurchaseBasis(asset, pnlRate)
    : asset;
  const unrealized = calculateUnrealizedProfit(normalized, marketPrices, pnlRate, catalogPrices);
  const quantity = normalized.quantity || 0;
  const purchaseUnitKrw =
    quantity > 0 ? Math.round(unrealized.purchaseAmount / quantity) : getPurchaseUnitKrw(normalized, pnlRate);
  const currentUnitKrw =
    quantity > 0
      ? Math.round(unrealized.currentAmount / quantity)
      : getCurrentUnitKrw(normalized, marketPrices, pnlRate, catalogPrices);
  const priceChangeRate = getAssetYieldPercent(normalized, currentUnitKrw, pnlRate);

  return {
    purchaseUnitKrw,
    currentUnitKrw,
    purchaseAmount: unrealized.purchaseAmount,
    currentAmount: unrealized.currentAmount,
    profitAmount: unrealized.unrealizedProfit,
    profitRate: unrealized.unrealizedProfitRate,
    priceChangeRate,
    purchaseExchangeRate: isUsMarketAsset(normalized)
      ? resolvePurchaseExchangeRate(normalized, pnlRate)
      : undefined,
    priceChangeProfit: unrealized.breakdown?.priceChangeProfit,
    exchangeRateProfit: unrealized.breakdown?.exchangeRateProfit,
  };
}

export function getProfitStyle(profitAmount: number): {
  textClass: string;
  icon: string;
} {
  if (profitAmount >= 0) {
    return { textClass: 'text-[#FF3B30]', icon: '▲' };
  }
  return { textClass: 'text-[#007AFF]', icon: '▼' };
}

export interface SellPreview {
  sellPriceKrw: number;
  purchasePriceKrw: number;
  sellAmount: number;
  purchaseAmount: number;
  realizedProfit: number;
  profitRate: number;
  cashAfter: number;
  /** 미국 주식: USD 현재가 */
  currentPriceUsd?: number;
  /** 미국 주식: USD 평균 매입가 */
  purchasePriceUsd?: number;
  /** 미국 주식: 매입 시점 가중평균 환율 */
  purchaseExchangeRate?: number;
  /** 미국 주식: 현재 환율 */
  currentExchangeRate?: number;
  priceChangeProfit?: number;
  exchangeRateProfit?: number;
}

export function computeSellPreview(
  asset: AssetItem,
  sellQuantity: number,
  marketPrices: Record<string, number> | undefined,
  exchangeRate: number,
  currentSavings: number,
  catalogPrices?: CatalogPriceMap
): SellPreview {
  const normalized = isUsMarketAsset(asset)
    ? normalizeUsAssetPurchaseBasis(asset, exchangeRate)
    : asset;
  const fractional = supportsFractionalQuantity(normalized);
  const qty = fractional
    ? Math.max(0, roundFractionalQuantity(sellQuantity, normalized))
    : Math.max(0, Math.floor(sellQuantity));

  if (isUsMarketAsset(normalized)) {
    const rate = exchangeRate;
    const sellPriceKrw = getCurrentUnitKrw(normalized, marketPrices, rate, catalogPrices);
    const purchasePriceKrw = getPurchaseUnitKrw(normalized, rate);
    const sellAmount = Math.round(sellPriceKrw * qty);
    const purchaseAmount = Math.round(purchasePriceKrw * qty);
    const realizedProfit = sellAmount - purchaseAmount;
    const profitRate = purchaseAmount > 0 ? (realizedProfit / purchaseAmount) * 100 : 0;

    return {
      sellPriceKrw,
      purchasePriceKrw,
      sellAmount,
      purchaseAmount,
      realizedProfit,
      profitRate,
      cashAfter: currentSavings + sellAmount,
      currentExchangeRate: rate,
      purchaseExchangeRate: resolvePurchaseExchangeRate(normalized, rate),
      priceChangeProfit: realizedProfit,
      exchangeRateProfit: 0,
    };
  }

  const sellPriceKrw = getCurrentUnitKrw(normalized, marketPrices, exchangeRate, catalogPrices);
  const purchasePriceKrw = getPurchaseUnitKrw(normalized, exchangeRate);
  const sellAmount = Math.round(sellPriceKrw * qty);
  const purchaseAmount = Math.round(purchasePriceKrw * qty);
  const realizedProfit = sellAmount - purchaseAmount;
  const profitRate = purchaseAmount > 0 ? (realizedProfit / purchaseAmount) * 100 : 0;

  return {
    sellPriceKrw,
    purchasePriceKrw,
    sellAmount,
    purchaseAmount,
    realizedProfit,
    profitRate,
    cashAfter: currentSavings + sellAmount,
  };
}

/** 추가 매수: USD 평균만 가중평균, purchaseExchangeRate는 첫 매수 환율 유지 */
export function mergeUsAssetOnBuy(
  existing: AssetItem,
  addQty: number,
  unitPriceKrw: number,
  priceUsd: number,
  exchangeRate: number
): Pick<
  AssetItem,
  | 'price'
  | 'quantity'
  | 'currentPrice'
  | 'averagePurchasePrice'
  | 'purchasePriceUSD'
  | 'priceUSD'
  | 'purchaseExchangeRate'
  | 'totalPurchaseAmount'
> {
  const oldQty = existing.quantity || 0;
  const newQty = oldQty + addQty;
  const oldUsd =
    existing.purchasePriceUSD ??
    (existing.price > 0
      ? existing.price / resolvePurchaseExchangeRate(existing, exchangeRate)
      : priceUsd);
  const purchaseExchangeRate = resolvePurchaseExchangeRate(existing, exchangeRate);
  const newAvgUsd = (oldUsd * oldQty + priceUsd * addQty) / newQty;
  const newAvgPriceKrw = Math.round(newAvgUsd * purchaseExchangeRate);
  const totalPurchaseAmount = Math.round(newAvgUsd * newQty * purchaseExchangeRate);

  return {
    quantity: newQty,
    price: newAvgPriceKrw,
    currentPrice: unitPriceKrw,
    averagePurchasePrice: newAvgUsd,
    purchasePriceUSD: newAvgUsd,
    priceUSD: priceUsd,
    purchaseExchangeRate,
    totalPurchaseAmount,
  };
}

/** 첫 매수 시 미국 주식 필드 구성 */
export function buildUsAssetOnFirstBuy(
  unitPriceKrw: number,
  priceUsd: number,
  exchangeRate: number,
  quantity = 1
): Pick<
  AssetItem,
  | 'price'
  | 'currentPrice'
  | 'averagePurchasePrice'
  | 'purchasePriceUSD'
  | 'priceUSD'
  | 'purchaseExchangeRate'
  | 'totalPurchaseAmount'
> {
  const purchaseExchangeRate = exchangeRate;
  const price = Math.round(priceUsd * purchaseExchangeRate);
  return {
    price,
    currentPrice: unitPriceKrw,
    averagePurchasePrice: priceUsd,
    purchasePriceUSD: priceUsd,
    priceUSD: priceUsd,
    purchaseExchangeRate,
    totalPurchaseAmount: Math.round(priceUsd * purchaseExchangeRate * quantity),
  };
}

export const PORTFOLIO_STARTING_CAPITAL = 10_000_000;

export interface PortfolioProfitSummary {
  totalPurchaseAmount: number;
  totalCurrentValue: number;
  unrealizedProfit: number;
  unrealizedProfitRate: number;
  realizedProfit: number;
  totalProfit: number;
  totalProfitRate: number;
  cashBalance: number;
  totalPortfolioValue: number;
}

/** 포트폴리오 미실현·실현·종합 손익 */
export function computePortfolioProfitSummary(
  assets: AssetItem[],
  marketPrices: Record<string, number> | undefined,
  exchangeRate: number,
  cumulativeRealizedProfit: number,
  cashBalance: number,
  catalogPrices?: CatalogPriceMap,
  initialCapital: number = PORTFOLIO_STARTING_CAPITAL
): PortfolioProfitSummary {
  const normalized = assets.map((asset) =>
    isUsMarketAsset(asset) ? normalizeUsAssetPurchaseBasis(asset, exchangeRate) : asset
  );
  const totalPurchaseAmount = normalized.reduce(
    (sum, asset) => {
      return sum + calculateUnrealizedProfit(asset, marketPrices, exchangeRate, catalogPrices).purchaseAmount;
    },
    0
  );
  const totalCurrentValue = normalized.reduce(
    (sum, asset) => {
      return sum + calculateUnrealizedProfit(asset, marketPrices, exchangeRate, catalogPrices).currentAmount;
    },
    0
  );
  const unrealizedProfit = Math.round(totalCurrentValue - totalPurchaseAmount);
  const unrealizedProfitRate =
    totalPurchaseAmount > 0 ? (unrealizedProfit / totalPurchaseAmount) * 100 : 0;
  const realizedProfit = cumulativeRealizedProfit;
  const reconciledCash = derivePortfolioCash(
    normalized,
    cumulativeRealizedProfit,
    undefined,
    exchangeRate
  );
  const totalPortfolioValue = Math.round(totalCurrentValue + reconciledCash);
  const totalProfitAmount = totalPortfolioValue - initialCapital;
  const totalProfitRate = initialCapital > 0 ? (totalProfitAmount / initialCapital) * 100 : 0;

  return {
    totalPurchaseAmount: Math.round(totalPurchaseAmount),
    totalCurrentValue: Math.round(totalCurrentValue),
    unrealizedProfit,
    unrealizedProfitRate,
    realizedProfit,
    totalProfit: totalProfitAmount,
    totalProfitRate,
    cashBalance: reconciledCash,
    totalPortfolioValue,
  };
}

/** 보유 종목 매입원가 합계 (KRW) — 미국 주식 USD·환율 반영 */
export function sumHoldingsPurchaseAmountKrw(
  assets: AssetItem[],
  exchangeRate: number = DEFAULT_EXCHANGE_RATE
): number {
  const normalized = assets.map((asset) =>
    isUsMarketAsset(asset) ? normalizeUsAssetPurchaseBasis(asset, exchangeRate) : asset
  );
  return normalized.reduce(
    (sum, item) => sum + getTotalPurchaseAmountKrw(item, exchangeRate),
    0
  );
}

/**
 * 예치금 = 초기자본 + 누적실현손익 − 보유 매입원가 (증권사 예수금 방식)
 * Firestore savings 필드와 무관하게 항상 보유 종목 매입원가로 역산 (전 계정 공통)
 */
export function derivePortfolioCash(
  assets: AssetItem[],
  cumulativeRealizedProfit: number,
  _storedSavings?: number,
  exchangeRate: number = DEFAULT_EXCHANGE_RATE
): number {
  const activeBudget = PORTFOLIO_STARTING_CAPITAL + cumulativeRealizedProfit;
  const totalInvested = Math.round(sumHoldingsPurchaseAmountKrw(assets, exchangeRate));
  return Math.max(0, Math.round(activeBudget - totalInvested));
}

/** Firestore savings와 역산 예치금이 다르면 true (레거시 미차감 버그 등) */
export function portfolioCashNeedsRepair(
  portfolio: Pick<Portfolio, 'assets' | 'savings' | 'cumulativeRealizedProfit'>,
  exchangeRate: number = DEFAULT_EXCHANGE_RATE
): boolean {
  const assets = portfolio.assets ?? [];
  const derived = derivePortfolioCash(
    assets,
    portfolio.cumulativeRealizedProfit ?? 0,
    undefined,
    exchangeRate
  );
  const stored =
    portfolio.savings != null && Number.isFinite(portfolio.savings)
      ? Math.max(0, Math.round(portfolio.savings))
      : derived;
  return Math.abs(derived - stored) > 1;
}

export interface BrokeragePortfolioMetrics {
  savings: number;
  totalCurrentValue: number;
  totalAssets: number;
  totalProfitAmount: number;
  totalProfitRate: number;
  initialCapital: number;
}

/** 종합 수익률: (현금 + 평가금액 − 초기자본) / 초기자본 */
export function computeBrokeragePortfolioMetrics(
  assets: AssetItem[],
  cumulativeRealizedProfit: number,
  initialCapital: number,
  marketPrices: Record<string, number> | undefined,
  exchangeRate: number,
  catalogPrices?: CatalogPriceMap
): BrokeragePortfolioMetrics {
  const normalized = assets.map((asset) =>
    isUsMarketAsset(asset) ? normalizeUsAssetPurchaseBasis(asset, exchangeRate) : asset
  );
  const savings = derivePortfolioCash(
    normalized,
    cumulativeRealizedProfit,
    undefined,
    exchangeRate
  );
  const totalCurrentValue = Math.round(
    normalized.reduce((sum, asset) => {
      return (
        sum + calculateUnrealizedProfit(asset, marketPrices, exchangeRate, catalogPrices).currentAmount
      );
    }, 0)
  );
  const totalAssets = Math.round(savings + totalCurrentValue);
  const totalProfitAmount = totalAssets - initialCapital;
  const totalProfitRate = initialCapital > 0 ? (totalProfitAmount / initialCapital) * 100 : 0;

  return {
    savings,
    totalCurrentValue,
    totalAssets,
    totalProfitAmount,
    totalProfitRate,
    initialCapital,
  };
}
