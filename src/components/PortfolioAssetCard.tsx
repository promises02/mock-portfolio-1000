import React, { useState, useEffect } from 'react';
import { AssetItem, CustomAsset } from '../types';
import { formatCommas, getDisplayPrice, DEFAULT_EXCHANGE_RATE } from '../utils';
import {
  computeAssetPnL,
  getProfitStyle,
  resolveAssetTicker,
  isUsMarketAsset,
  type CatalogPriceMap,
  US_STOCK_FIXED_EXCHANGE_RATE,
} from '../utils/portfolioPnL';
import { Pencil, Trash2 } from 'lucide-react';

interface PortfolioAssetCardProps {
  asset: AssetItem;
  index: number;
  exchangeRate?: number;
  marketPrices?: Record<string, number>;
  catalogPrices?: CatalogPriceMap;
  communityCustomAssets?: CustomAsset[];
  onUpdateAsset: (index: number, key: keyof AssetItem, value: unknown) => void;
  onRemoveAsset: (index: number) => void;
  onSellAsset: (index: number) => void;
}

function formatQuantity(qty: number): string {
  if (Number.isInteger(qty)) return `${qty}주`;
  return `${qty}주`;
}

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatSignedAmount(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatCommas(value)}원`;
}

export const PortfolioAssetCard: React.FC<PortfolioAssetCardProps> = ({
  asset,
  index,
  exchangeRate = DEFAULT_EXCHANGE_RATE,
  marketPrices,
  catalogPrices,
  communityCustomAssets = [],
  onUpdateAsset,
  onRemoveAsset,
  onSellAsset,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [localQuantity, setLocalQuantity] = useState(String(asset.quantity || ''));
  const [localCurrentPrice, setLocalCurrentPrice] = useState(
    asset.currentPrice != null ? String(asset.currentPrice) : ''
  );

  useEffect(() => {
    setLocalQuantity(String(asset.quantity || ''));
    setLocalCurrentPrice(asset.currentPrice != null ? String(asset.currentPrice) : '');
  }, [asset.quantity, asset.currentPrice]);

  const ticker = resolveAssetTicker(asset.name, communityCustomAssets);
  const pnl = computeAssetPnL(asset, marketPrices, exchangeRate, catalogPrices);
  const profitStyle = getProfitStyle(pnl.profitAmount);
  const isUs = isUsMarketAsset(asset);
  const displayExchangeRate = isUs ? US_STOCK_FIXED_EXCHANGE_RATE : exchangeRate;

  const purchaseDisplay = getDisplayPrice(asset, displayExchangeRate, {
    priceKrw: pnl.purchaseUnitKrw,
  });
  const currentDisplay = getDisplayPrice(asset, displayExchangeRate, {
    priceKrw: pnl.currentUnitKrw,
  });

  const priceChangeStyle = getProfitStyle(pnl.priceChangeRate);

  const handleSaveEdit = () => {
    const qty = parseFloat(localQuantity);
    if (!Number.isNaN(qty) && qty >= 0) {
      onUpdateAsset(index, 'quantity', qty);
    }
    if (localCurrentPrice.trim() === '') {
      onUpdateAsset(index, 'currentPrice', '');
    } else {
      const price = parseFloat(localCurrentPrice);
      if (!Number.isNaN(price) && price >= 0) {
        onUpdateAsset(index, 'currentPrice', price);
      }
    }
    setIsEditing(false);
  };

  return (
    <div
      className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
      data-logical-name="portfolioUIEnhancementPhase7"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-100">
        <div className="min-w-0">
          <h4 className="text-base font-extrabold text-slate-900 truncate">
            {asset.name}
            {ticker && (
              <span className="text-slate-500 font-bold text-sm ml-1.5">({ticker})</span>
            )}
          </h4>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsEditing((v) => !v)}
            className="px-2.5 py-1.5 bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-700 text-xs font-bold rounded-lg transition cursor-pointer flex items-center gap-1"
          >
            <Pencil className="w-3.5 h-3.5" />
            수정
          </button>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="px-2.5 py-1.5 bg-white border border-rose-200 hover:bg-rose-50 text-rose-600 text-xs font-bold rounded-lg transition cursor-pointer flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            삭제
          </button>
        </div>
      </div>

      {/* Main sections — desktop horizontal, mobile vertical */}
      <div className="grid grid-cols-1 md:grid-cols-3 md:divide-x divide-slate-100">
        {/* 매수 정보 */}
        <div className="px-4 py-3 space-y-2 border-b md:border-b-0 border-slate-100">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">매수 정보</p>
          <div className="space-y-1.5">
            <Row label="매수가" value={purchaseDisplay} />
            <Row label="수량" value={formatQuantity(asset.quantity)} />
            <Row label="매입금액" value={`${formatCommas(pnl.purchaseAmount)}원`} bold />
          </div>
        </div>

        {/* 현재 정보 */}
        <div className="px-4 py-3 space-y-2 border-b md:border-b-0 border-slate-100">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">현재 정보</p>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-slate-500 shrink-0">현재가</span>
              <span className="text-sm font-bold text-slate-900 text-right">
                {currentDisplay}
                <span className={`ml-1.5 text-[13px] font-bold ${priceChangeStyle.textClass}`}>
                  ({priceChangeStyle.icon} {formatSignedPercent(pnl.priceChangeRate)})
                </span>
              </span>
            </div>
            {isUs && (
              <Row label="적용 환율" value={`1 USD = ${formatCommas(US_STOCK_FIXED_EXCHANGE_RATE)}원 (고정)`} />
            )}
            <Row label="평가금액" value={`${formatCommas(pnl.currentAmount)}원`} bold />
          </div>
        </div>

        {/* 손익 정보 */}
        <div className="px-4 py-3 space-y-2">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">손익 정보</p>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-slate-500 shrink-0">미실현 손익</span>
              <span className={`text-sm font-bold ${profitStyle.textClass}`}>
                {formatSignedAmount(pnl.profitAmount)} {profitStyle.icon}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-slate-500 shrink-0">수익률</span>
              <span className={`text-[13px] font-bold ${profitStyle.textClass}`}>
                {formatSignedPercent(pnl.profitRate)} {profitStyle.icon}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 매도 버튼 */}
      <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/40">
        <button
          type="button"
          onClick={() => onSellAsset(index)}
          className="w-full py-3 bg-blue-500 hover:bg-blue-600 active:scale-[0.99] text-white text-sm font-black rounded-xl transition cursor-pointer shadow-xs"
        >
          매도
        </button>
      </div>

      {/* 수정 패널 */}
      {isEditing && (
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 space-y-3">
          <p className="text-xs font-bold text-slate-600">보유 수량 · 현재가 수정</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-[10px] font-bold text-slate-500">수량 (주)</span>
              <input
                type="number"
                min="0"
                step="any"
                value={localQuantity}
                onChange={(e) => setLocalQuantity(e.target.value)}
                className="w-full text-sm font-mono font-bold px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-bold text-slate-500">현재가 (₩)</span>
              <input
                type="number"
                min="0"
                step="any"
                placeholder={String(asset.price)}
                value={localCurrentPrice}
                onChange={(e) => setLocalCurrentPrice(e.target.value)}
                className="w-full text-sm font-mono font-bold px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="flex-1 py-2 border border-slate-200 text-slate-600 text-xs font-bold rounded-lg hover:bg-white transition cursor-pointer"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition cursor-pointer"
            >
              저장
            </button>
          </div>
        </div>
      )}

      {/* 삭제 확인 */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-rose-100 bg-rose-50/80">
              <h4 className="text-sm font-extrabold text-slate-800">포트폴리오에서 삭제</h4>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-700 leading-relaxed">
                &quot;{asset.name}&quot;을(를) 포트폴리오에서 제거하시겠어요?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-600 text-sm font-bold rounded-xl hover:bg-slate-50 transition cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onRemoveAsset(index);
                    setShowDeleteConfirm(false);
                  }}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold rounded-xl transition cursor-pointer"
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function Row({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className={`text-sm text-right ${bold ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
        {value}
      </span>
    </div>
  );
}
