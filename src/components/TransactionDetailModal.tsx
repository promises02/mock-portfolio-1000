import React from 'react';
import { X } from 'lucide-react';
import { Transaction } from '../types';
import {
  buildTransactionDetailRows,
  formatTransactionAssetLabel,
  formatTransactionDateTime,
} from '../firebase';

interface TransactionDetailModalProps {
  transaction: Transaction;
  ticker?: string;
  onClose: () => void;
}

export const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  transaction,
  ticker,
  onClose,
}) => {
  const isBuy = transaction.type === 'BUY';
  const assetLabel = formatTransactionAssetLabel(transaction, ticker);
  const detailRows = buildTransactionDetailRows(transaction, { ticker });

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      data-logical-name="transactionHistoryPhase8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/60">
          <div>
            <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">거래 상세</p>
            <h3 className="text-base font-black text-slate-800 mt-0.5">{assetLabel}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm font-mono">
            <span className="font-bold text-slate-700">{formatTransactionDateTime(transaction)}</span>
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                isBuy
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}
            >
              {isBuy ? 'BUY' : 'SELL'}
            </span>
          </div>

          <dl className="space-y-2.5 font-mono text-sm">
            {detailRows.map((row) => (
              <div key={row.label} className="flex justify-between gap-4 py-1 border-b border-slate-50 last:border-0">
                <dt className="text-slate-500 shrink-0">{row.label}</dt>
                <dd className={`font-bold text-right ${row.valueClass ?? 'text-slate-800'}`}>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/40">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-black rounded-xl cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
