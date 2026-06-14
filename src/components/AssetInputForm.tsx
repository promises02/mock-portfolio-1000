import React from 'react';
import { AssetItem, AssetType, CustomAsset, Portfolio } from '../types';
import { formatCommas, DEFAULT_EXCHANGE_RATE } from '../utils';
import { CatalogPriceMap } from '../utils/portfolioPnL';
import { Wallet, ChevronDown, ChevronUp } from 'lucide-react';
import { PortfolioAssetCard } from './PortfolioAssetCard';

interface AssetInputFormProps {
  assets: AssetItem[];
  onChangeAssets: (assets: AssetItem[]) => void;
  savings: number;
  marketPrices?: Record<string, number>;
  catalogPrices?: CatalogPriceMap;
  allPortfolios?: Portfolio[];
  exchangeRate?: number;
  communityCustomAssets?: CustomAsset[];
  onSellAsset?: (index: number) => void;
}


export const ASSET_TYPE_MAP: Record<AssetType, { label: string; bg: string; text: string; border: string }> = {
  stock: { label: '주식 (Stock)', bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-150' },
  etf: { label: 'ETF', bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-indigo-150' },
  fund: { label: '펀드 (Fund)', bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-150' },
  crypto: { label: '암호화폐 (Crypto)', bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200' },
  commodity: { label: '원자재 (Commodity)', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-150' },
  etc: { label: '기타 (Etc)', bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' },
};

export const AssetInputForm: React.FC<AssetInputFormProps> = ({
  assets,
  onChangeAssets,
  savings,
  marketPrices,
  catalogPrices,
  exchangeRate = DEFAULT_EXCHANGE_RATE,
  communityCustomAssets = [],
  onSellAsset,
}) => {
  const [isListFolded, setIsListFolded] = React.useState(false);

  const handleUpdateAsset = (index: number, key: keyof AssetItem, value: any) => {
    const updated = assets.map((a, i) => {
      if (i === index) {
        const item = { ...a };
        if (key === 'price') {
          const num = parseFloat(value) || 0;
          item[key] = Math.max(0, num);
        } else if (key === 'quantity') {
          const num = parseFloat(value) || 0;
          item[key] = Math.max(0, num);
        } else if (key === 'currentPrice') {
          if (value === '') {
            delete item.currentPrice;
          } else {
            const num = parseFloat(value) || 0;
            item[key] = Math.max(0, num);
          }
        } else if (key === 'name') {
          item[key] = value;
        } else {
          item[key] = value;
        }
        return item;
      }
      return a;
    });
    onChangeAssets(updated);
  };

  const handleRemoveAsset = (index: number) => {
    onChangeAssets(assets.filter((_, i) => i !== index));
  };

  return (
    <div id="asset-input-form" className="space-y-6">
      {/* Asset Items List */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-2 border-b border-slate-100">
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setIsListFolded(!isListFolded)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 hover:text-slate-900 border border-slate-200 rounded-xl font-bold text-xs flex items-center space-x-1.5 transition cursor-pointer select-none"
              title={isListFolded ? "자산 구성 목록 펼치기" : "자산 구성 목록 접기"}
            >
              <Wallet className="w-3.5 h-3.5 text-emerald-600" />
              <span>내 포트폴리오 자산 구성 목록</span>
              {isListFolded ? (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronUp className="w-4 h-4 text-slate-500" />
              )}
            </button>
            {assets.length > 0 && (
              <span className="text-[10px] font-bold font-mono text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                총 {assets.length}개 자산
              </span>
            )}
          </div>
          <span className="text-[10px] text-slate-400 font-medium">
            보유 자산의 매수·현재·손익을 한눈에 확인하세요.
          </span>
        </div>

        {!isListFolded ? (
          <div className="space-y-3 animate-fade-in">
            {assets.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-slate-250 rounded-2xl bg-white shadow-sm/5">
                <p className="text-slate-500 font-bold text-sm">간편 선택 또는 검색으로 종목을 매수하면 여기에 표시됩니다.</p>
                <p className="text-xs text-slate-400 mt-1">간편 선택 · 검색 → 수량 입력 → 매수 순서로 진행하세요.</p>
                <div className="mt-4 inline-flex items-center space-x-1 bg-emerald-55/40 border border-emerald-150 text-emerald-700 font-mono text-[10px] font-bold px-3 py-1 rounded-lg">
                  <span>남은 자본 {formatCommas(savings)}원 전액 파킹통장 보관 중</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3" data-logical-name="portfolioUIEnhancementPhase7">
                {assets.map((asset, index) => (
                  <PortfolioAssetCard
                    key={`${asset.name}-${index}`}
                    asset={asset}
                    index={index}
                    exchangeRate={exchangeRate}
                    marketPrices={marketPrices}
                    catalogPrices={catalogPrices}
                    communityCustomAssets={communityCustomAssets}
                    onUpdateAsset={handleUpdateAsset}
                    onRemoveAsset={handleRemoveAsset}
                    onSellAsset={onSellAsset ?? (() => {})}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-slate-50 p-6 rounded-xl border border-slate-150 text-center text-xs text-slate-400 font-medium leading-relaxed">
            자산 항목 리스트가 접혀 있습니다.
            <br />
            목록을 펼치려면 
            <span className="text-slate-650 font-bold mx-1 cursor-pointer hover:underline" onClick={() => setIsListFolded(false)}>
              [내 포트폴리오 자산 구성 목록 ▲]
            </span> 
            버튼을 클릭하세요.
          </div>
        )}
      </div>
    </div>
  );
};
