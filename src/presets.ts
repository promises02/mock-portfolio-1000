import { AssetType, AssetMarket, DisplayCurrency } from './types';

export interface PresetAsset {
  name: string;
  type: AssetType;
  price: number;
  usdPrice?: number;
  ticker?: string;
}

export interface RecommendedAsset {
  id: string;
  name: string;
  ticker: string;
  type: 'stock';
  market: 'Korea';
  marketRegion: AssetMarket;
  priceKRW: number;
  displayCurrency: 'KRW';
}

export const RECOMMENDED_ASSETS: RecommendedAsset[] = [
  { id: 'rec_000660', name: 'SK하이닉스', ticker: '000660', type: 'stock', market: 'Korea', marketRegion: 'Korea', priceKRW: 2150000, displayCurrency: 'KRW' },
  { id: 'rec_005930', name: '삼성전자', ticker: '005930', type: 'stock', market: 'Korea', marketRegion: 'Korea', priceKRW: 322500, displayCurrency: 'KRW' },
  { id: 'rec_005380', name: '현대차', ticker: '005380', type: 'stock', market: 'Korea', marketRegion: 'Korea', priceKRW: 607000, displayCurrency: 'KRW' },
  { id: 'rec_034020', name: '두산에너빌리티', ticker: '034020', type: 'stock', market: 'Korea', marketRegion: 'Korea', priceKRW: 93100, displayCurrency: 'KRW' },
  { id: 'rec_051910', name: 'LG화학', ticker: '051910', type: 'stock', market: 'Korea', marketRegion: 'Korea', priceKRW: 358000, displayCurrency: 'KRW' },
  { id: 'rec_035420', name: 'NAVER', ticker: '035420', type: 'stock', market: 'Korea', marketRegion: 'Korea', priceKRW: 212000, displayCurrency: 'KRW' },
  { id: 'rec_035720', name: '카카오', ticker: '035720', type: 'stock', market: 'Korea', marketRegion: 'Korea', priceKRW: 45800, displayCurrency: 'KRW' },
  { id: 'rec_068270', name: '셀트리온', ticker: '068270', type: 'stock', market: 'Korea', marketRegion: 'Korea', priceKRW: 189500, displayCurrency: 'KRW' },
];

export const DOMESTIC_PRESETS: PresetAsset[] = [
  { name: 'SK하이닉스', type: 'stock', price: 2150000 },
  { name: '삼성전자', type: 'stock', price: 322500 },
  { name: '현대차', type: 'stock', price: 607000 },
  { name: '두산에너빌리티', type: 'stock', price: 106805 },
  { name: 'TIGER 반도체TOP10', type: 'etf', price: 53000 },
  { name: 'KODEX 미국S&P500', type: 'etf', price: 25420 },
  { name: 'KODEX 미국나스닥100', type: 'etf', price: 29645 },
];

export const FOREIGN_PRESETS: PresetAsset[] = [
  { name: 'AMD', type: 'stock', price: 767355, usdPrice: 511.57 },
  { name: '알파벳 Class A', type: 'stock', price: 539520, usdPrice: 359.68 },
  { name: '아마존', type: 'stock', price: 357825, usdPrice: 238.55 },
  { name: '애플', type: 'stock', price: 436695, usdPrice: 291.13 },
  { name: '브로드컴', type: 'stock', price: 573105, usdPrice: 382.07 },
  { name: '메타', type: 'stock', price: 850470, usdPrice: 566.98 },
  { name: '마이크로소프트', type: 'stock', price: 586110, usdPrice: 390.74 },
  { name: '마이크론', type: 'stock', price: 1472415, usdPrice: 981.61, ticker: 'MU' },
  { name: '엔비디아', type: 'stock', price: 307785, usdPrice: 205.19 },
  { name: '팔란티어', type: 'stock', price: 191985, usdPrice: 127.99 },
  { name: 'SPY', type: 'etf', price: 1112625, usdPrice: 741.75 },
  { name: 'SCHD', type: 'etf', price: 49230, usdPrice: 32.82 },
  { name: '시놉시스', type: 'stock', price: 680835, usdPrice: 453.89 },
  { name: 'TSMC', type: 'stock', price: 635895, usdPrice: 423.93 },
  { name: 'VOO', type: 'etf', price: 1022925, usdPrice: 681.95 },
  { name: 'ASML', type: 'stock', price: 2795325, usdPrice: 1863.55 },
  { name: 'GLD', type: 'etf', price: 579810, usdPrice: 386.54 },
  { name: '노키아 ADR', type: 'stock', price: 21120, usdPrice: 14.08 },
  { name: '록히드마틴', type: 'stock', price: 810495, usdPrice: 540.33 },
  { name: '루멘텀 홀딩스', type: 'stock', price: 1382340, usdPrice: 921.56 },
  { name: '브룩필드', type: 'stock', price: 67815, usdPrice: 45.21 },
  { name: '스페이스 X', type: 'stock', price: 160425, usdPrice: 106.95, ticker: 'SPCX' },
];

export const CRYPTO_PRESETS: PresetAsset[] = [
  { name: '비트코인', type: 'crypto', price: 162000000 },
];

export const ALL_PRESETS: PresetAsset[] = [
  ...DOMESTIC_PRESETS,
  ...FOREIGN_PRESETS,
  ...CRYPTO_PRESETS,
];

export function getPresetByName(name: string): PresetAsset | undefined {
  const norm = name.trim().toLowerCase();
  return ALL_PRESETS.find(p => p.name.trim().toLowerCase() === norm);
}
