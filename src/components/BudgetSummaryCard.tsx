import React from 'react';
import { TrendingUp } from 'lucide-react';
import { formatCommas } from '../utils';

interface BudgetSummaryCardProps {
  totalInvested: number;
  savings: number;
  totalBudget: number;
}

export const BudgetSummaryCard: React.FC<BudgetSummaryCardProps> = ({
  totalInvested,
  savings,
  totalBudget,
}) => {
  const progressPercentage = Math.min(100, (totalInvested / totalBudget) * 100);
  const isOverBudget = totalInvested > totalBudget;

  return (
    <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-sm relative overflow-hidden border border-slate-800">
      <div className="absolute top-0 right-0 w-44 h-44 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="flex justify-between items-center relative z-10">
        <span className="text-slate-400 text-xs font-bold uppercase tracking-wider font-mono">
          합계 (설정된 구매자산 금액)
        </span>
        <span className="bg-emerald-500/20 text-emerald-400 font-mono text-[10px] font-extrabold px-3 py-1 rounded-md border border-emerald-500/30">
          총 모의투자금: 1,000만 원
        </span>
      </div>

      <h3 className="text-3xl font-black font-mono mt-2 text-white select-none tracking-tight">
        {formatCommas(totalInvested)}
        <span className="text-lg font-sans font-medium text-slate-400">
          원 / {formatCommas(totalBudget)}원
        </span>
      </h3>

      <div className="mt-6 space-y-2 relative z-10">
        <div className="flex justify-between text-xs font-bold font-mono">
          <span className="text-slate-300 flex items-center space-x-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span>투자 자산 배분 비중: {progressPercentage.toFixed(1)}%</span>
          </span>
          <span className={isOverBudget ? 'text-rose-400' : 'text-emerald-400'}>
            파킹통장 안전 예치금: {formatCommas(savings)}원
          </span>
        </div>

        <div className="w-full h-3 bg-slate-800 rounded-lg overflow-hidden p-0.5 border border-slate-700/50">
          <div
            className={`h-full rounded-md transition-all duration-300 ${
              isOverBudget ? 'bg-rose-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]' : 'bg-emerald-500'
            }`}
            style={{ width: `${progressPercentage}%` }}
          />
        </div>

        {isOverBudget && (
          <div className="text-rose-400 text-xs font-semibold text-center pt-1 animate-pulse">
            ⚠️ 설정하신 배정 금액이 1,000만 원 한도를 초과했습니다! 수량이나 구매 단가를 낮춰 설정해 주세요.
          </div>
        )}
      </div>
    </div>
  );
};
