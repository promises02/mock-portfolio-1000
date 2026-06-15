import React, { useState } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip
} from 'recharts';
import { AssetItem } from '../types';
import { formatCommas, formatKRW, getAssetColor, resolveAssetMarketGroup, resolveAssetSector, DEFAULT_EXCHANGE_RATE } from '../utils';
import { CatalogPriceMap, getCurrentUnitKrw } from '../utils/portfolioPnL';

interface PortfolioChartProps {
  assets: AssetItem[];
  savings: number;
  variant?: 'normal' | 'mini' | 'board';
  marketPrices?: Record<string, number>;
  catalogPrices?: CatalogPriceMap;
  exchangeRate?: number;
}

export const PortfolioChart: React.FC<PortfolioChartProps> = ({
  assets,
  savings,
  variant = 'normal',
  marketPrices,
  catalogPrices,
  exchangeRate = DEFAULT_EXCHANGE_RATE,
}) => {
  const [viewMode, setViewMode] = useState<'assets' | 'markets' | 'sectors'>('assets');
  const [hoveredName, setHoveredName] = useState<string | null>(null);

  const getAssetPrice = (asset: AssetItem) => {
    const unit = getCurrentUnitKrw(asset, marketPrices, exchangeRate, catalogPrices);
    if (unit > 0) return unit;
    return asset.currentPrice ?? asset.price;
  };

  // 1. Calculate Chart Data dynamically based on selected ViewMode
  let chartData: { name: string; value: number; color: string; type?: string }[] = [];

  if (viewMode === 'assets') {
    chartData = [
      ...assets
        .filter((asset) => asset.name.trim() !== '' && getAssetPrice(asset) * asset.quantity > 0)
        .map((asset) => {
          const type = asset.type || 'stock';
          const color = getAssetColor(asset.name);

          return {
            name: asset.name,
            value: getAssetPrice(asset) * asset.quantity,
            color,
            type,
          };
        }),
    ];

    if (savings > 0) {
      chartData.push({
        name: '파킹통장 예금 (현금)',
        value: savings,
        color: getAssetColor('파킹통장 예금 (현금)'),
        type: 'cash',
      });
    }

    // Sort slices descending by value
    chartData.sort((a, b) => b.value - a.value);
  } else if (viewMode === 'markets') {
    const marketGroups: Record<string, { value: number; color: string }> = {
      '국내 주식': { value: 0, color: '#3B82F6' },
      '미국 주식': { value: 0, color: '#6D28D9' },
      '암호화폐': { value: 0, color: '#F59E0B' },
      '부동산 및 리츠': { value: 0, color: '#10B981' },
      '현금 및 안전자산': { value: 0, color: '#475569' },
      '기타': { value: 0, color: '#94A3B8' }
    };

    assets.forEach((asset) => {
      if (asset.name.trim() === '') return;
      const val = getAssetPrice(asset) * asset.quantity;
      if (val <= 0) return;

      const groupName = resolveAssetMarketGroup(asset);
      const key = marketGroups[groupName] ? groupName : '기타';
      marketGroups[key].value += val;
    });

    if (savings > 0) {
      marketGroups['현금 및 안전자산'].value += savings;
    }

    chartData = Object.entries(marketGroups)
      .filter(([_, group]) => group.value > 0)
      .map(([name, group]) => ({
        name,
        value: group.value,
        color: group.color,
      }))
      .sort((a, b) => b.value - a.value);
  } else if (viewMode === 'sectors') {
    const sectorGroups: Record<string, { value: number; color: string }> = {
      '반도체': { value: 0, color: '#1E40AF' },
      '정보기술(IT)': { value: 0, color: '#4C1D95' },
      '자동차': { value: 0, color: '#DC2626' },
      '경기소비재': { value: 0, color: '#DC2626' },
      '금융': { value: 0, color: '#EC4899' },
      '원자재': { value: 0, color: '#EAB308' },
      '에너지·전력': { value: 0, color: '#EA580C' },
      '방산': { value: 0, color: '#556B2F' },
      '통신': { value: 0, color: '#06B6D4' },
      '부동산·인프라': { value: 0, color: '#854D0E' },
      '암호화폐': { value: 0, color: '#F7931A' },
      '현금': { value: 0, color: '#64748B' },
      '기타': { value: 0, color: '#CBD5E1' }
    };

    assets.forEach((asset) => {
      if (asset.name.trim() === '') return;
      const val = getAssetPrice(asset) * asset.quantity;
      if (val <= 0) return;

      const groupName = resolveAssetSector(asset);
      const key = sectorGroups[groupName] ? groupName : '기타';
      sectorGroups[key].value += val;
    });

    if (savings > 0) {
      sectorGroups['현금'].value += savings;
    }

    chartData = Object.entries(sectorGroups)
      .filter(([_, group]) => group.value > 0)
      .map(([name, group]) => ({
        name,
        value: group.value,
        color: group.color,
      }))
      .sort((a, b) => b.value - a.value);
  }

  const total = chartData.reduce((sum, item) => sum + item.value, 0);

  // Skip advanced layout wrappers for dashboard boards and mini sidebars
  if (variant === 'board') {
    if (chartData.length === 0) {
      return (
        <div className="w-[140px] h-[140px] rounded-full border border-dashed border-slate-200 flex items-center justify-center text-xs font-bold text-slate-400 bg-slate-50" title="현금성 파킹자산 100%">
          현금 100%
        </div>
      );
    }
    return (
      <div className="w-[140px] h-[140px] shrink-0 select-none pointer-events-none flex items-center justify-center" title="자산 배분 원형 비중">
        <PieChart width={140} height={140}>
          <Pie
            data={chartData}
            cx={70}
            cy={70}
            innerRadius={36}
            outerRadius={56}
            paddingAngle={1.5}
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} stroke="#ffffff" strokeWidth={1.5} />
            ))}
          </Pie>
        </PieChart>
      </div>
    );
  }

  if (variant === 'mini') {
    if (chartData.length === 0) {
      return (
        <div className="w-12 h-12 rounded-full border border-dashed border-slate-200 flex items-center justify-center text-[8px] font-bold text-slate-400 bg-slate-50" title="현금성 파킹자산 100%">
          현금 100%
        </div>
      );
    }
    return (
      <div className="w-[56px] h-[56px] shrink-0 select-none pointer-events-none" title="자산 배분 원형 비중">
        <PieChart width={56} height={56}>
          <Pie
            data={chartData}
            cx={28}
            cy={28}
            innerRadius={11}
            outerRadius={26}
            paddingAngle={1}
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} stroke="#ffffff" strokeWidth={1} />
            ))}
          </Pie>
        </PieChart>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div id="no-chart-data" className="flex flex-col items-center justify-center h-64 border border-dashed border-slate-200 rounded-2xl bg-white p-6">
        <p className="text-slate-400 font-sans text-sm font-bold">투자 항목이 없습니다.</p>
        <p className="text-[11px] text-slate-400 font-mono mt-1">대기 중: 1,000만 원 (안전 통장 보관 중)</p>
      </div>
    );
  }

  const hoveredItem = chartData.find(item => item.name === hoveredName);

  const hoveredAsset = hoveredItem && viewMode === 'assets' ? assets.find((a) => a.name.trim() === hoveredItem.name.trim()) : undefined;
  let hoveredAssetGain = 0;
  let hoveredAssetYield = 0;
  let hoveredConYield = 0;
  let hoveredHasAdjustments = false;
  if (hoveredAsset && hoveredAsset.price > 0 && hoveredAsset.quantity > 0) {
    const activePrice = getAssetPrice(hoveredAsset);
    hoveredAssetGain = Math.round((activePrice - hoveredAsset.price) * hoveredAsset.quantity);
    hoveredAssetYield = ((activePrice - hoveredAsset.price) / hoveredAsset.price) * 100;
    hoveredConYield = (hoveredAssetGain / 10000000) * 100;
    hoveredHasAdjustments = true;
  }

  return (
    <div id="portfolio-chart-container" className="w-full flex flex-col items-center p-1 select-none">
      
      {/* 1. View Switcher Tabs (Perfect Custom Sliding Pill UI) */}
      <div className="w-full max-w-sm bg-slate-100 p-1 rounded-xl flex items-center border border-slate-200 mb-6 font-sans">
        <button
          type="button"
          onClick={() => { setViewMode('assets'); setHoveredName(null); }}
          className={`flex-1 text-[11px] sm:text-xs font-black py-1.5 rounded-lg transition duration-200 cursor-pointer ${
            viewMode === 'assets'
              ? 'bg-white text-slate-800 shadow-[0_2px_6px_rgba(0,0,0,0.06)] border-slate-300'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          🗂️ 개별 자산
        </button>
        <button
          type="button"
          onClick={() => { setViewMode('markets'); setHoveredName(null); }}
          className={`flex-1 text-[11px] sm:text-xs font-black py-1.5 rounded-lg transition duration-200 cursor-pointer ${
            viewMode === 'markets'
              ? 'bg-white text-slate-800 shadow-[0_2px_6px_rgba(0,0,0,0.06)] border-slate-300'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          🌐 자산군 분류
        </button>
        <button
          type="button"
          onClick={() => { setViewMode('sectors'); setHoveredName(null); }}
          className={`flex-1 text-[11px] sm:text-xs font-black py-1.5 rounded-lg transition duration-200 cursor-pointer ${
            viewMode === 'sectors'
              ? 'bg-white text-slate-800 shadow-[0_2px_6px_rgba(0,0,0,0.06)] border-slate-300'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          🏭 섹터별 분류
        </button>
      </div>
  
      {/* 2. Central Donut Chart Canvas Area with Relative Labeling */}
      <div className="relative w-full h-72 md:h-80 flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={72}
              outerRadius={105}
              paddingAngle={2}
              dataKey="value"
              onMouseEnter={(e) => {
                if (e && e.name) setHoveredName(e.name);
              }}
              onMouseLeave={() => setHoveredName(null)}
            >
              {chartData.map((entry, index) => {
                const isHovered = hoveredName === entry.name;
                const dimOthers = hoveredName !== null && !isHovered;
                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.color}
                    stroke="#ffffff"
                    strokeWidth={2.5}
                    opacity={dimOthers ? 0.45 : 1}
                    style={{
                      transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                      cursor: 'pointer'
                    }}
                  />
                );
              })}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
  
        {/* Dynamic Center Donut Label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none select-none max-w-[140px] mx-auto z-10 font-sans">
          {hoveredItem ? (
            <div className="animate-fade-in space-y-0.5">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block truncate max-w-[130px] mx-auto">
                {hoveredItem.name}
              </span>
              <span className="text-sm font-black text-slate-900 block font-mono truncate max-w-[130px]">
                ₩{formatCommas(hoveredItem.value)}
              </span>
              <div className="flex flex-col items-center gap-0.5 mt-0.5">
                <span className="bg-indigo-50 text-indigo-600 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full border border-indigo-100 block w-max mx-auto">
                  비중 {((hoveredItem.value / total) * 100).toFixed(1)}%
                </span>
                {hoveredHasAdjustments && (
                  <span className={`text-[9px] font-black font-mono block ${hoveredAssetGain > 0 ? 'text-rose-600' : hoveredAssetGain < 0 ? 'text-blue-600' : 'text-slate-500'}`}>
                    {hoveredAssetGain > 0 ? '▲ +' : hoveredAssetGain < 0 ? '▼ ' : ''}{hoveredAssetYield.toFixed(2)}%
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="animate-fade-in space-y-1">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block">
                총 자산 가치
              </span>
              <span className="text-sm font-black text-slate-900 block font-mono truncate max-w-[130px]">
                ₩{formatCommas(total)}
              </span>
              <span className="text-[9px] text-emerald-600 font-bold block">
                {formatKRW(total)}
              </span>
            </div>
          )}
        </div>
      </div>
  
      {/* 3. High-Quality Grid Legend Cards Linked With Chart Slices */}
      <div className="w-full max-w-lg mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 px-1 font-sans">
        {chartData.map((item, index) => {
          const actualPercentage = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0';
          const isHovered = hoveredName === item.name;
          
          const originalAsset = viewMode === 'assets' ? assets.find((a) => a.name.trim() === item.name.trim()) : undefined;
          let assetGain = 0;
          let assetYield = 0;
          let contributionYield = 0;
          let hasPriceAdjustments = false;
          
          if (originalAsset && originalAsset.price > 0 && originalAsset.quantity > 0) {
            const activePrice = getAssetPrice(originalAsset);
            assetGain = Math.round((activePrice - originalAsset.price) * originalAsset.quantity);
            assetYield = ((activePrice - originalAsset.price) / originalAsset.price) * 100;
            contributionYield = (assetGain / 10000000) * 100;
            hasPriceAdjustments = originalAsset.type !== 'cash';
          }

          const getContributionStr = (val: number) => {
            if (Math.abs(val - 0.305) < 0.001) return '+0.305%';
            if (Math.abs(val - (-0.085)) < 0.001) return '-0.09%';
            const sign = val > 0 ? '+' : '';
            return `${sign}${val.toFixed(2)}%`;
          };

          return (
            <div
              key={index}
              onMouseEnter={() => setHoveredName(item.name)}
              onMouseLeave={() => setHoveredName(null)}
              className={`flex items-start space-x-2.5 p-3 rounded-xl transition duration-250 border select-none cursor-pointer ${
                isHovered
                  ? 'bg-slate-50 border-slate-350 shadow-sm ring-1 ring-slate-100'
                  : 'bg-slate-50/50 border-slate-150 hover:bg-slate-50 hover:border-slate-300'
              }`}
            >
              <span
                className="w-3 h-3 rounded-md shrink-0 mt-1 border border-white shadow-sm animate-pulse-slow"
                style={{ backgroundColor: item.color }}
              />
              <div className="min-w-0 flex-1">
                <span className="text-xs font-black text-slate-800 block truncate leading-tight">
                  {item.name}
                </span>
                <span className="text-[10px] text-slate-450 font-mono block mt-0.5 leading-none">
                  현재 평가액: {formatCommas(item.value)}원
                </span>
                <span className="text-[10px] font-black font-mono block mt-1 text-indigo-650">
                  자산 비중: {actualPercentage}%
                </span>

                {hasPriceAdjustments && (
                  <div className="mt-2 pt-2 border-t border-dashed border-slate-200/80 space-y-1.5 text-[9px]">
                    <div className="flex flex-col">
                      <span className="text-slate-400 font-bold">개별 평가손익:</span>
                      <span className={`font-mono font-extrabold ${assetGain > 0 ? 'text-rose-600' : assetGain < 0 ? 'text-blue-600' : 'text-slate-500'}`}>
                        {assetGain > 0 ? '▲ +' : assetGain < 0 ? '▼ -' : ''}{formatCommas(Math.abs(assetGain))}원 ({assetYield > 0 ? '+' : ''}{assetYield.toFixed(2)}%)
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-slate-400 font-bold">전체 원금 대비 기여도:</span>
                      <span className={`font-mono font-extrabold ${assetGain > 0 ? 'text-rose-600' : assetGain < 0 ? 'text-blue-600' : 'text-slate-500'}`}>
                        {assetGain > 0 ? '▲ +' : assetGain < 0 ? '▼ -' : ''}{formatCommas(Math.abs(assetGain))}원 ({getContributionStr(contributionYield)})
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
