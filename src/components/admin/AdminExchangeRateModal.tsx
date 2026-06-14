import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminExchangeRateUpdateReason } from '../../types';
import { updateAdminExchangeRate } from '../../firebase';
import { formatCommas } from '../../utils';

const UPDATE_REASONS: AdminExchangeRateUpdateReason[] = [
  '실시간 환율 반영',
  '데이터 정정',
  '시장 변동',
];

interface AdminExchangeRateModalProps {
  currentRate: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export const AdminExchangeRateModal: React.FC<AdminExchangeRateModalProps> = ({
  currentRate,
  onClose,
  onSaved,
}) => {
  const [newRate, setNewRate] = useState(String(currentRate));
  const [updateReason, setUpdateReason] =
    useState<AdminExchangeRateUpdateReason>('실시간 환율 반영');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    const parsed = parseFloat(newRate);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('유효한 환율을 입력해주세요.');
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const result = await updateAdminExchangeRate('', parsed, updateReason);
      if (!result.success) {
        setError(result.message);
        return;
      }
      onSaved(result.message);
      onClose();
    } catch (err) {
      console.error('[AdminExchangeRateModal] save failed:', err);
      setError(err instanceof Error ? err.message : '환율 저장 중 오류가 발생했습니다.');
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
          <h3 className="text-base font-extrabold text-slate-800">환율 수정</h3>
        </div>

        <div className="p-6 space-y-5">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm">
            <p className="text-slate-600">
              현재 환율:{' '}
              <span className="font-bold font-mono text-slate-800">
                {formatCommas(currentRate)}원/USD
              </span>
            </p>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">새로운 환율</label>
            <div className="relative">
              <input
                type="number"
                min="1"
                step="0.1"
                value={newRate}
                onChange={(e) => {
                  setNewRate(e.target.value);
                  if (error) setError('');
                }}
                disabled={isSaving}
                className="w-full px-4 py-3 pr-24 bg-white border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 rounded-xl font-mono font-bold text-slate-800 outline-none"
              />
              <span className="absolute inset-y-0 right-4 flex items-center text-xs font-bold text-slate-400">
                원/달러
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
                    name="exchangeUpdateReason"
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
