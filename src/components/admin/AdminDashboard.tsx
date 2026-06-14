import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  LogOut,
  Loader2,
  Pencil,
  DollarSign,
  Layers,
  ArrowDownAZ,
  ArrowUp,
  ArrowDown,
  Plus,
} from 'lucide-react';
import { CustomAsset, MarketPriceMap, AssetMarket, AssetType } from '../../types';
import {
  buildAdminAssetList,
  subscribeCommunityCustomAssets,
  subscribeGlobalExchangeRate,
  subscribeMarketPrices,
  matchesAdminAssetSearch,
  formatAdminUpdatedLabel,
} from '../../firebase';
import {
  formatCommas,
  inferAssetMarketRegion,
  getDefaultDisplayCurrency,
  DEFAULT_EXCHANGE_RATE,
  convertToKRW,
} from '../../utils';
import { AdminPriceEditModal } from './AdminPriceEditModal';
import { AdminExchangeRateModal } from './AdminExchangeRateModal';
import { CustomAssetModal } from '../CustomAssetModal';

interface AdminDashboardProps {
  onLogout: () => void;
}

type AssetTab = 'all' | 'domestic' | 'foreign' | 'crypto';
type SortOrder = 'name' | 'price-desc' | 'price-asc';

const SORT_OPTIONS: { key: SortOrder; label: string; icon: React.ReactNode }[] = [
  { key: 'name', label: '가나다순', icon: <ArrowDownAZ className="w-3 h-3" /> },
  { key: 'price-desc', label: '가격 높은순', icon: <ArrowDown className="w-3 h-3" /> },
  { key: 'price-asc', label: '가격 낮은순', icon: <ArrowUp className="w-3 h-3" /> },
];

const TYPE_SHORT_LABEL: Partial<Record<AssetType, string>> = {
  stock: '주식',
  etf: 'ETF',
  crypto: '암호화폐',
  commodity: '원자재',
  fund: '펀드',
  etc: '기타',
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

const TABS: { key: AssetTab; label: string; region?: AssetMarket }[] = [
  { key: 'all', label: '전체' },
  { key: 'domestic', label: '국내 주식/ETF', region: 'Korea' },
  { key: 'foreign', label: '미국 주식/ETF', region: 'US' },
  { key: 'crypto', label: '암호화폐/원자재', region: 'Crypto' },
];

function formatUsdPrice(usd: number): string {
  return usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getMarketRegion(asset: CustomAsset): AssetMarket {
  return asset.marketRegion ?? inferAssetMarketRegion(asset.name, asset.type);
}

function resolvePriceKRW(asset: CustomAsset, exchangeRate: number, marketPrices?: MarketPriceMap): number {
  const override = marketPrices?.[asset.name.trim()];
  if (override !== undefined && override > 0) return override;

  const currency = asset.displayCurrency ?? getDefaultDisplayCurrency(getMarketRegion(asset));
  if (currency === 'USD' && asset.priceUSD != null) {
    return Math.round(convertToKRW(asset.priceUSD, exchangeRate));
  }
  return asset.priceKRW ?? asset.price;
}

function sortAssets(
  list: CustomAsset[],
  sortOrder: SortOrder,
  exchangeRate: number,
  marketPrices: MarketPriceMap
): CustomAsset[] {
  const sorted = [...list];
  if (sortOrder === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  } else if (sortOrder === 'price-desc') {
    sorted.sort(
      (a, b) =>
        resolvePriceKRW(b, exchangeRate, marketPrices) - resolvePriceKRW(a, exchangeRate, marketPrices)
    );
  } else {
    sorted.sort(
      (a, b) =>
        resolvePriceKRW(a, exchangeRate, marketPrices) - resolvePriceKRW(b, exchangeRate, marketPrices)
    );
  }
  return sorted;
}

interface AdminCompactAssetCardProps {
  asset: CustomAsset;
  exchangeRate: number;
  marketPrices: MarketPriceMap;
  onEdit: (asset: CustomAsset) => void;
}

const AdminCompactAssetCard: React.FC<AdminCompactAssetCardProps> = ({
  asset,
  exchangeRate,
  marketPrices,
  onEdit,
}) => {
  const marketRegion = getMarketRegion(asset);
  const marketStyle = MARKET_CARD_STYLE[marketRegion];
  const typeLabel = TYPE_SHORT_LABEL[asset.type] ?? asset.type;
  const typeBadgeStyle =
    TYPE_BADGE_STYLE[asset.type] ?? 'bg-slate-100 text-slate-700 border-slate-200';
  const currency = asset.displayCurrency ?? getDefaultDisplayCurrency(marketRegion);
  const isUsAsset = currency === 'USD' && asset.priceUSD != null && asset.priceUSD > 0;
  const priceKrw = resolvePriceKRW(asset, exchangeRate, marketPrices);

  return (
    <div
      className={`border ${marketStyle.border} ${marketStyle.bg} ${marketStyle.hoverBg} rounded-lg p-3 min-h-[92px] transition-colors flex flex-col justify-between group`}
      data-logical-name="adminModeEnhancedPriceUpdate"
    >
      <div className="flex items-center justify-between gap-1 mb-1">
        <span
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded border leading-none ${typeBadgeStyle}`}
        >
          {typeLabel}
        </span>
        <button
          type="button"
          onClick={() => onEdit(asset)}
          className="w-5 h-5 shrink-0 flex items-center justify-center text-slate-400 hover:text-indigo-700 hover:bg-white/80 rounded transition cursor-pointer"
          title={`${asset.name} 시세 수정`}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-slate-800 truncate leading-tight" title={asset.name}>
          {asset.name}
        </p>
        {asset.ticker && (
          <p className="text-[9px] font-mono text-slate-400 truncate leading-none mt-0.5">
            {asset.ticker}
          </p>
        )}
        {isUsAsset ? (
          <div className="mt-1 space-y-0.5">
            <p className={`text-[14px] font-bold font-mono ${marketStyle.price} leading-none`}>
              ${formatUsdPrice(asset.priceUSD!)}
            </p>
            <p className="text-[11px] font-mono text-slate-500 leading-none">
              {formatCommas(priceKrw)}원
            </p>
          </div>
        ) : (
          <p className={`text-[15px] font-bold font-mono ${marketStyle.price} leading-none mt-1`}>
            {formatCommas(Math.round(priceKrw))}원
          </p>
        )}
        <p className="text-[8px] text-slate-400 truncate mt-1 leading-none">
          {formatAdminUpdatedLabel(asset)}
        </p>
      </div>
    </div>
  );
};

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onLogout }) => {
  const [communityCustomAssets, setCommunityCustomAssets] = useState<CustomAsset[]>([]);
  const [marketPrices, setMarketPrices] = useState<MarketPriceMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<AssetTab>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('name');
  const [editingAsset, setEditingAsset] = useState<CustomAsset | null>(null);
  const [showExchangeRateModal, setShowExchangeRateModal] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [exchangeRate, setExchangeRate] = useState(DEFAULT_EXCHANGE_RATE);
  const [showAddAssetModal, setShowAddAssetModal] = useState(false);

  useEffect(() => {
    return subscribeGlobalExchangeRate((rate) => {
      setExchangeRate(rate);
    });
  }, []);

  useEffect(() => {
    return subscribeMarketPrices(setMarketPrices);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeCommunityCustomAssets((assets) => {
      setCommunityCustomAssets(assets);
      setIsLoading(false);
    });
    return unsubscribe;
  }, []);

  const assets = useMemo(
    () => buildAdminAssetList(communityCustomAssets, marketPrices),
    [communityCustomAssets, marketPrices]
  );

  const activeRegion = TABS.find((t) => t.key === activeTab)?.region;

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      if (!matchesAdminAssetSearch(asset, searchQuery)) return false;
      if (activeTab === 'all') return true;
      return getMarketRegion(asset) === activeRegion;
    });
  }, [assets, searchQuery, activeTab, activeRegion]);

  const sortedAssets = useMemo(
    () => sortAssets(filteredAssets, sortOrder, exchangeRate, marketPrices),
    [filteredAssets, sortOrder, exchangeRate, marketPrices]
  );

  const tabCounts = useMemo(() => {
    const searched = assets.filter((a) => matchesAdminAssetSearch(a, searchQuery));
    return {
      all: searched.length,
      domestic: searched.filter((a) => getMarketRegion(a) === 'Korea').length,
      foreign: searched.filter((a) => getMarketRegion(a) === 'US').length,
      crypto: searched.filter((a) => getMarketRegion(a) === 'Crypto').length,
    };
  }, [assets, searchQuery]);

  return (
    <div
      className="w-full bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden"
      data-logical-name="adminModeEnhancedPriceUpdate"
    >
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-white">
        <h2 className="text-base sm:text-lg font-extrabold text-slate-800 flex items-center gap-2">
          <span>👨‍💼</span>
          관리자 대시보드 — 시세 관리
        </h2>
        {!isLoading && (
          <p className="text-[11px] text-slate-500 mt-0.5">
            총 {assets.length}개 자산
            {searchQuery.trim() ? ` · 검색 ${filteredAssets.length}개` : ''}
          </p>
        )}
      </div>

      <div
        className="px-4 sm:px-5 py-3 border-b border-slate-100 bg-slate-50/60"
        data-logical-name="multiCurrencySupport"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5 mb-1">
              <DollarSign className="w-3.5 h-3.5 text-indigo-600" />
              【환율 설정】
            </h3>
            <p className="text-[11px] text-slate-600">
              현재 환율: 1 USD = {formatCommas(exchangeRate)}원
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowExchangeRateModal(true)}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition cursor-pointer shrink-0 self-start sm:self-center"
          >
            환율 수정
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-5 py-3 sm:p-4">
        <div
          className="bg-emerald-50/40 border border-emerald-200 rounded-xl p-3 sm:p-4 space-y-2.5"
          data-logical-name="tradingSystemPhase5"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-xs font-extrabold text-emerald-900 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-emerald-600" />
              【자산 시세 관리】
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setShowAddAssetModal(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded-lg transition cursor-pointer"
                data-logical-name="adminAddAsset"
              >
                <Plus className="w-3 h-3" />
                상품 추가
              </button>
              <div className="flex flex-wrap items-center gap-2 text-[9px] font-bold text-slate-500 shrink-0">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm border border-amber-300 bg-amber-50" />
                  국내
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm border border-blue-300 bg-blue-50" />
                  미국
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm border border-purple-300 bg-purple-50" />
                  암호화폐
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_minmax(200px,280px)] gap-2 items-start">
            <div className="flex flex-wrap gap-1 self-center">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-2 py-1 text-[10px] font-bold rounded-md border transition cursor-pointer ${
                    activeTab === tab.key
                      ? 'bg-white text-emerald-800 border-emerald-300 shadow-sm'
                      : 'bg-transparent text-slate-500 border-transparent hover:bg-white/60 hover:text-slate-700'
                  }`}
                >
                  {tab.label}
                  <span className="ml-1 text-[9px] font-mono opacity-70">
                    ({tabCounts[tab.key]})
                  </span>
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="자산명 · 티커 검색"
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-emerald-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 rounded-lg text-xs outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-500 mr-0.5">정렬</span>
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setSortOrder(option.key)}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-md border transition cursor-pointer ${
                  sortOrder === option.key
                    ? 'bg-white text-emerald-800 border-emerald-300 shadow-sm'
                    : 'bg-transparent text-slate-500 border-transparent hover:bg-white/60 hover:text-slate-700'
                }`}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>

          {statusMsg && (
            <p className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5 whitespace-pre-line">
              {statusMsg}
            </p>
          )}

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <p className="text-xs font-medium">자산 목록 불러오는 중...</p>
            </div>
          ) : sortedAssets.length === 0 ? (
            <p className="text-center text-[11px] text-slate-500 py-8">
              {searchQuery.trim() ? '검색 결과가 없습니다.' : '표시할 자산이 없습니다.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[62vh] overflow-y-auto pr-0.5">
              {sortedAssets.map((asset) => (
                <AdminCompactAssetCard
                  key={asset.id}
                  asset={asset}
                  exchangeRate={exchangeRate}
                  marketPrices={marketPrices}
                  onEdit={setEditingAsset}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 sm:px-5 py-3 border-t border-slate-100 bg-slate-50">
        <button
          type="button"
          onClick={onLogout}
          className="px-3 py-1.5 bg-white border border-slate-200 hover:border-rose-200 hover:bg-rose-50 text-slate-600 hover:text-rose-600 text-xs font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5"
        >
          <LogOut className="w-3.5 h-3.5" />
          로그아웃
        </button>
      </div>

      {editingAsset && (
        <AdminPriceEditModal
          asset={editingAsset}
          exchangeRate={exchangeRate}
          marketPrices={marketPrices}
          onClose={() => setEditingAsset(null)}
          onSaved={(msg) => {
            setStatusMsg(msg);
          }}
        />
      )}

      {showExchangeRateModal && (
        <AdminExchangeRateModal
          currentRate={exchangeRate}
          onClose={() => setShowExchangeRateModal(false)}
          onSaved={(msg) => {
            setStatusMsg(msg);
          }}
        />
      )}

      {showAddAssetModal && (
        <CustomAssetModal
          mode="admin"
          nickname="admin"
          onClose={() => setShowAddAssetModal(false)}
          onSuccess={(asset) => {
            setShowAddAssetModal(false);
            setStatusMsg(`"${asset.name}" 상품이 추가되었습니다. 모든 참여자에게 표시됩니다.`);
          }}
        />
      )}
    </div>
  );
};
