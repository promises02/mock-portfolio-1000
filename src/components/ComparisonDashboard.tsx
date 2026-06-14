import React, { useState } from 'react';
import { Portfolio, AssetType } from '../types';
import { formatCommas, formatKRW, getAssetColor, DEFAULT_EXCHANGE_RATE } from '../utils';
import {
  CatalogPriceMap,
  computeBrokeragePortfolioMetrics,
  getCurrentUnitKrw,
} from '../utils/portfolioPnL';
import { resolveInitialCapital } from '../firebase';
import { PortfolioChart } from './PortfolioChart';
import { ASSET_TYPE_MAP } from './AssetInputForm';
import { Users, Calendar, Trophy, Medal, ExternalLink, Landmark, ChevronDown, ChevronUp, Clock, Grid, PieChart } from 'lucide-react';

interface ComparisonDashboardProps {
  portfolios: Portfolio[];
  currentUserNickname: string;
  marketPrices: Record<string, number>;
  catalogPrices?: CatalogPriceMap;
  exchangeRate?: number;
}

export const ComparisonDashboard: React.FC<ComparisonDashboardProps> = ({
  portfolios,
  currentUserNickname,
  marketPrices,
  catalogPrices,
  exchangeRate = DEFAULT_EXCHANGE_RATE,
}) => {
  const [selectedNickname, setSelectedNickname] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'profit' | 'recent'>('profit');

  if (portfolios.length === 0) {
    return (
      <div id="dashboard-empty-state" className="text-center py-12 px-4 border border-dashed border-slate-200 rounded-2xl bg-white shadow-sm/5">
        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-200">
          <Users className="w-6 h-6 text-slate-400" />
        </div>
        <p className="text-slate-500 font-sans text-sm font-bold">참여 데이터가 아직 없습니다.</p>
        <p className="text-slate-400 font-sans text-xs mt-1">포트폴리오 설계 후 공유 버튼을 클릭해 첫 참여자가 되어 보세요!</p>
      </div>
    );
  }

  const resolveUnitPrice = (item: Portfolio['assets'][number]) => {
    const unit = getCurrentUnitKrw(item, marketPrices, exchangeRate, catalogPrices);
    if (unit > 0) return unit;
    return item.currentPrice !== undefined ? item.currentPrice : item.price;
  };

  // 증권사 방식: (현금 + 평가금액 − 초기자본) / 초기자본
  const processedPortfolios = portfolios.map((portfolio) => {
    const initialCapital = resolveInitialCapital(portfolio);
    const metrics = computeBrokeragePortfolioMetrics(
      portfolio.assets || [],
      portfolio.cumulativeRealizedProfit ?? 0,
      initialCapital,
      marketPrices,
      exchangeRate,
      catalogPrices
    );

    return {
      ...portfolio,
      savings: metrics.savings,
      calculatedCurrentVal: metrics.totalAssets,
      calculatedProfitRate: metrics.totalProfitRate,
      calculatedProfitAmount: metrics.totalProfitAmount,
    };
  });

  // Sorting logic based on sort type
  const sortedPortfolios = [...processedPortfolios].sort((a, b) => {
    if (sortBy === 'profit') {
      return b.calculatedProfitRate - a.calculatedProfitRate;
    } else {
      // Sort: Most recently updated first
      const tA = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : new Date(a.updatedAt).getTime();
      const tB = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : new Date(b.updatedAt).getTime();
      return tB - tA;
    }
  });

  const handleToggleDetail = (nickname: string) => {
    if (selectedNickname === nickname) {
      setSelectedNickname(null);
    } else {
      setSelectedNickname(nickname);
    }
  };

  const getBriefSummary = (portfolio: Portfolio) => {
    if ((portfolio.assets || []).length === 0) {
      return '100% 파킹통장 예치 안전형';
    }
    const assetNames = (portfolio.assets || [])
      .filter((a) => a.name.trim() !== '')
      .map((a) => a.name)
      .join(', ');
    
    return assetNames.length > 25 ? `${assetNames.slice(0, 25)}...` : assetNames;
  };

  return (
    <div id="comparison-dashboard" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-4">
        <div>
          <h4 className="text-lg md:text-xl font-extrabold text-slate-900 flex items-center space-x-2 font-sans tracking-tight">
            <Trophy className="w-5.5 h-5.5 text-amber-500 shrink-0" />
            <span>실시간 참여 상태 및 대시보드 랭킹</span>
          </h4>
          <p className="text-xs text-slate-400 mt-1">
            한국/미국 거래소 실제 가격을 AI로 실시간 대조하여 정밀한 자산 비중과 수익률을 산출합니다.
          </p>
        </div>
        
        {/* Sorting Toggles */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl self-start sm:self-auto border border-slate-200 shadow-sm">
          <button
            type="button"
            onClick={() => setSortBy('profit')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1 cursor-pointer ${
              sortBy === 'profit'
                ? 'bg-white text-slate-850 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span>수익률 랭킹순</span>
          </button>
          <button
            type="button"
            onClick={() => setSortBy('recent')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1 cursor-pointer ${
              sortBy === 'recent'
                ? 'bg-white text-slate-850 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span>최근 등록순</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {sortedPortfolios.map((portfolio, idx) => {
          const isMe = portfolio.nickname === currentUserNickname;
          const profitPct = portfolio.calculatedProfitRate;
          const totalCurrentVal = portfolio.calculatedCurrentVal;

          // Date format Helper
          let dateStr = '방금 전';
          if (portfolio.updatedAt) {
            try {
              const dt = portfolio.updatedAt.toDate ? portfolio.updatedAt.toDate() : new Date(portfolio.updatedAt);
              dateStr = new Intl.DateTimeFormat('ko-KR', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              }).format(dt);
            } catch (x) {}
          }

          return (
            <div
              key={portfolio.nickname}
              onClick={() => handleToggleDetail(portfolio.nickname)}
              className={`border rounded-[24px] bg-white p-5 flex flex-col items-center justify-between text-center transition duration-200 cursor-pointer hover:shadow-md group relative min-h-[290px] ${
                isMe ? 'ring-2 ring-emerald-500/30 border-emerald-500' : 'border-slate-100 hover:border-slate-200'
              }`}
              title={`${portfolio.nickname}님의 포트폴리오 정밀 비교 및 상세 분석 (수익률: ${profitPct.toFixed(2)}%)`}
            >
              {/* Card Header Label */}
              <div className="text-center font-bold text-xs text-slate-500/80 tracking-tight transition truncate w-full flex items-center justify-center gap-1.5 px-0.5">
                <span className="truncate">{idx + 1}번 {portfolio.nickname} {isMe && '(나)'}</span>
                {portfolio.reason && (
                  <span className="bg-indigo-50 text-indigo-600 text-[8px] font-black px-1.5 py-0.5 rounded border border-indigo-150 shrink-0 uppercase tracking-wide cursor-help select-none" title="설계 사유 및 투자 전략 기입됨">💡 전략</span>
                )}
              </div>

              {/* Central Large Donut Chart */}
              <div className="my-3 flex items-center justify-center relative w-full h-[140px]">
                <PortfolioChart assets={portfolio.assets || []} savings={portfolio.savings} variant="board" marketPrices={marketPrices} catalogPrices={catalogPrices} exchangeRate={exchangeRate} />
                
                {/* Micro profit indicator inside the hole */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none translate-y-0.5">
                  <span className={`text-[10px] font-black font-mono tracking-tighter ${
                    profitPct > 0 
                      ? 'text-rose-500' 
                      : profitPct < 0 
                        ? 'text-blue-500' 
                        : 'text-slate-400'
                  }`}>
                    {profitPct > 0 ? '▲ +' : profitPct < 0 ? '▼ ' : ''}{profitPct.toFixed(2)}%
                  </span>
                </div>
              </div>

              {/* Evaluated Value display */}
              <div className="w-full space-y-1.5">
                <div className="font-mono text-[13px] font-black text-slate-850 truncate">
                  {formatCommas(totalCurrentVal)}원
                </div>
                {isMe && (
                  <div className="text-[8px] text-emerald-600 font-extrabold uppercase mt-0.5 tracking-wider">
                    My Portfolio
                  </div>
                )}

                {/* Direct display of strategy/notes inside card */}
                {portfolio.reason ? (
                  <div className="mt-2.5 px-2 py-1.5 bg-indigo-50/55 hover:bg-indigo-100/40 border border-indigo-100/30 rounded-xl text-[10px] text-slate-650 text-left font-sans font-medium line-clamp-2 leading-relaxed transition w-full" title={portfolio.reason}>
                    <span className="text-indigo-600 font-bold">💡 </span>
                    <span className="break-all">{portfolio.reason}</span>
                  </div>
                ) : (
                  <div className="mt-2.5 px-2 py-1.5 bg-slate-50 border border-dashed border-slate-150 rounded-xl text-[10px] text-slate-400 italic text-left w-full leading-normal">
                    전략 사유 미작성
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Center-aligned bottom legend with requested sectors */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-6 border-t border-slate-100 select-none text-[11px] max-w-4xl mx-auto">
        <div className="flex items-center space-x-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-150/40">
          <span className="w-2.5 h-2.5 rounded-full bg-[#1e40af]" />
          <span className="font-bold text-slate-600">🧠 AI·반도체</span>
        </div>
        <div className="flex items-center space-x-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-150/40">
          <span className="w-2.5 h-2.5 rounded-full bg-[#8B5CF6]" />
          <span className="font-bold text-slate-600">☁️ 빅테크·플랫폼</span>
        </div>
        <div className="flex items-center space-x-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-150/40">
          <span className="w-2.5 h-2.5 rounded-full bg-[#15803D]" />
          <span className="font-bold text-slate-600">📈 미국지수 ETF</span>
        </div>
        <div className="flex items-center space-x-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-150/40">
          <span className="w-2.5 h-2.5 rounded-full bg-[#84CC16]" />
          <span className="font-bold text-slate-600">💰 배당 ETF</span>
        </div>
        <div className="flex items-center space-x-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-150/40">
          <span className="w-2.5 h-2.5 rounded-full bg-[#F97316]" />
          <span className="font-bold text-slate-600">⚡ 에너지·전력</span>
        </div>
        <div className="flex items-center space-x-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-150/40">
          <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626]" />
          <span className="font-bold text-slate-600">🚗 자동차</span>
        </div>
        <div className="flex items-center space-x-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-150/40">
          <span className="w-2.5 h-2.5 rounded-full bg-[#808000]" />
          <span className="font-bold text-slate-600">🛡️ 방산</span>
        </div>
        <div className="flex items-center space-x-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-150/40">
          <span className="w-2.5 h-2.5 rounded-full bg-[#06B6D4]" />
          <span className="font-bold text-slate-600">🛰️ 통신</span>
        </div>
        <div className="flex items-center space-x-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-150/40">
          <span className="w-2.5 h-2.5 rounded-full bg-[#EC4899]" />
          <span className="font-bold text-slate-600">💖 금융</span>
        </div>
        <div className="flex items-center space-x-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-150/40">
          <span className="w-2.5 h-2.5 rounded-full bg-[#78350F]" />
          <span className="font-bold text-slate-600">🏢 인프라·자산운용</span>
        </div>
        <div className="flex items-center space-x-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-150/40">
          <span className="w-2.5 h-2.5 rounded-full bg-[#EAB308]" />
          <span className="font-bold text-slate-600">🥇 금(GLD)</span>
        </div>
        <div className="flex items-center space-x-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-150/40">
          <span className="w-2.5 h-2.5 rounded-full bg-[#F7931A]" />
          <span className="font-bold text-slate-600">₿ 비트코인</span>
        </div>
        <div className="flex items-center space-x-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-150/40">
          <span className="w-2.5 h-2.5 rounded-full bg-[#64748B]" />
          <span className="font-bold text-slate-600">💵 현금</span>
        </div>
      </div>

      {/* Spacious Full Comparative Overlay Modal (Simulating standalone screen structure) */}
      {selectedNickname && (() => {
        const selectedPortfolio = sortedPortfolios.find(p => p.nickname === selectedNickname);
        if (!selectedPortfolio) return null;
        
        const myPortfolio = sortedPortfolios.find(p => p.nickname === currentUserNickname);
        
        let selectedDateStr = '방금 전';
        if (selectedPortfolio.updatedAt) {
          try {
            const dt = selectedPortfolio.updatedAt.toDate ? selectedPortfolio.updatedAt.toDate() : new Date(selectedPortfolio.updatedAt);
            selectedDateStr = new Intl.DateTimeFormat('ko-KR', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            }).format(dt);
          } catch (x) {}
        }

        return (
          <div 
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-3 md:p-6 select-none animate-fade-in"
            onClick={() => setSelectedNickname(null)}
          >
            <div 
              className="bg-slate-50 w-full max-w-6xl h-[92vh] md:h-[88vh] rounded-3xl shadow-2xl border border-slate-250 flex flex-col overflow-hidden animate-scale-up"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="bg-white p-5 md:p-6 border-b border-slate-200 flex justify-between items-center shrink-0">
                <div className="flex items-center space-x-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center font-extrabold text-white text-base shadow-md">
                    {selectedPortfolio.nickname.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-base md:text-xl font-extrabold text-slate-900 flex items-center gap-2">
                      <span>[{selectedPortfolio.nickname}]님의 상세 자산 포트폴리오</span>
                      {selectedPortfolio.nickname === currentUserNickname && (
                        <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded border border-emerald-300 uppercase tracking-widest leading-none">MY</span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-400 font-medium font-mono mt-0.5">최종 연동 및 보정일: {selectedDateStr}</p>
                  </div>
                </div>
                
                <button
                  type="button"
                  onClick={() => setSelectedNickname(null)}
                  className="p-3 hover:bg-slate-100 text-slate-500 hover:text-slate-800 rounded-xl border border-slate-200 font-extrabold text-xs transition cursor-pointer select-none"
                >
                  닫기 (Close) ✕
                </button>
              </div>

              {/* Modal Splitted Scrollable Work Area */}
              <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 bg-slate-50">
                
                {/* Upper Comparison Hero Summary Widget */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Selected User brief valuation summary */}
                  <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex justify-between items-center gap-4">
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">[{selectedPortfolio.nickname}]님의 평가 자산 합계</span>
                      <p className="text-xl md:text-2xl font-mono font-black text-slate-850">₩{formatCommas(selectedPortfolio.calculatedCurrentVal)}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-bold text-slate-400 block font-mono">수익률</span>
                      <span className={`text-base font-black font-mono inline-block px-3 py-1 rounded-lg mt-1 ${
                        selectedPortfolio.calculatedProfitRate > 0 
                          ? 'bg-rose-50 text-rose-600 border border-rose-100/50 shadow-xs' 
                          : selectedPortfolio.calculatedProfitRate < 0 
                            ? 'bg-blue-50 text-blue-600 border border-blue-100/50 shadow-xs' 
                            : 'bg-slate-50 text-slate-500 border border-slate-200'
                      }`}>
                        {selectedPortfolio.calculatedProfitRate > 0 ? '▲ +' : selectedPortfolio.calculatedProfitRate < 0 ? '▼ ' : ''}
                        {selectedPortfolio.calculatedProfitRate.toFixed(2)}%
                      </span>
                    </div>
                  </div>

                  {/* My brief valuation summary */}
                  <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex justify-between items-center gap-4">
                    {myPortfolio ? (
                      <>
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">나의 자산 평가액 (대조군)</span>
                          <p className="text-xl md:text-2xl font-mono font-black text-slate-850">₩{formatCommas(myPortfolio.calculatedCurrentVal)}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] font-bold text-slate-400 block font-mono">나의 수익률</span>
                          <span className={`text-base font-black font-mono inline-block px-3 py-1 rounded-lg mt-1 ${
                            myPortfolio.calculatedProfitRate > 0 
                              ? 'bg-rose-50 text-rose-600 border border-rose-100/50 shadow-xs' 
                              : myPortfolio.calculatedProfitRate < 0 
                                ? 'bg-blue-50 text-blue-600 border border-blue-100/50 shadow-xs' 
                                : 'bg-slate-50 text-slate-500 border border-slate-200'
                          }`}>
                            {myPortfolio.calculatedProfitRate > 0 ? '▲ +' : myPortfolio.calculatedProfitRate < 0 ? '▼ ' : ''}
                            {myPortfolio.calculatedProfitRate.toFixed(2)}%
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 text-center py-2 flex flex-col justify-center">
                        <p className="text-xs font-bold text-slate-400">포트폴리오 미작성 상태</p>
                        <p className="text-[10px] text-slate-400 mt-1">내 포트폴리오를 설계 완료하고 대시보드에 공유하면 즉각 1:1 비교를 할 수 있습니다.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Portfolio construction reason, if available */}
                {selectedPortfolio.reason ? (
                  <div className="bg-gradient-to-r from-indigo-50/70 to-blue-50/40 border border-slate-200/80 rounded-2xl p-5 md:p-6 shadow-sm flex items-start space-x-4 shrink-0">
                    <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-200 flex items-center justify-center text-indigo-700 font-extrabold text-base shrink-0 select-none">
                      💡
                    </div>
                    <div className="space-y-1.5 flex-1 select-text">
                      <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block font-mono">
                        [{selectedPortfolio.nickname}]님의 투자 철학 및 포트폴리오 설계 사유
                      </span>
                      <p className="text-xs md:text-sm text-slate-700 leading-relaxed font-semibold">
                        "{selectedPortfolio.reason}"
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-amber-50/20 border border-dashed border-slate-200 rounded-2xl p-4 text-center text-xs text-slate-450 flex items-center justify-center space-x-2 shrink-0">
                    <span>💡 [{selectedPortfolio.nickname}]님은 별도의 포트폴리오 대외 공개 전략 및 설계 사유를 작성하지 않았습니다.</span>
                  </div>
                )}

                {/* 2-Column Side-By-Side Spacious Allocation Workspace */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-2">
                  
                  {/* Left Panel: Selected User detail */}
                  <div className="space-y-5 bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-3 shrink-0">
                      <h4 className="text-xs md:text-sm font-extrabold text-indigo-750 flex items-center space-x-1.5">
                        <span className="w-2.5 h-2.5 bg-indigo-600 rounded-full animate-pulse" />
                        <span>[{selectedPortfolio.nickname}]님의 자산 구성 차트 및 내역</span>
                      </h4>
                      <span className="text-[11px] font-mono text-slate-400 font-semibold bg-slate-50 px-2 py-0.5 rounded border border-slate-250">1,000만원 기준</span>
                    </div>

                    {/* Chart Container - spacious */}
                    <div className="bg-slate-50 border border-slate-150 rounded-xl p-4 flex items-center justify-center shrink-0">
                      <PortfolioChart assets={selectedPortfolio.assets || []} savings={selectedPortfolio.savings} marketPrices={marketPrices} catalogPrices={catalogPrices} exchangeRate={exchangeRate} />
                    </div>

                    {/* Rich Asset details breakdown table (without text cropping! Spacious padding) */}
                    <div className="space-y-3 pt-4 flex-1">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest font-mono block">개별 보유 자산 디폴트 분석</span>
                      
                      <div className="space-y-3">
                        {(selectedPortfolio.assets || []).map((asset, idx) => {
                          const activeCurrentPrice = resolveUnitPrice(asset);
                          const currentAssetVal = activeCurrentPrice * asset.quantity;
                          const assetYield = asset.price > 0 ? ((activeCurrentPrice - asset.price) / asset.price) * 100 : 0;
                          const typeMeta = ASSET_TYPE_MAP[asset.type || 'stock'];
                          const assetColor = getAssetColor(asset.name);

                          return (
                            <div
                              key={idx}
                              className="bg-white hover:bg-slate-50 border border-slate-200 border-l-[6px] rounded-xl p-5 flex flex-col space-y-3 shadow-xs border-r border-y transition"
                              style={{ borderLeftColor: assetColor }}
                            >
                              <div className="flex justify-between items-start">
                                <div className="space-y-1 min-w-0">
                                  <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                                    {typeMeta && (
                                      <span className={`text-[9px] font-black px-2 py-0.5 rounded border leading-none font-sans uppercase ${typeMeta.bg} ${typeMeta.text} ${typeMeta.border}`}>
                                        {typeMeta.label}
                                      </span>
                                    )}
                                    <span className="font-extrabold text-sm text-slate-900 tracking-tight whitespace-normal break-all">
                                      {asset.name}
                                    </span>
                                  </div>
                                  <span className="text-xs text-slate-400 font-bold font-mono block">
                                    설정 보유 평량: {asset.quantity} 단위
                                  </span>
                                </div>
                                <div className="text-right shrink-0">
                                  {((marketPrices && marketPrices[asset.name.trim()] !== undefined) || asset.currentPrice !== undefined) && (
                                    <span className={`text-[10px] font-black font-mono px-2 py-0.5 rounded ${
                                      assetYield > 0 
                                        ? 'bg-rose-50 text-rose-650 border border-rose-200' 
                                        : assetYield < 0 
                                          ? 'bg-blue-50 text-blue-650 border border-blue-200' 
                                          : 'bg-slate-50 text-slate-500'
                                    }`}>
                                      {assetYield > 0 ? '▲ +' : assetYield < 0 ? '▼ ' : ''}{assetYield.toFixed(2)}%
                                    </span>
                                  )}
                                  <span className="font-mono text-sm md:text-base font-extrabold text-slate-950 block mt-1.5">
                                    ₩{formatCommas(currentAssetVal)}
                                  </span>
                                </div>
                              </div>

                              <div className="pt-2.5 border-t border-slate-100 flex flex-wrap justify-between items-center text-[11px] text-slate-500 gap-2 font-sans">
                                <div>
                                  <span>매수가: </span>
                                  <span className="font-mono font-bold text-slate-800">{formatCommas(asset.price)}원</span>
                                  {((marketPrices && marketPrices[asset.name.trim()] !== undefined) || asset.currentPrice !== undefined) && (
                                    <>
                                      <span className="mx-2 text-slate-200">|</span>
                                      <span>실시간 현재가격: </span>
                                      <span className="font-mono font-extrabold text-indigo-750">{formatCommas(activeCurrentPrice)}원</span>
                                    </>
                                  )}
                                </div>
                                
                                {asset.sourceUrl && (
                                  <a
                                    href={asset.sourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-emerald-700 hover:text-emerald-800 hover:underline flex items-center font-bold font-sans text-xs"
                                  >
                                    <span>출처공시 ↗</span>
                                  </a>
                                )}
                              </div>
                              {asset.searchReasoning && (
                                <p className="text-xs text-slate-500 leading-relaxed bg-slate-50 border border-slate-200 p-3 rounded-lg font-sans">
                                  📢 <span className="font-bold text-indigo-650 font-sans">AI 시세 분석 사유:</span> {asset.searchReasoning}
                                </p>
                              )}
                            </div>
                          );
                        })}

                        {/* Cash */}
                        <div className="bg-emerald-50/20 border border-emerald-150 border-l-[6px] rounded-xl p-5 flex justify-between items-center shadow-xs" style={{ borderLeftColor: getAssetColor('파킹통장 예금 (현금)') }}>
                          <span className="font-black text-emerald-800 text-xs flex items-center">
                            🏦 파킹통장 안전 대기자산 (현금)
                          </span>
                          <span className="font-mono text-emerald-700 text-xs font-extrabold shrink-0">
                            ₩{formatCommas(selectedPortfolio.savings)} ({((selectedPortfolio.savings / 10000000) * 100).toFixed(1)}% 비중)
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Panel: Comparison Column (My Portfolio Details) */}
                  <div className="space-y-5 bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                    {myPortfolio ? (
                      <>
                        <div className="flex justify-between items-center border-b border-slate-100 pb-3 shrink-0">
                          <h4 className="text-xs md:text-sm font-extrabold text-emerald-850 flex items-center space-x-1.5">
                            <span className="w-2.5 h-2.5 bg-emerald-600 rounded-full" />
                            <span>나의 포트폴리오 비중 및 지표 ({myPortfolio.nickname})</span>
                          </h4>
                          <span className="text-[11px] font-mono text-slate-400 font-semibold bg-slate-50 px-2 py-0.5 rounded border border-slate-250">1,000만원 기준</span>
                        </div>

                        {/* Chart Container - spacious */}
                        <div className="bg-slate-50 border border-slate-150 rounded-xl p-4 flex items-center justify-center shrink-0">
                          <PortfolioChart assets={myPortfolio.assets || []} savings={myPortfolio.savings} marketPrices={marketPrices} catalogPrices={catalogPrices} exchangeRate={exchangeRate} />
                        </div>

                        {/* Rich Asset details breakdown table */}
                        <div className="space-y-3 pt-4 flex-1">
                          <span className="text-[11px] font-bold text-slate-450 uppercase tracking-widest font-mono block">나의 최신 자산 배분 내역</span>
                          
                          <div className="space-y-3">
                            {(myPortfolio.assets || []).map((asset, idx) => {
                              const activeCurrentPrice = resolveUnitPrice(asset);
                              const currentAssetVal = activeCurrentPrice * asset.quantity;
                              const assetYield = asset.price > 0 ? ((activeCurrentPrice - asset.price) / asset.price) * 100 : 0;
                              const typeMeta = ASSET_TYPE_MAP[asset.type || 'stock'];
                              const assetColor = getAssetColor(asset.name);

                              return (
                                <div
                                  key={idx}
                                  className="bg-white hover:bg-slate-50 border border-slate-200 border-l-[6px] rounded-xl p-5 flex flex-col space-y-3 shadow-xs border-r border-y transition"
                                  style={{ borderLeftColor: assetColor }}
                                >
                                  <div className="flex justify-between items-start">
                                    <div className="space-y-1 min-w-0">
                                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                                        {typeMeta && (
                                          <span className={`text-[9px] font-black px-2 py-0.5 rounded border leading-none font-sans uppercase ${typeMeta.bg} ${typeMeta.text} ${typeMeta.border}`}>
                                            {typeMeta.label}
                                          </span>
                                        )}
                                        <span className="font-extrabold text-sm text-slate-900 tracking-tight whitespace-normal break-all">
                                          {asset.name}
                                        </span>
                                      </div>
                                      <span className="text-xs text-slate-550 font-bold font-mono block">
                                        설정 보유 평량: {asset.quantity} 단위
                                      </span>
                                    </div>
                                    <div className="text-right shrink-0">
                                      {((marketPrices && marketPrices[asset.name.trim()] !== undefined) || asset.currentPrice !== undefined) && (
                                        <span className={`text-[10px] font-black font-mono px-2 py-0.5 rounded ${
                                          assetYield > 0 
                                            ? 'bg-rose-50 text-rose-650 border border-rose-200' 
                                            : assetYield < 0 
                                              ? 'bg-blue-50 text-blue-650 border border-blue-200' 
                                              : 'bg-slate-50 text-slate-500'
                                        }`}>
                                          {assetYield > 0 ? '▲ +' : assetYield < 0 ? '▼ ' : ''}{assetYield.toFixed(2)}%
                                        </span>
                                      )}
                                      <span className="font-mono text-sm md:text-base font-extrabold text-slate-950 block mt-1.5">
                                        ₩{formatCommas(currentAssetVal)}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="pt-2.5 border-t border-slate-100 flex flex-wrap justify-between items-center text-[11px] text-slate-500 gap-2 font-sans font-medium">
                                    <div>
                                      <span>매수가: </span>
                                      <span className="font-mono font-bold text-slate-800">{formatCommas(asset.price)}원</span>
                                      {((marketPrices && marketPrices[asset.name.trim()] !== undefined) || asset.currentPrice !== undefined) && (
                                        <>
                                          <span className="mx-2 text-slate-200">|</span>
                                          <span>실시간 현재가격: </span>
                                          <span className="font-mono font-extrabold text-indigo-750">{formatCommas(activeCurrentPrice)}원</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}

                            {/* Cash */}
                            <div className="bg-emerald-50/20 border border-emerald-150 border-l-[6px] rounded-xl p-5 flex justify-between items-center shadow-xs" style={{ borderLeftColor: getAssetColor('파킹통장 예금 (현금)') }}>
                              <span className="font-black text-emerald-800 text-xs flex items-center">
                                🏦 파킹통장 안전 대기자산 (현금)
                              </span>
                              <span className="font-mono text-emerald-700 text-xs font-extrabold shrink-0">
                                ₩{formatCommas(myPortfolio.savings)} ({((myPortfolio.savings / 10000000) * 100).toFixed(1)}% 비중)
                              </span>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
                        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200 text-slate-400">
                          <Users className="w-6 h-6" />
                        </div>
                        <div className="max-w-sm space-y-2">
                          <h4 className="text-sm font-bold text-slate-700">나의 포트폴리오를 구성해 보세요!</h4>
                          <p className="text-xs text-slate-400 leading-relaxed font-sans">
                            메인 화면의 자산 설정 및 닉네임 입력 후, '참여 및 포트폴리오 공유'를 클릭하시면 다른 참가자들의 상세 포트폴리오 비중을 이 널찍한 비교창에서 1:1로 정밀하게 실시간 대조해볼 수 있습니다.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                </div>

              </div>
              
              {/* Modal Footer */}
              <div className="bg-slate-100 p-4 border-t border-slate-200 flex justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedNickname(null)}
                  className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer select-none"
                >
                  분석 완료 및 닫기
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
