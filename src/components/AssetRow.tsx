import React, { useState, useEffect } from 'react';
import { AssetItem, AssetType } from '../types';
import { formatCommas, formatKRW, getDisplayPrice, getAssetYieldPercent, inferAssetMarket, inferAssetSector, DEFAULT_EXCHANGE_RATE } from '../utils';
import { Trash2, Coins } from 'lucide-react';
import { ASSET_TYPE_MAP } from './AssetInputForm';
import { getPresetByName } from '../presets';

interface AssetRowProps {
  asset: AssetItem;
  index: number;
  handleUpdateAsset: (index: number, key: keyof AssetItem, value: any) => void;
  handleRemoveAsset: (index: number) => void;
  marketPrices?: Record<string, number>;
  exchangeRate?: number;
}

export const AssetRow: React.FC<AssetRowProps> = ({
  asset,
  index,
  handleUpdateAsset,
  handleRemoveAsset,
  marketPrices,
  exchangeRate = DEFAULT_EXCHANGE_RATE,
}) => {
  const [localPrice, setLocalPrice] = useState(String(asset.price === 0 ? '' : asset.price));
  const [localQuantity, setLocalQuantity] = useState(String(asset.quantity === 0 ? '' : asset.quantity));
  const [localCurrentPrice, setLocalCurrentPrice] = useState(asset.currentPrice === undefined ? '' : String(asset.currentPrice));
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const customPrice = marketPrices && marketPrices[asset.name.trim()];
  const activeCurrentPrice = customPrice !== undefined ? customPrice : (asset.currentPrice ?? asset.price);

  // Instantly auto-fill preset stock details when asset name is selected or types-in fully
  useEffect(() => {
    const trimmedVal = String(asset.name).trim();
    const matched = getPresetByName(trimmedVal.toLowerCase());
    if (matched) {
      if (asset.price === 0) {
        setLocalPrice(String(matched.price));
        handleUpdateAsset(index, 'price', matched.price);
      }
      if (asset.type !== matched.type) {
        handleUpdateAsset(index, 'type', matched.type);
      }
    }
  }, [asset.name]);

  // Sync state cleanly if the numeric values diverge (from parents resets, presets, or fetches)
  useEffect(() => {
    const currentNum = parseFloat(localPrice) || 0;
    if (Math.abs(currentNum - asset.price) > 0.0001) {
      setLocalPrice(asset.price === 0 ? '' : String(asset.price));
    }
  }, [asset.price]);

  useEffect(() => {
    const currentNum = parseFloat(localQuantity) || 0;
    if (Math.abs(currentNum - asset.quantity) > 0.000001) {
      setLocalQuantity(asset.quantity === 0 ? '' : String(asset.quantity));
    }
  }, [asset.quantity]);

  useEffect(() => {
    const targetPrice = customPrice !== undefined ? customPrice : asset.currentPrice;
    if (targetPrice === undefined) {
      if (localCurrentPrice !== '') {
        setLocalCurrentPrice('');
      }
    } else {
      const currentNum = parseFloat(localCurrentPrice) || 0;
      if (Math.abs(currentNum - targetPrice) > 0.0001) {
        setLocalCurrentPrice(String(targetPrice));
      }
    }
  }, [asset.currentPrice, customPrice]);

  const onPriceChange = (val: string) => {
    setLocalPrice(val);
    const numPrice = val === '' ? 0 : (parseFloat(val) || 0);
    handleUpdateAsset(index, 'price', numPrice);
  };

  const onQuantityChange = (val: string) => {
    setLocalQuantity(val);
    const numQty = val === '' ? 0 : (parseFloat(val) || 0);
    handleUpdateAsset(index, 'quantity', numQty);
  };

  const onCurrentPriceChange = (val: string) => {
    setLocalCurrentPrice(val);
    if (val === '') {
      handleUpdateAsset(index, 'currentPrice', '');
    } else {
      const num = parseFloat(val) || 0;
      handleUpdateAsset(index, 'currentPrice', num);
    }
  };

  const hasAIPrices = (customPrice !== undefined) || (asset.currentPrice !== undefined);
  const currentItemTotal = activeCurrentPrice * asset.quantity;
  const itemYield = getAssetYieldPercent(asset, activeCurrentPrice, exchangeRate);
  const purchaseDisplay = getDisplayPrice(asset, exchangeRate, {
    priceKrw: asset.priceKRW ?? asset.price,
    priceUsd: asset.purchasePriceUSD ?? asset.priceUSD,
    priceCrypto: asset.priceCrypto,
  });
  const currentDisplay = getDisplayPrice(asset, exchangeRate, {
    priceKrw: asset.priceKRW ?? activeCurrentPrice,
    priceUsd: asset.priceUSD,
    priceCrypto: asset.priceCrypto,
  });

  return (
    <div
      className="bg-white hover:bg-slate-55/20 p-4 border border-slate-200 shadow-sm rounded-xl transition duration-150 flex flex-col space-y-3.5 relative group"
    >
      {/* Outer layouts for parameters and evaluation */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:space-x-4">
        <div className="grid grid-cols-12 gap-3 flex-1 min-w-0">
          {/* Asset Type Selector */}
          <div className="col-span-6 sm:col-span-4 lg:col-span-2">
            <label className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-sans whitespace-nowrap">📁 자산 유형</label>
            <select
              value={asset.type || 'stock'}
              onChange={(e) => handleUpdateAsset(index, 'type', e.target.value)}
              className="w-full text-xs font-semibold px-2 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 focus:border-emerald-500 focus:bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-100/50 transition font-sans text-slate-800 cursor-pointer"
            >
              <option value="stock">주식</option>
              <option value="etf">ETF</option>
              <option value="fund">펀드</option>
              <option value="crypto">코인</option>
              <option value="commodity">원자재</option>
              <option value="etc">기타</option>
            </select>
          </div>

          {/* Name Input */}
          <div className="col-span-6 sm:col-span-8 lg:col-span-2">
            <label className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-sans whitespace-nowrap">🏷️ 자산 항목명</label>
            <input
              type="text"
              list={`preset-assets-${index}`}
              placeholder="예: 삼성전자, Apple, 금, Bitcoin"
              value={asset.name}
              onChange={(e) => handleUpdateAsset(index, 'name', e.target.value)}
              className="w-full text-xs font-semibold px-3 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 focus:border-emerald-500 focus:bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-100/50 transition font-sans text-slate-800"
            />
            <datalist id={`preset-assets-${index}`}>
              <option value="SK하이닉스" />
              <option value="삼성전자" />
              <option value="현대차" />
              <option value="두산에너빌리티" />
              <option value="TIGER 반도체TOP10" />
              <option value="KODEX 미국S&P500" />
              <option value="KODEX 미국나스닥100" />
              <option value="AMD" />
              <option value="알파벳 Class A" />
              <option value="아마존" />
              <option value="애플" />
              <option value="브로드컴" />
              <option value="메타" />
              <option value="마이크로소프트" />
              <option value="마이크론" />
              <option value="엔비디아" />
              <option value="팔란티어" />
              <option value="SPY" />
              <option value="QQQ" />
              <option value="SCHD" />
              <option value="시놉시스" />
              <option value="TSMC" />
              <option value="VOO" />
              <option value="ASML" />
              <option value="GLD" />
              <option value="노키아 ADR" />
              <option value="록히드마틴" />
              <option value="루멘텀 홀딩스" />
              <option value="브룩필드" />
              <option value="스페이스 X" />
              <option value="비트코인" />
            </datalist>
          </div>

          {/* Buying Price (매수가 - replaces 매수 설정액 and removes old 매수단가) */}
          <div className="col-span-12 sm:col-span-6 lg:col-span-4 font-sans">
            <label className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-sans whitespace-nowrap">💰 매수가</label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-800">
              {purchaseDisplay}
            </div>
            {hasAIPrices && (
              <div className="mt-1.5 flex items-center justify-between text-[9px] font-extrabold px-1.5 py-1 rounded bg-indigo-50/70 border border-indigo-100/80 text-indigo-700 font-sans shadow-2xs leading-none">
                <span className="text-[8px] text-indigo-500 uppercase font-mono tracking-widest shrink-0 mr-1 font-black">LIVE</span>
                <span className={`font-mono truncate ${itemYield > 0 ? 'text-rose-600' : itemYield < 0 ? 'text-blue-600' : 'text-slate-500'}`}>
                  {currentDisplay} ({itemYield > 0 ? '▲ +' : itemYield < 0 ? '▼ ' : ''}{itemYield.toFixed(2)}%)
                </span>
              </div>
            )}
          </div>

          {/* Quantity Input */}
          <div className="col-span-6 sm:col-span-3 lg:col-span-2">
            <label className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-sans whitespace-nowrap">📊 매수 수량</label>
            <input
              type="number"
              step="any"
              placeholder="0"
              value={localQuantity}
              onChange={(e) => onQuantityChange(e.target.value)}
              className="w-full text-xs font-mono font-bold px-3 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-300 focus:border-emerald-500 focus:bg-white focus:text-slate-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-100/50 transition text-slate-800 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>

          {/* Value display (매입 평가 금액 - multiplies 매수 수량 and 매수가) */}
          <div className="col-span-6 sm:col-span-3 lg:col-span-2 font-sans">
            <label className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-sans whitespace-nowrap">🏦 매입 평가 금액</label>
            <div className="relative">
              <input
                type="text"
                readOnly
                value={formatCommas(Math.round(asset.price * asset.quantity))}
                className="w-full text-xs font-mono font-semibold pl-3 pr-7 py-2 bg-slate-100/80 border border-slate-200 rounded-lg text-slate-600 focus:outline-none select-all cursor-not-allowed"
              />
              <span className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-[10px] font-bold text-slate-450 font-sans">원</span>
            </div>
          </div>

          {/* Secondary categorization field with elegant styling */}
          <div className="col-span-12 border-t border-dashed border-slate-200/80 pt-3 mt-1 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-sans whitespace-nowrap flex items-center gap-1">
                <span>🌐 자산군 분류</span>
              </label>
              <select
                value={asset.marketGroup || ''}
                onChange={(e) => handleUpdateAsset(index, 'marketGroup', e.target.value)}
                className="w-full text-xs font-bold px-2.5 py-1.5 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100/50 transition font-sans text-slate-700 font-medium cursor-pointer"
              >
                <option value="">{`자동 매핑: ${inferAssetMarket(asset.name, asset.type)}`}</option>
                <option value="국내 주식">국내 주식</option>
                <option value="미국 주식">미국 주식</option>
                <option value="암호화폐">암호화폐</option>
                <option value="부동산 및 리츠">부동산 및 리츠</option>
                <option value="현금 및 안전자산">현금 및 안전자산</option>
                <option value="기타">기타 분류</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-sans whitespace-nowrap flex items-center gap-1">
                <span>🏭 상세 섹터</span>
              </label>
              <select
                value={asset.sector || ''}
                onChange={(e) => handleUpdateAsset(index, 'sector', e.target.value)}
                className="w-full text-xs font-bold px-2.5 py-1.5 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100/50 transition font-sans text-slate-700 font-medium cursor-pointer"
              >
                <option value="">{`자동 매핑: ${inferAssetSector(asset.name, asset.type)}`}</option>
                <option value="반도체">🧠 반도체</option>
                <option value="정보기술(IT)">💻 정보기술(IT)</option>
                <option value="경기소비재">🚗 경기소비재</option>
                <option value="금융">💖 금융</option>
                <option value="원자재">🥇 원자재</option>
                <option value="에너지·전력">⚡ 에너지·전력</option>
                <option value="방산">🛡️ 방산</option>
                <option value="통신">🛰️ 통신</option>
                <option value="부동산·인프라">🏢 부동산·인프라</option>
                <option value="암호화폐">₿ 암호화폐</option>
                <option value="현금">💵 현금</option>
                <option value="기타">기타</option>
              </select>
            </div>
          </div>
        </div>

        {/* Overall Value display */}
        <div className="pt-3.5 border-t border-slate-100 sm:pt-1 sm:border-0 shrink-0 text-right min-w-[135px] font-sans flex flex-col items-end justify-center">
          <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wide whitespace-nowrap">
            {hasAIPrices ? '현재 실제 평가액 합계' : '매입 평가 금액'}
          </span>
          <span className="text-sm font-extrabold font-mono text-slate-900 block">
            ₩{formatCommas(currentItemTotal)}
          </span>
          <span className="text-[10px] text-emerald-600 font-medium block">
            ({formatKRW(currentItemTotal)})
          </span>
          <button
            type="button"
            onClick={() => setIsEditorOpen(!isEditorOpen)}
            className="mt-2 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-slate-100 border border-indigo-150 px-2 py-1 rounded transition flex items-center gap-1 cursor-pointer select-none leading-tight"
            title="실시간 평가단가(현재가) 수동 조정을 원하시면 클릭하세요"
          >
            {isEditorOpen ? '시세 수정 닫기 ▲' : '현재가 직접 수정 ⚙️'}
          </button>
          <button
            type="button"
            onClick={() => handleRemoveAsset(index)}
            className="mt-1.5 text-[10px] font-bold text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-150 px-2.5 py-1 rounded transition flex items-center gap-1 cursor-pointer select-none leading-tight"
            title="항목 삭제"
          >
            <Trash2 className="w-3" style={{ height: '12px' }} />
            <span>항목 삭제</span>
          </button>
        </div>
      </div>

      {/* AI Prices details & Manual price editing block section */}
      {isEditorOpen && (
        <div className="bg-slate-55/65 bg-slate-55 bg-slate-50 border border-slate-150 p-3.5 rounded-xl space-y-3 animate-fade-in text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              <span className="text-[10px] font-bold text-indigo-650 flex items-center bg-indigo-50 border border-indigo-150 px-2 py-0.5 rounded leading-none uppercase tracking-wide">
                <Coins className="w-3 h-3 mr-1 text-indigo-500" />
                자산 실제가 (현재가) 설정 및 개별 수익률
              </span>
              {asset.sourceUrl && (
                <a
                  href={asset.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-700 font-bold flex items-center hover:underline text-[10px] sm:ml-1"
                >
                  <span>공식 출처 ↗</span>
                </a>
              )}
              {hasAIPrices && (
                <button
                  type="button"
                  onClick={() => handleUpdateAsset(index, 'currentPrice', '')}
                  className="text-[9px] text-slate-500 hover:text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 text-center font-bold tracking-tight cursor-pointer transition"
                  title="매수가와 동일하게 수동가격을 지우고 초기화합니다"
                >
                  시세 초기화
                </button>
              )}
            </div>

            {/* Yield rate badge */}
            <span className={`font-mono font-black px-2 py-0.5 rounded text-[11px] self-start sm:self-auto ${
              itemYield > 0 
                ? 'bg-rose-50 text-rose-600 border border-rose-150/40' 
                : itemYield < 0 
                  ? 'bg-blue-50 text-blue-600 border border-blue-150/40' 
                  : 'bg-slate-200/50 text-slate-500 border border-slate-200/40'
            }`}>
              수익률: {itemYield > 0 ? '▲ +' : itemYield < 0 ? '▼ ' : ''}{itemYield.toFixed(2)}%
            </span>
          </div>

          <div className="grid grid-cols-12 gap-3 items-center">
            <div className="col-span-12 sm:col-span-6">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">실시간 평가단가(현재가) (₩)</span>
                <span className="text-[9px] text-slate-400 font-medium font-sans">직접 입력하여 수정 가능</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  placeholder={String(asset.price)}
                  value={localCurrentPrice}
                  onChange={(e) => onCurrentPriceChange(e.target.value)}
                  className="w-full text-xs font-mono font-bold pl-3 pr-7 py-2 bg-white border border-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100/50 rounded-lg transition text-slate-800"
                />
                <span className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-[10px] font-extrabold text-slate-400 font-sans">원</span>
              </div>
            </div>

            <div className="col-span-12 sm:col-span-6 text-left sm:text-right text-xs text-slate-500 space-y-1 font-sans">
              <div className="flex justify-between sm:justify-end gap-2.5 items-center">
                <span className="text-[10px] text-slate-400">자산 총 평가가치:</span>
                <span className="font-mono font-black text-slate-850 text-sm">
                  ₩{formatCommas(currentItemTotal)}
                </span>
              </div>
              <div className="flex justify-between sm:justify-end gap-2.5 items-center">
                <span className="text-[10px] text-slate-400">평가 금액 (한글):</span>
                <span className="text-[10px] text-emerald-600 font-semibold font-mono">
                  {formatKRW(currentItemTotal)}
                </span>
              </div>
            </div>
          </div>

          {asset.searchReasoning && (
            <div className="bg-slate-100/55 p-2 rounded-lg border border-slate-200/50">
              <p className="text-[10px] text-slate-500 leading-normal font-sans">
                <span className="text-slate-400 font-bold">인공지능 시세 분석 사유:</span> {asset.searchReasoning}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
