import React, { useMemo, useState } from 'react';
import { Plus, Loader2, X, Layers } from 'lucide-react';
import { normalizeCustomAsset } from '../firebase';
import { CustomAsset, AssetType, AssetMarket, AssetItem } from '../types';
import {
  RECOMMENDED_ASSETS,
  RecommendedAsset,
  DOMESTIC_PRESETS,
  FOREIGN_PRESETS,
  CRYPTO_PRESETS,
  PresetAsset,
  getUsAssetDisplayName,
} from '../presets';
import {
  formatCommas,
  convertToKRW,
  DEFAULT_EXCHANGE_RATE,
  inferAssetMarketRegion,
  enrichAssetCurrencyFields,
  inferAssetMarket,
  inferAssetSector,
  resolveMarketPriceKRW,
  roundFractionalQuantity,
  getQuantityUnitLabel,
  formatQuantityDisplay,
} from '../utils';
import {
  CatalogPriceMap,
  sumHoldingsPurchaseAmountKrw,
  buildUsAssetOnFirstBuy,
  mergeUsAssetOnBuy,
} from '../utils/portfolioPnL';
import { AssetSearchAndAdd } from './AssetSearchAndAdd';

interface PickableAsset {
  id: string;
  name: string;
  displayName?: string;
  type: AssetType;
  marketRegion: AssetMarket;
  priceKRW: number;
  priceUSD?: number;
  ticker?: string;
  isCustom?: boolean;
}

type AssetTab = 'domestic' | 'foreign' | 'crypto' | 'custom';
type AssetSortOrder = 'name-asc' | 'price-desc' | 'price-asc';

const FOREIGN_PRESET_NAME_KEYS = new Set(
  FOREIGN_PRESETS.map((preset) => preset.name.trim().toLowerCase())
);
const DOMESTIC_PRESET_NAME_KEYS = new Set(
  DOMESTIC_PRESETS.map((preset) => preset.name.trim().toLowerCase())
);
const CRYPTO_PRESET_NAME_KEYS = new Set(
  CRYPTO_PRESETS.map((preset) => preset.name.trim().toLowerCase())
);

function presetNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function resolvePickableMarketRegion(
  name: string,
  type: AssetType,
  stored?: AssetMarket
): AssetMarket {
  const key = presetNameKey(name);
  if (FOREIGN_PRESET_NAME_KEYS.has(key)) return 'US';
  if (DOMESTIC_PRESET_NAME_KEYS.has(key)) return 'Korea';
  if (CRYPTO_PRESET_NAME_KEYS.has(key)) return 'Crypto';
  if (stored) return stored;
  return inferAssetMarketRegion(name, type);
}

const TYPE_SHORT_LABEL: Partial<Record<AssetType, string>> = {
  stock: '주식',
  etf: 'ETF',
  crypto: '암호화폐',
  commodity: '원자재',
};

const TYPE_BADGE_STYLE: Partial<Record<AssetType, string>> = {
  stock: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  etf: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  crypto: 'bg-violet-100 text-violet-800 border-violet-200',
  commodity: 'bg-orange-100 text-orange-800 border-orange-200',
};

const MARKET_CARD_STYLE: Record<
  AssetMarket,
  { border: string; bg: string; hoverBg: string; price: string }
> = {
  Korea: {
    border: 'border-amber-300/80',
    bg: 'bg-amber-50/50',
    hoverBg: 'hover:bg-amber-50',
    price: 'text-amber-700',
  },
  US: {
    border: 'border-blue-300/80',
    bg: 'bg-blue-50/50',
    hoverBg: 'hover:bg-blue-50',
    price: 'text-blue-700',
  },
  Crypto: {
    border: 'border-purple-300/80',
    bg: 'bg-purple-50/50',
    hoverBg: 'hover:bg-purple-50',
    price: 'text-purple-700',
  },
};

function resolvePickablePriceKRW(asset: CustomAsset, exchangeRate: number): number {
  if (asset.displayCurrency === 'USD' && asset.priceUSD != null && Number.isFinite(asset.priceUSD)) {
    return Math.round(convertToKRW(asset.priceUSD, exchangeRate));
  }
  if (asset.priceKRW != null && Number.isFinite(asset.priceKRW) && asset.priceKRW > 0) {
    return asset.priceKRW;
  }
  if (asset.priceUSD != null && Number.isFinite(asset.priceUSD) && asset.priceUSD > 0) {
    return Math.round(convertToKRW(asset.priceUSD, exchangeRate));
  }
  if (asset.price != null && Number.isFinite(asset.price) && asset.price > 0) {
    return asset.price;
  }
  return 0;
}

function resolvePickablePriceUSD(asset: CustomAsset, presetUsd?: number): number | undefined {
  if (asset.priceUSD != null && Number.isFinite(asset.priceUSD) && asset.priceUSD > 0) {
    return asset.priceUSD;
  }
  if (presetUsd != null && Number.isFinite(presetUsd) && presetUsd > 0) {
    return presetUsd;
  }
  return undefined;
}

function recommendedByName(name: string): RecommendedAsset | undefined {
  return RECOMMENDED_ASSETS.find((r) => r.name === name);
}

function presetToPickable(
  preset: PresetAsset,
  marketRegion: AssetMarket,
  exchangeRate: number,
  marketPrices?: Record<string, number>,
  catalogPrices?: CatalogPriceMap
): PickableAsset {
  const rec = recommendedByName(preset.name);
  const fallbackId = `preset_${preset.name.replace(/\s+/g, '_')}`;
  const priceUSD = preset.usdPrice;
  const basePriceKRW =
    priceUSD != null && marketRegion === 'US'
      ? Math.round(convertToKRW(priceUSD, exchangeRate))
      : rec?.priceKRW ?? preset.price;
  const priceKRW = resolveMarketPriceKRW(preset.name, basePriceKRW, marketPrices, catalogPrices);

  return {
    id: rec?.id ?? fallbackId.replace(/[/\\.#$[\]]/g, '_'),
    name: preset.name,
    displayName: marketRegion === 'US' ? getUsAssetDisplayName(preset.name) : undefined,
    type: preset.type,
    marketRegion,
    priceKRW,
    priceUSD: marketRegion === 'US' ? priceUSD : undefined,
    ticker: rec?.ticker ?? preset.ticker,
    isCustom: !!rec,
  };
}

function customToPickable(
  asset: CustomAsset,
  exchangeRate: number,
  marketPrices?: Record<string, number>,
  catalogPrices?: CatalogPriceMap
): PickableAsset | null {
  const normalized = normalizeCustomAsset(asset, asset.id);
  const marketRegion = resolvePickableMarketRegion(
    normalized.name,
    normalized.type,
    normalized.marketRegion
  );
  const preset = FOREIGN_PRESETS.find(
    (p) => presetNameKey(p.name) === presetNameKey(normalized.name)
  );
  const priceUSD = resolvePickablePriceUSD(normalized, preset?.usdPrice);
  const basePriceKRW = resolvePickablePriceKRW(normalized, exchangeRate);
  const priceKRW = resolveMarketPriceKRW(normalized.name, basePriceKRW, marketPrices, catalogPrices);
  if (priceKRW <= 0) return null;

  return {
    id: normalized.id,
    name: normalized.name,
    displayName: marketRegion === 'US' ? getUsAssetDisplayName(normalized.name) : undefined,
    type: normalized.type,
    marketRegion,
    priceKRW,
    priceUSD: marketRegion === 'US' ? priceUSD : undefined,
    ticker: normalized.ticker,
    isCustom: true,
  };
}

function mergePickablesByName(presets: PickableAsset[], customs: PickableAsset[]): PickableAsset[] {
  const seen = new Set(presets.map((asset) => asset.name.trim().toLowerCase()));
  const merged = [...presets];
  for (const asset of customs) {
    const key = asset.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(asset);
  }
  return merged;
}

function formatUsdPrice(usd: number): string {
  return usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 카드 너비 내 가격 한 줄 표시 — 문자 수에 따라 글자 크기 축소 */
function resolveCompactPriceFontSize(priceText: string): string {
  const length = priceText.length;
  if (length >= 14) return 'text-[8px] sm:text-[9px]';
  if (length >= 12) return 'text-[9px] sm:text-[10px]';
  if (length >= 10) return 'text-[10px] sm:text-[11px]';
  if (length >= 8) return 'text-[11px] sm:text-[12px]';
  return 'text-[13px] sm:text-[15px]';
}

function resolvePickableDisplayPriceKrw(
  asset: PickableAsset,
  exchangeRate: number,
  marketPrices?: Record<string, number>,
  catalogPrices?: CatalogPriceMap
): number {
  const isUsAsset = asset.marketRegion === 'US' && asset.priceUSD != null && asset.priceUSD > 0;
  const baseKrw = isUsAsset
    ? Math.round(convertToKRW(asset.priceUSD!, exchangeRate))
    : asset.priceKRW;
  return resolveMarketPriceKRW(asset.name, baseKrw, marketPrices, catalogPrices);
}

function sortPickableAssets(
  assets: PickableAsset[],
  order: AssetSortOrder,
  exchangeRate: number,
  marketPrices?: Record<string, number>,
  catalogPrices?: CatalogPriceMap
): PickableAsset[] {
  const sorted = [...assets];
  if (order === 'name-asc') {
    sorted.sort((a, b) =>
      (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name, 'ko')
    );
    return sorted;
  }
  const withPrice = sorted.map((asset) => ({
    asset,
    price: resolvePickableDisplayPriceKrw(asset, exchangeRate, marketPrices, catalogPrices),
  }));
  withPrice.sort((a, b) =>
    order === 'price-desc' ? b.price - a.price : a.price - b.price
  );
  return withPrice.map(({ asset }) => asset);
}

interface BuyAssetModalProps {
  asset: PickableAsset;
  availableCash: number;
  exchangeRate: number;
  marketPrices?: Record<string, number>;
  catalogPrices?: CatalogPriceMap;
  assets: AssetItem[];
  onChangeAssets: (assets: AssetItem[]) => void;
  totalBudget: number;
  onPersistPortfolio?: (assets: AssetItem[]) => Promise<unknown>;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export const BuyAssetModal: React.FC<BuyAssetModalProps> = ({
  asset,
  availableCash,
  exchangeRate,
  marketPrices,
  catalogPrices,
  assets,
  onChangeAssets,
  totalBudget,
  onPersistPortfolio,
  onClose,
  onSuccess,
  onError,
}) => {
  const [quantity, setQuantity] = useState('1');
  const [isBuying, setIsBuying] = useState(false);
  const [error, setError] = useState('');

  const isUsAsset = asset.marketRegion === 'US' && asset.priceUSD != null && asset.priceUSD > 0;
  const isCryptoAsset = asset.marketRegion === 'Crypto' || asset.type === 'crypto';
  const assetRef = {
    name: asset.name,
    type: asset.type,
    market: asset.marketRegion,
  };
  const unitLabel = getQuantityUnitLabel(assetRef);
  const qtyStep = isCryptoAsset ? 'any' : '1';
  const baseKrw = isUsAsset
    ? Math.round(convertToKRW(asset.priceUSD!, exchangeRate))
    : asset.priceKRW;
  const unitPriceKrw = resolveMarketPriceKRW(asset.name, baseKrw, marketPrices, catalogPrices);

  const qty = parseFloat(quantity) || 0;
  const normalizedQty = isCryptoAsset ? roundFractionalQuantity(qty, assetRef) : Math.floor(qty);
  const estimatedTotal = Math.round(unitPriceKrw * normalizedQty);
  const cashAfter = availableCash - estimatedTotal;
  const canAfford = normalizedQty > 0 && estimatedTotal <= availableCash;

  const handleBuy = async () => {
    setError('');
    if (normalizedQty <= 0) {
      setError('수량은 0보다 커야 합니다.');
      return;
    }
    if (!isCryptoAsset && !Number.isInteger(normalizedQty)) {
      setError('주식·ETF 수량은 1 이상의 정수여야 합니다.');
      return;
    }
    if (!canAfford) {
      setError('보유 현금이 부족합니다.');
      return;
    }

    const trimmedName = asset.name.trim();
    const existingIndex = assets.findIndex(
      (item) => item.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );

    let nextAssets: AssetItem[];
    if (existingIndex >= 0) {
      const existing = assets[existingIndex];
      if (isUsAsset && asset.priceUSD != null) {
        const merged = mergeUsAssetOnBuy(
          existing,
          normalizedQty,
          unitPriceKrw,
          asset.priceUSD,
          exchangeRate
        );
        nextAssets = assets.map((item, index) =>
          index === existingIndex ? { ...item, ...merged } : item
        );
      } else {
        const newQty = isCryptoAsset
          ? roundFractionalQuantity(existing.quantity + normalizedQty, assetRef)
          : existing.quantity + normalizedQty;
        const newAvgPrice = Math.round(
          (existing.price * existing.quantity + unitPriceKrw * normalizedQty) / newQty
        );
        nextAssets = assets.map((item, index) =>
          index === existingIndex
            ? {
                ...item,
                quantity: newQty,
                price: newAvgPrice,
                currentPrice: unitPriceKrw,
                ...(isCryptoAsset
                  ? {
                      totalPurchaseAmount:
                        Math.round(
                          (existing.totalPurchaseAmount ?? existing.price * existing.quantity) +
                            estimatedTotal
                        ),
                      displayCurrency: 'CRYPTO' as const,
                      market: 'Crypto' as const,
                    }
                  : {}),
              }
            : item
        );
      }
    } else {
      const enriched = enrichAssetCurrencyFields(
        {
          name: asset.name,
          type: asset.type,
          price: unitPriceKrw,
          quantity: normalizedQty,
          currentPrice: unitPriceKrw,
          market: asset.marketRegion,
          displayCurrency: isUsAsset ? 'USD' : isCryptoAsset ? 'CRYPTO' : 'KRW',
          ...(isUsAsset && asset.priceUSD != null
            ? {
                priceUSD: asset.priceUSD,
                purchasePriceUSD: asset.priceUSD,
                purchaseExchangeRate: exchangeRate,
              }
            : {}),
          ...(!isUsAsset ? { priceKRW: unitPriceKrw } : {}),
          marketGroup: inferAssetMarket(asset.name, asset.type),
          sector: inferAssetSector(asset.name, asset.type),
          ...(asset.ticker ? { ticker: asset.ticker } : {}),
        },
        exchangeRate
      );
      nextAssets = [
        ...assets,
        {
          ...enriched,
          ...(isUsAsset && asset.priceUSD != null
            ? buildUsAssetOnFirstBuy(unitPriceKrw, asset.priceUSD, exchangeRate, normalizedQty)
            : {
                price: unitPriceKrw,
                currentPrice: unitPriceKrw,
                ...(isCryptoAsset ? { totalPurchaseAmount: estimatedTotal } : {}),
              }),
        },
      ];
    }

    const nextInvested = sumHoldingsPurchaseAmountKrw(nextAssets, exchangeRate);
    if (nextInvested > totalBudget) {
      setError(`가용 자본(₩${formatCommas(totalBudget)}원)을 초과합니다.`);
      return;
    }

    setIsBuying(true);
    try {
      onChangeAssets(nextAssets);
      if (onPersistPortfolio) {
        await onPersistPortfolio(nextAssets);
      }
      onSuccess(`${asset.name} ${formatQuantityDisplay(normalizedQty, assetRef)}${unitLabel}를 ${formatCommas(estimatedTotal)}원에 매수했습니다`);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '매수 중 오류가 발생했습니다.';
      console.error('[BuyAssetModal] purchase failed:', err);
      setError(msg);
      onError(msg);
    } finally {
      setIsBuying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div
        className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
        data-logical-name="tradingSystemPhase5"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50">
          <h3 className="text-sm font-extrabold text-slate-800">
            {(asset.displayName ?? asset.name)} 매수
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isBuying}
            className="p-1 text-slate-400 hover:text-slate-700 rounded-lg transition cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {isUsAsset ? (
            <div className="space-y-1 text-xs font-mono text-slate-700">
              <p>
                현재가(USD):{' '}
                <span className="font-bold text-blue-700">${formatUsdPrice(asset.priceUSD!)}</span>
              </p>
              <p>
                환산가(KRW):{' '}
                <span className="font-bold">{formatCommas(unitPriceKrw)}원</span>
                <span className="text-slate-400 font-sans ml-1">(환율 {formatCommas(exchangeRate)}원)</span>
              </p>
            </div>
          ) : (
            <p className="text-xs font-mono text-slate-700">
              현재가: <span className="font-bold">{formatCommas(unitPriceKrw)}원</span>
            </p>
          )}

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              수량 ({unitLabel})
            </label>
            <input
              type="number"
              min="0"
              step={qtyStep}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              disabled={isBuying}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-lg text-sm font-mono outline-none transition disabled:opacity-60"
            />
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2.5 space-y-1.5 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-500">예상 금액</span>
              <span className="font-mono font-bold text-slate-800">{formatCommas(estimatedTotal)}원</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">보유 현금</span>
              <span className={`font-mono font-bold ${canAfford ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatCommas(availableCash)}원{!canAfford && qty > 0 ? ' (부족)' : ''}
              </span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5">
              <span className="text-slate-500">매수 후</span>
              <span className="font-mono font-bold text-slate-700">{formatCommas(Math.max(0, cashAfter))}원</span>
            </div>
          </div>

          {error && (
            <p className="text-[11px] font-semibold text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-2.5 py-1.5">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-0.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isBuying}
              className="flex-1 py-2 border border-slate-200 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleBuy}
              disabled={isBuying || !canAfford}
              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1"
            >
              {isBuying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  매수 중...
                </>
              ) : (
                '매수'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const CompactAssetCard: React.FC<{
  asset: PickableAsset;
  exchangeRate: number;
  marketPrices?: Record<string, number>;
  catalogPrices?: CatalogPriceMap;
  onAdd: (asset: PickableAsset) => void;
}> = ({ asset, exchangeRate, marketPrices, catalogPrices, onAdd }) => {
  const marketStyle = MARKET_CARD_STYLE[asset.marketRegion];
  const typeLabel = TYPE_SHORT_LABEL[asset.type] ?? asset.type;
  const typeBadgeStyle =
    TYPE_BADGE_STYLE[asset.type] ?? 'bg-slate-100 text-slate-700 border-slate-200';
  const handleCardClick = () => onAdd(asset);
  const isUsAsset = asset.marketRegion === 'US' && asset.priceUSD != null && asset.priceUSD > 0;
  const baseKrw = isUsAsset
    ? Math.round(convertToKRW(asset.priceUSD!, exchangeRate))
    : asset.priceKRW;
  const priceKrw = resolveMarketPriceKRW(asset.name, baseKrw, marketPrices, catalogPrices);
  const krwPriceText = `${formatCommas(priceKrw)}원`;
  const krwPriceSizeClass = resolveCompactPriceFontSize(krwPriceText);
  const usdPriceText = isUsAsset ? `$${formatUsdPrice(asset.priceUSD!)}` : '';
  const usdPriceSizeClass = usdPriceText
    ? resolveCompactPriceFontSize(usdPriceText)
    : krwPriceSizeClass;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
      className={`border ${marketStyle.border} ${marketStyle.bg} ${marketStyle.hoverBg} rounded-lg p-3 min-h-[92px] cursor-pointer transition-colors flex flex-col justify-between`}
      data-logical-name="assetCardDebugAndCompact"
    >
      <div className="flex items-center justify-between gap-1 mb-1">
        <span
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded border leading-none ${typeBadgeStyle}`}
        >
          {typeLabel}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAdd(asset);
          }}
          className="w-5 h-5 shrink-0 flex items-center justify-center text-slate-400 hover:text-emerald-700 hover:bg-white/80 rounded transition cursor-pointer"
          title={`${asset.name} 매수`}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="min-w-0">
        <p className={`text-[13px] font-semibold text-slate-800 truncate leading-tight`}>
          {asset.displayName ?? asset.name}
          {asset.isCustom && (
            <span className="ml-0.5 text-[8px] font-black text-orange-600 align-middle">CUSTOM</span>
          )}
        </p>
        {isUsAsset ? (
          <div className="mt-1 space-y-0.5 min-w-0">
            <p
              className={`font-bold font-mono ${marketStyle.price} leading-none whitespace-nowrap ${usdPriceSizeClass}`}
            >
              {usdPriceText}
            </p>
            <p
              className={`font-mono text-slate-500 leading-none whitespace-nowrap ${krwPriceSizeClass}`}
            >
              {krwPriceText}
            </p>
          </div>
        ) : (
          <p
            className={`font-bold font-mono ${marketStyle.price} leading-none mt-1 whitespace-nowrap ${krwPriceSizeClass}`}
          >
            {krwPriceText}
          </p>
        )}
      </div>
    </div>
  );
};

interface RecommendedAssetsSectionProps {
  nickname: string;
  availableCash: number;
  exchangeRate?: number;
  communityCustomAssets?: CustomAsset[];
  assets: AssetItem[];
  onChangeAssets: (assets: AssetItem[]) => void;
  totalInvested: number;
  totalBudget: number;
  marketPrices?: Record<string, number>;
  catalogPrices?: CatalogPriceMap;
  customAssetsVersion?: number;
  onOpenCustomAssetModal?: () => void;
  onBuySuccess: (message: string) => void;
  onBuyError: (message: string) => void;
  onPersistPortfolio?: (assets: AssetItem[]) => Promise<unknown>;
}

export const RecommendedAssetsSection: React.FC<RecommendedAssetsSectionProps> = ({
  nickname,
  availableCash,
  exchangeRate = DEFAULT_EXCHANGE_RATE,
  communityCustomAssets = [],
  assets,
  onChangeAssets,
  totalInvested,
  totalBudget,
  marketPrices,
  catalogPrices,
  customAssetsVersion = 0,
  onOpenCustomAssetModal,
  onBuySuccess,
  onBuyError,
  onPersistPortfolio,
}) => {
  const [activeTab, setActiveTab] = useState<AssetTab>('domestic');
  const [sortOrder, setSortOrder] = useState<AssetSortOrder>('name-asc');
  const [selectedAsset, setSelectedAsset] = useState<PickableAsset | null>(null);

  const tabs: { key: AssetTab; label: string }[] = [
    { key: 'domestic', label: '국내 주식/ETF' },
    { key: 'foreign', label: '미국 주식/ETF' },
    { key: 'crypto', label: '암호화폐/원자재' },
    { key: 'custom', label: '⭐ 참여자 추가 자산' },
  ];

  const communityPickables = useMemo((): PickableAsset[] => {
    return communityCustomAssets
      .map((asset) => customToPickable(asset, exchangeRate, marketPrices, catalogPrices))
      .filter((asset): asset is PickableAsset => asset != null);
  }, [communityCustomAssets, exchangeRate, marketPrices, catalogPrices]);

  const visibleAssets = useMemo((): PickableAsset[] => {
    const customsForRegion = (region: AssetMarket) =>
      communityPickables.filter((asset) => {
        if (asset.marketRegion !== region) return false;
        if (region === 'Korea' && FOREIGN_PRESET_NAME_KEYS.has(presetNameKey(asset.name))) {
          return false;
        }
        if (region === 'US' && DOMESTIC_PRESET_NAME_KEYS.has(presetNameKey(asset.name))) {
          return false;
        }
        return true;
      });

    let merged: PickableAsset[];
    if (activeTab === 'domestic') {
      merged = mergePickablesByName(
        DOMESTIC_PRESETS.map((preset) =>
          presetToPickable(preset, 'Korea', exchangeRate, marketPrices, catalogPrices)
        ),
        customsForRegion('Korea')
      );
    } else if (activeTab === 'foreign') {
      merged = mergePickablesByName(
        FOREIGN_PRESETS.map((preset) =>
          presetToPickable(preset, 'US', exchangeRate, marketPrices, catalogPrices)
        ),
        customsForRegion('US')
      );
    } else if (activeTab === 'crypto') {
      merged = mergePickablesByName(
        CRYPTO_PRESETS.map((preset) =>
          presetToPickable(preset, 'Crypto', exchangeRate, marketPrices, catalogPrices)
        ),
        customsForRegion('Crypto')
      );
    } else {
      merged = communityPickables;
    }

    return sortPickableAssets(merged, sortOrder, exchangeRate, marketPrices, catalogPrices);
  }, [
    activeTab,
    communityPickables,
    exchangeRate,
    marketPrices,
    catalogPrices,
    sortOrder,
  ]);

  const handleSuccess = (message: string) => {
    onBuySuccess(message);
    setSelectedAsset(null);
  };

  const assetGridRowClass = activeTab === 'custom' ? 'row-start-3' : 'row-start-5';

  return (
    <>
      <div
        className="bg-emerald-50/40 border border-emerald-200 rounded-xl p-3 sm:p-4 space-y-2.5"
        data-logical-name="tradingSystemPhase5"
      >
        <div className="grid grid-cols-[auto_minmax(7.5rem,13rem)_1fr] gap-x-2 gap-y-2 items-center">
          <h3 className="col-start-1 row-start-1 text-xs font-extrabold text-emerald-900 flex items-center gap-1.5 shrink-0 whitespace-nowrap">
            <Layers className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            모의 자산 간편 선택
          </h3>

          <AssetSearchAndAdd
            embedded
            assets={assets}
            onChangeAssets={onChangeAssets}
            onPersistPortfolio={onPersistPortfolio}
            totalInvested={totalInvested}
            totalBudget={totalBudget}
            marketPrices={marketPrices}
            customAssetsVersion={customAssetsVersion}
            onOpenCustomAssetModal={onOpenCustomAssetModal}
            exchangeRate={exchangeRate}
          />

          <div className="col-start-3 row-start-1 flex items-center justify-end gap-2 shrink-0 whitespace-nowrap text-[8px] sm:text-[9px] font-bold text-slate-500 ml-auto">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm border border-amber-300 bg-amber-50 shrink-0" />
              국내
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm border border-blue-300 bg-blue-50 shrink-0" />
              미국
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm border border-purple-300 bg-purple-50 shrink-0" />
              암호화폐
            </span>
          </div>

          <div className="col-span-3 row-start-2 flex flex-nowrap items-center justify-start gap-1 overflow-x-auto scrollbar-none">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`shrink-0 whitespace-nowrap px-2 py-1 text-[9px] sm:text-[10px] font-bold rounded-md border transition cursor-pointer ${
                  activeTab === tab.key
                    ? 'bg-white text-emerald-800 border-emerald-300 shadow-sm'
                    : 'bg-transparent text-slate-500 border-transparent hover:bg-white/60 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab !== 'custom' && (
            <div className="col-span-3 row-start-3 flex flex-nowrap items-center justify-start gap-1 overflow-x-auto scrollbar-none">
              <span className="shrink-0 whitespace-nowrap text-[9px] font-bold text-slate-400 mr-0.5">
                정렬
              </span>
              {(
                [
                  { key: 'name-asc' as const, label: '가나다순' },
                  { key: 'price-desc' as const, label: '가격 높은순' },
                  { key: 'price-asc' as const, label: '가격 낮은순' },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSortOrder(option.key)}
                  className={`shrink-0 whitespace-nowrap px-2 py-0.5 text-[9px] font-bold rounded-md border transition cursor-pointer ${
                    sortOrder === option.key
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          {visibleAssets.length === 0 ? (
            <p className={`col-span-3 ${assetGridRowClass} text-[11px] text-slate-500 py-4 text-center`}>
              {activeTab === 'custom'
                ? '참여자가 추가한 자산이 없습니다.'
                : '표시할 자산이 없습니다.'}
            </p>
          ) : (
            <div className={`col-span-3 ${assetGridRowClass} grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3`}>
              {visibleAssets.map((asset) => (
                <CompactAssetCard
                  key={`${activeTab}-${asset.id}`}
                  asset={asset}
                  exchangeRate={exchangeRate}
                  marketPrices={marketPrices}
                  catalogPrices={catalogPrices}
                  onAdd={setSelectedAsset}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedAsset && (
        <BuyAssetModal
          asset={selectedAsset}
          availableCash={availableCash}
          exchangeRate={exchangeRate}
          marketPrices={marketPrices}
          catalogPrices={catalogPrices}
          assets={assets}
          onChangeAssets={onChangeAssets}
          totalBudget={totalBudget}
          onPersistPortfolio={onPersistPortfolio}
          onClose={() => setSelectedAsset(null)}
          onSuccess={handleSuccess}
          onError={onBuyError}
        />
      )}
    </>
  );
};
