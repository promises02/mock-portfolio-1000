import React, { useMemo, useState, useEffect } from 'react';
import { AssetItem } from '../types';
import { formatCommas, DEFAULT_EXCHANGE_RATE, getDisplayPrice } from '../utils';
import { computeSellPreview, getProfitStyle, isUsMarketAsset, CatalogPriceMap } from '../utils/portfolioPnL';
import { Loader2, X } from 'lucide-react';

interface SellAssetModalProps {
  asset: AssetItem;
  marketPrices?: Record<string, number>;
  catalogPrices?: CatalogPriceMap;
  exchangeRate?: number;
  currentSavings?: number;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: (quantity: number) => void;
}

export const SellAssetModal: React.FC<SellAssetModalProps> = ({
  asset,
  marketPrices,
  catalogPrices,
  exchangeRate = DEFAULT_EXCHANGE_RATE,
  currentSavings = 0,
  isSubmitting = false,
  onClose,
  onConfirm,
}) => {
  const maxQty = Math.floor(asset.quantity);
  const [quantity, setQuantity] = useState(Math.min(1, maxQty));
  const isUs = isUsMarketAsset(asset);

  useEffect(() => {
    setQuantity((prev) => Math.min(maxQty, Math.max(1, prev)));
  }, [maxQty, asset.name]);

  const preview = useMemo(
    () => computeSellPreview(asset, quantity, marketPrices, exchangeRate, currentSavings, catalogPrices),
    [asset, quantity, marketPrices, exchangeRate, currentSavings, catalogPrices]
  );

  const profitStyle = getProfitStyle(preview.realizedProfit);
  const isValid = quantity >= 1 && quantity <= maxQty && Number.isInteger(quantity);
  const purchaseDisplay = getDisplayPrice(asset, preview.purchaseExchangeRate ?? exchangeRate, {
    priceKrw: preview.purchasePriceKrw,
    priceUsd: preview.purchasePriceUsd,
  });

  const adjustQuantity = (delta: number) => {
    setQuantity((prev) => Math.min(maxQty, Math.max(1, prev + delta)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || isSubmitting) return;
    onConfirm(quantity);
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      data-logical-name="realizedProfitWithCashFlow"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h4 className="text-base font-extrabold text-slate-900">{asset.name} 매도</h4>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition cursor-pointer disabled:opacity-50"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="divide-y divide-slate-100">
          <div className="p-5 space-y-2 text-sm">
            {isUs ? (
              <>
                <Row label="매수가" value={purchaseDisplay} />
                {preview.currentPriceUsd != null && (
                  <Row
                    label="현재가"
                    value={`${preview.currentPriceUsd.toFixed(2)} USD × ${formatCommas(exchangeRate)}원 = ${formatCommas(Math.round(preview.sellPriceKrw))}원`}
                  />
                )}
              </>
            ) : (
              <Row label="현재가" value={`${formatCommas(Math.round(preview.sellPriceKrw))}원`} />
            )}
            <Row label="보유수량" value={`${maxQty}주`} />
            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-slate-500 shrink-0">매도수량</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => adjustQuantity(-1)}
                  disabled={quantity <= 1}
                  className="w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold disabled:opacity-40 cursor-pointer"
                >
                  ▼
                </button>
                <input
                  type="number"
                  step={1}
                  min={1}
                  max={maxQty}
                  value={quantity}
                  onChange={(e) => {
                    const next = parseInt(e.target.value, 10);
                    if (Number.isNaN(next)) return;
                    setQuantity(Math.min(maxQty, Math.max(1, next)));
                  }}
                  className="w-16 text-center text-sm font-mono font-bold px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                <button
                  type="button"
                  onClick={() => adjustQuantity(1)}
                  disabled={quantity >= maxQty}
                  className="w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold disabled:opacity-40 cursor-pointer"
                >
                  ▲
                </button>
                <span className="text-xs font-bold text-slate-400">주</span>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-2 text-sm">
            <Row label="매도금액" value={`${formatCommas(preview.sellAmount)}원`} bold />
            <Row label="매입금액" value={`${formatCommas(preview.purchaseAmount)}원`} />
            <Row label="매수가" value={purchaseDisplay} />
          </div>

          <div className="p-5 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">실현 손익</span>
              <span className={`font-bold ${profitStyle.textClass}`}>
                {preview.realizedProfit >= 0 ? '+' : ''}
                {formatCommas(preview.realizedProfit)}원 {profitStyle.icon}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">수익률</span>
              <span className={`font-bold text-[13px] ${profitStyle.textClass}`}>
                {preview.profitRate >= 0 ? '+' : ''}
                {preview.profitRate.toFixed(2)}% {profitStyle.icon}
              </span>
            </div>
          </div>

          <div className="p-5 bg-slate-50/60 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500 font-bold">예상 현금</span>
              <span className="font-black font-mono">{formatCommas(preview.cashAfter)}원</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1 text-right">
              {formatCommas(currentSavings)}원 + {formatCommas(preview.sellAmount)}원
            </p>
          </div>

          <div className="p-5 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-3 border border-slate-200 text-slate-600 text-sm font-bold rounded-xl hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!isValid || isSubmitting}
              className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 text-white text-sm font-black rounded-xl transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  처리 중...
                </>
              ) : (
                '매도 확인'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right ${bold ? 'font-black text-slate-900' : 'font-bold text-slate-800'}`}>
        {value}
      </span>
    </div>
  );
}
