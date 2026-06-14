import React, { useState } from 'react';
import { X, DollarSign } from 'lucide-react';
import { updateExchangeRate } from '../firebase';
import { formatCommas } from '../utils';

interface ExchangeRateModalProps {
  nickname: string;
  currentRate: number;
  onClose: () => void;
  onSuccess: (newRate: number) => void;
}

export const ExchangeRateModal: React.FC<ExchangeRateModalProps> = ({
  nickname,
  currentRate,
  onClose,
  onSuccess,
}) => {
  const [rateInput, setRateInput] = useState(String(currentRate));
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const parsed = parseFloat(rateInput);
    if (!parsed || parsed <= 0) {
      setError('올바른 환율을 입력해주세요.');
      return;
    }

    setIsSaving(true);
    try {
      await updateExchangeRate(nickname, Math.round(parsed));
      onSuccess(Math.round(parsed));
    } catch (err) {
      console.error(err);
      setError('환율 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      data-logical-name="multiCurrencySupport"
    >
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-600" />
            환율 설정
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs text-slate-500">
            USD/KRW 환율을 설정하면 미국 자산 가격 표시 및 수익률 계산에 반영됩니다.
          </p>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              USD/KRW 환율
            </label>
            <div className="relative">
              <input
                type="number"
                min="1"
                step="1"
                value={rateInput}
                onChange={(e) => setRateInput(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 rounded-xl text-sm font-mono font-bold outline-none transition"
              />
              <span className="absolute inset-y-0 right-3 flex items-center text-xs text-slate-400 font-bold">
                원
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">
              현재: 1 USD = {formatCommas(currentRate)}원
            </p>
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
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 text-sm font-bold rounded-xl hover:bg-slate-50 transition cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition cursor-pointer disabled:opacity-50"
            >
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
