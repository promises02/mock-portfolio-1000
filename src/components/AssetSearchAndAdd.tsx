import React, { useEffect, useRef, useState } from 'react';
import { AssetItem, AssetType } from '../types';
import { searchAssets, UnifiedAsset } from '../firebase';
import { formatCommas, inferAssetMarket, inferAssetSector, enrichAssetCurrencyFields, getDisplayPrice, DEFAULT_EXCHANGE_RATE, computeKrwEquivalent } from '../utils';
import { Search, ShoppingCart, X } from 'lucide-react';
import { ASSET_TYPE_MAP } from './AssetInputForm';
import { buildUsAssetOnFirstBuy, mergeUsAssetOnBuy, sumHoldingsPurchaseAmountKrw } from '../utils/portfolioPnL';

interface PendingAssetCard {
  id: string;
  asset: UnifiedAsset;
  quantity: string;
}

interface AssetSearchAndAddProps {
  assets: AssetItem[];
  onChangeAssets: (assets: AssetItem[]) => void;
  totalInvested: number;
  totalBudget: number;
  marketPrices?: Record<string, number>;
  customAssetsVersion?: number;
  onOpenCustomAssetModal?: () => void;
  exchangeRate?: number;
  onPersistPortfolio?: (assets: AssetItem[]) => Promise<unknown>;
  /** 모의 자산 간편 선택 헤더에 인라인 배치 */
  embedded?: boolean;
}

function getTypeShortLabel(type: AssetType): string {
  const labels: Record<AssetType, string> = {
    stock: '주식',
    etf: 'ETF',
    fund: '펀드',
    crypto: '암호화폐',
    commodity: '원자재',
    etc: '기타',
  };
  return labels[type];
}

export const AssetSearchAndAdd: React.FC<AssetSearchAndAddProps> = ({
  assets,
  onChangeAssets,
  totalInvested,
  totalBudget,
  marketPrices,
  customAssetsVersion = 0,
  onOpenCustomAssetModal,
  exchangeRate = DEFAULT_EXCHANGE_RATE,
  onPersistPortfolio,
  embedded = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchResults, setSearchResults] = useState<UnifiedAsset[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [pendingCards, setPendingCards] = useState<PendingAssetCard[]>([]);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchAssets(query);
        setSearchResults(results);
      } catch (err) {
        console.error('Asset search failed:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, customAssetsVersion]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const resolvePrice = (asset: UnifiedAsset) => {
    const customPrice = marketPrices?.[asset.name.trim()];
    if (customPrice !== undefined) return customPrice;

    const currency = asset.displayCurrency ?? 'KRW';
    if (currency === 'USD' && asset.priceUSD != null) {
      return computeKrwEquivalent('USD', asset.priceUSD, exchangeRate);
    }
    if (currency === 'KRW' && asset.priceKRW != null) {
      return asset.priceKRW;
    }
    if (currency === 'CRYPTO' && asset.priceCrypto != null) {
      return computeKrwEquivalent('CRYPTO', parseFloat(asset.priceCrypto), exchangeRate);
    }
    return asset.price;
  };

  const handleAddPendingAsset = (asset: UnifiedAsset) => {
    const alreadyPending = pendingCards.some(
      (card) => card.asset.name.trim().toLowerCase() === asset.name.trim().toLowerCase()
    );
    if (alreadyPending) {
      setMessage({ type: 'error', text: '이미 추가 대기 중인 자산입니다.' });
      return;
    }

    setPendingCards((prev) => [
      ...prev,
      { id: crypto.randomUUID(), asset, quantity: '' },
    ]);
    setSearchQuery('');
    setShowDropdown(false);
    setMessage({ type: 'success', text: `${asset.name} 카드가 생성되었습니다. 수량을 입력하고 매수하세요.` });
  };

  const handleRemovePending = (id: string) => {
    setPendingCards((prev) => prev.filter((card) => card.id !== id));
  };

  const handleUpdatePendingQuantity = (id: string, quantity: string) => {
    setPendingCards((prev) =>
      prev.map((card) => (card.id === id ? { ...card, quantity } : card))
    );
  };

  const handleBuy = async (card: PendingAssetCard) => {
    const qty = parseFloat(card.quantity) || 0;
    if (qty <= 0) {
      setMessage({ type: 'error', text: '매수 수량을 입력해주세요.' });
      return;
    }

    const price = resolvePrice(card.asset);
    const trimmedName = card.asset.name.trim();
    const existingIndex = assets.findIndex(
      (asset) => asset.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );

    let nextAssets: AssetItem[];
    if (existingIndex >= 0) {
      const existing = assets[existingIndex];
      const isUsAsset =
        existing.market === 'US' ||
        (card.asset.marketRegion === 'US' &&
          card.asset.priceUSD != null &&
          card.asset.priceUSD > 0);

      if (isUsAsset && card.asset.priceUSD != null) {
        const merged = mergeUsAssetOnBuy(
          existing,
          qty,
          price,
          card.asset.priceUSD,
          exchangeRate
        );
        nextAssets = assets.map((item, index) =>
          index === existingIndex ? { ...item, ...merged } : item
        );
      } else {
        const oldQty = existing.quantity || 0;
        const oldPrice = existing.price || 0;
        const newQty = oldQty + qty;
        const newAvgPrice = Math.round((oldPrice * oldQty + price * qty) / newQty);

        nextAssets = assets.map((item, index) =>
          index === existingIndex
            ? {
                ...item,
                quantity: newQty,
                price: newAvgPrice,
                currentPrice: price,
              }
            : item
        );
      }
    } else {
      const isUsAsset =
        card.asset.marketRegion === 'US' &&
        card.asset.priceUSD != null &&
        card.asset.priceUSD > 0;
      const enriched = enrichAssetCurrencyFields(
        {
          name: card.asset.name,
          type: card.asset.type,
          price,
          quantity: qty,
          currentPrice: price,
          market: card.asset.marketRegion,
          displayCurrency: card.asset.displayCurrency,
          priceUSD: card.asset.priceUSD,
          priceKRW: card.asset.priceKRW,
          priceCrypto: card.asset.priceCrypto,
          ...(isUsAsset
            ? {
                purchasePriceUSD: card.asset.priceUSD,
                purchaseExchangeRate: exchangeRate,
              }
            : {}),
          marketGroup: inferAssetMarket(card.asset.name, card.asset.type),
          sector: card.asset.sector || inferAssetSector(card.asset.name, card.asset.type),
          sourceUrl: card.asset.sourceUrl,
        },
        exchangeRate
      );
      nextAssets = [
        ...assets,
        {
          ...enriched,
          ...(isUsAsset && card.asset.priceUSD != null
            ? buildUsAssetOnFirstBuy(price, card.asset.priceUSD, exchangeRate, qty)
            : { price, currentPrice: price }),
        },
      ];
    }

    const nextInvested = sumHoldingsPurchaseAmountKrw(nextAssets, exchangeRate);
    if (nextInvested > totalBudget) {
      setMessage({
        type: 'error',
        text: `가용 자본(₩${formatCommas(totalBudget)}원)을 초과합니다.`,
      });
      return;
    }

    try {
      onChangeAssets(nextAssets);
      if (onPersistPortfolio) {
        await onPersistPortfolio(nextAssets);
      }
      setPendingCards((prev) => prev.filter((pending) => pending.id !== card.id));
      setMessage({
        type: 'success',
        text: `${trimmedName} ${qty}주 매수가 저장되었습니다.`,
      });
    } catch (err) {
      console.error('[AssetSearchAndAdd] buy failed:', err);
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '매수 저장 중 오류가 발생했습니다.',
      });
    }
  };

  const rootClassName = embedded
    ? 'contents'
    : 'bg-emerald-50/60 border-2 border-emerald-200 rounded-2xl p-5 sm:p-6 space-y-4 shadow-sm';

  return (
    <div ref={containerRef} data-logical-name="assetSearchAndAdd" className={rootClassName}>
      {!embedded && (
        <div>
          <h4 className="text-sm font-extrabold text-emerald-900 flex items-center gap-2">
            <Search className="w-4 h-4" />
            자산 검색 및 매수
          </h4>
          <p className="text-[11px] text-emerald-700/80 mt-1">
            프리셋·사용자 추가 자산을 검색하고, 수량 입력 후 매수하세요.
          </p>
        </div>
      )}

      <div className={`relative w-full ${embedded ? 'sm:justify-self-end' : ''}`}>
        <label htmlFor="asset-search-input" className="sr-only">
          자산 검색 및 매수
        </label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-emerald-500" />
          <input
            id="asset-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            placeholder={embedded ? '자산 검색 (삼성, AAPL 등)' : '자산명 입력 (삼성, AAPL, 비트코인 등)'}
            className={`w-full pl-8 pr-3 bg-white border border-emerald-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 rounded-lg text-slate-800 placeholder-slate-400 outline-none transition font-semibold ${
              embedded ? 'py-2 text-xs' : 'py-3 text-sm rounded-xl pl-10 pr-4'
            }`}
          />
        </div>

        {showDropdown && searchQuery.trim() && (
          <div className="absolute z-30 mt-1.5 w-full min-w-[260px] bg-white border border-emerald-200 rounded-xl shadow-lg overflow-hidden">
            {isSearching ? (
              <p className="px-4 py-3 text-xs text-slate-500">검색 중...</p>
            ) : searchResults.length === 0 ? (
              <div className="px-4 py-3 space-y-2">
                <p className="text-xs text-slate-500">검색 결과가 없습니다.</p>
                {onOpenCustomAssetModal && (
                  <button
                    type="button"
                    onClick={onOpenCustomAssetModal}
                    className="text-xs font-bold text-emerald-700 hover:underline cursor-pointer"
                  >
                    + 새 자산 직접 추가하기
                  </button>
                )}
              </div>
            ) : (
              searchResults.map((asset) => {
                const activePrice = resolvePrice(asset);
                const meta = ASSET_TYPE_MAP[asset.type];
                return (
                  <div
                    key={`${asset.name}-${asset.type}-${asset.isCustom ? 'custom' : 'preset'}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-emerald-50/50"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">
                        {asset.name}{' '}
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${meta.bg} ${meta.text} ${meta.border}`}>
                          {getTypeShortLabel(asset.type)}
                        </span>
                        {asset.isCustom && (
                          <span className="ml-1 text-[9px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                            USER
                          </span>
                        )}
                      </p>
                      <p className="text-xs font-mono text-slate-500 mt-0.5">
                        {getDisplayPrice(
                          {
                            name: asset.name,
                            type: asset.type,
                            price: activePrice,
                            quantity: 0,
                            market: asset.marketRegion,
                            displayCurrency: asset.displayCurrency,
                            priceUSD: asset.priceUSD,
                            priceKRW: asset.priceKRW,
                            priceCrypto: asset.priceCrypto,
                          },
                          exchangeRate,
                          {
                            priceKrw: asset.priceKRW ?? activePrice,
                            priceUsd: asset.priceUSD,
                            priceCrypto: asset.priceCrypto,
                          }
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddPendingAsset(asset)}
                      className="shrink-0 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition cursor-pointer"
                    >
                      이 자산 추가
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {(message || pendingCards.length > 0) && (
        <div className={`space-y-3 ${embedded ? 'col-span-full' : ''}`}>
      {message && (
        <div
          className={`px-4 py-2.5 rounded-xl text-xs font-bold border ${
            message.type === 'error'
              ? 'bg-rose-50 text-rose-700 border-rose-200'
              : 'bg-emerald-100 text-emerald-800 border-emerald-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {pendingCards.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-wide">
            매수 대기 자산 ({pendingCards.length})
          </p>
          {pendingCards.map((card) => {
            const price = resolvePrice(card.asset);
            const meta = ASSET_TYPE_MAP[card.asset.type];
            const qty = parseFloat(card.quantity) || 0;
            const estimatedTotal = Math.round(price * qty);

            return (
              <div
                key={card.id}
                className="bg-white border border-emerald-200 rounded-xl p-4 shadow-sm space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-extrabold text-slate-800">{card.asset.name}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${meta.bg} ${meta.text} ${meta.border}`}>
                        {getTypeShortLabel(card.asset.type)}
                      </span>
                    </div>
                    <p className="text-xs font-mono text-slate-500 mt-1">
                      단가: {getDisplayPrice(
                        {
                          name: card.asset.name,
                          type: card.asset.type,
                          price,
                          quantity: 0,
                          market: card.asset.marketRegion,
                          displayCurrency: card.asset.displayCurrency,
                          priceUSD: card.asset.priceUSD,
                          priceKRW: card.asset.priceKRW,
                          priceCrypto: card.asset.priceCrypto,
                        },
                        exchangeRate,
                        {
                          priceKrw: card.asset.priceKRW ?? price,
                          priceUsd: card.asset.priceUSD,
                          priceCrypto: card.asset.priceCrypto,
                        }
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemovePending(card.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                    title="카드 삭제"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-4">
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1">
                      매수 수량
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0"
                      value={card.quantity}
                      onChange={(e) => handleUpdatePendingQuantity(card.id, e.target.value)}
                      className="w-full text-xs font-mono font-bold px-3 py-2 bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 rounded-lg outline-none transition"
                    />
                  </div>
                  <div className="sm:col-span-5 text-xs text-slate-500 font-medium">
                    예상 매수 금액:{' '}
                    <span className="font-mono font-bold text-slate-800">
                      ₩{formatCommas(estimatedTotal)}원
                    </span>
                  </div>
                  <div className="sm:col-span-3">
                    <button
                      type="button"
                      onClick={() => handleBuy(card)}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      매수
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
        </div>
      )}

      {!embedded && pendingCards.length === 0 && !searchQuery.trim() && (
        <p className="text-xs text-emerald-700/70 text-center py-2">
          검색창에 자산명을 입력하거나, &apos;자산 직접 추가&apos;로 새 종목을 등록하세요.
        </p>
      )}
    </div>
  );
};
