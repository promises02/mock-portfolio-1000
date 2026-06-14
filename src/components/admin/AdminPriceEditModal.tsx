import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { CustomAsset, AdminPriceUpdateReason, MarketPriceMap } from '../../types';
import {
  updateAdminAssetPrice,
  getAdminMarketLabel,
  resolveAdminAssetPriceDisplay,
} from '../../firebase';
import { getDefaultDisplayCurrency, inferAssetMarketRegion } from '../../utils';

const UPDATE_REASONS: AdminPriceUpdateReason[] = [
  '시장 변동',
  '데이터 정정',
  '기술적 오류',
  '기타',
];

interface AdminPriceEditModalProps {
  asset: CustomAsset;
  exchangeRate: number;
  marketPrices?: MarketPriceMap;
  onClose: () => void;
  onSaved: (message: string) => void;
}

function resolveEditContext(
  asset: CustomAsset,
  exchangeRate: number,
  marketPrices?: MarketPriceMap
) {
  const display = resolveAdminAssetPriceDisplay(asset, exchangeRate, marketPrices);
  const region = asset.marketRegion ?? inferAssetMarketRegion(asset.name, asset.type);
  const currency = asset.displayCurrency ?? getDefaultDisplayCurrency(region);
  const isUsd = currency === 'USD' && display.isUsAsset;

  let existingAmount = display.priceKrw;
  if (isUsd) {
    existingAmount =
      asset.priceUSD ??
      (display.priceKrw > 0 && exchangeRate > 0 ? display.priceKrw / exchangeRate : 0);
  } else {
    existingAmount = display.priceKrw;
  }

  return {
    marketLabel: getAdminMarketLabel(asset),
    unitLabel: isUsd ? 'USD' : 'KRW',
    isUsd,
    existingAmount,
    existingFormatted: display.pricePrimary,
  };
}

export const AdminPriceEditModal: React.FC<AdminPriceEditModalProps> = ({
  asset,
  exchangeRate,
  marketPrices,
  onClose,
  onSaved,
}) => {
  const context = resolveEditContext(asset, exchangeRate, marketPrices);
  const [newPrice, setNewPrice] = useState(
    context.isUsd
      ? context.existingAmount.toFixed(2)
      : String(Math.round(context.existingAmount))
  );
  const [updateReason, setUpdateReason] = useState<AdminPriceUpdateReason>('시장 변동');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const unitSuffix = context.isUsd ? 'USD' : '원';

  const handleSave = async () => {
    const parsed = parseFloat(newPrice);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('유효한 가격을 입력해주세요.');
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const result = await updateAdminAssetPrice(asset, parsed, updateReason);
      if (!result.success) {
        setError(result.message);
        return;
      }
      onSaved(result.message);
      onClose();
    } catch (err) {
      console.error('[AdminPriceEditModal] save failed:', err);
      setError(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div
        className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
        data-logical-name="adminModeEnhancedPriceUpdate"
      >
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h3 className="text-base font-extrabold text-slate-800">{asset.name} 시세 수정</h3>
        </div>

        <div className="p-6 space-y-5">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-sm">
            <p className="text-slate-600">
              기존 가격:{' '}
              <span className="font-bold font-mono text-slate-800">{context.existingFormatted}</span>
            </p>
            <p className="text-slate-600">
              시장: <span className="font-bold text-slate-800">{context.marketLabel}</span>
            </p>
            <p className="text-slate-600">
              단위: <span className="font-bold text-slate-800">{context.unitLabel}</span>
            </p>
            {context.isUsd && (
              <p className="text-slate-600">
                현재 환율:{' '}
                <span className="font-bold font-mono text-slate-800">
                  {exchangeRate.toLocaleString('ko-KR')}원/USD
                </span>
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">
              {context.isUsd ? '새로운 가격 (USD)' : '새로운 가격'}
            </label>
            <div className="relative">
              <input
                type="number"
                min="0"
                step={context.isUsd ? '0.01' : '1'}
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                disabled={isSaving}
                className="w-full px-4 py-3 pr-14 bg-white border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 rounded-xl font-mono font-bold text-slate-800 outline-none"
              />
              <span className="absolute inset-y-0 right-4 flex items-center text-xs font-bold text-slate-400">
                {unitSuffix}
              </span>
            </div>
          </div>

          <div>
            <p className="text-sm font-bold text-slate-700 mb-2">수정 사유 (선택)</p>
            <div className="space-y-2">
              {UPDATE_REASONS.map((reason) => (
                <label
                  key={reason}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer text-sm"
                >
                  <input
                    type="radio"
                    name="updateReason"
                    value={reason}
                    checked={updateReason === reason}
                    onChange={() => setUpdateReason(reason)}
                    disabled={isSaving}
                    className="text-indigo-600"
                  />
                  <span className="text-slate-700">{reason}</span>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 text-sm font-bold rounded-xl hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  저장 중...
                </>
              ) : (
                '저장'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
