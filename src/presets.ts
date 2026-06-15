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
];

export const DOMESTIC_PRESETS: PresetAsset[] = [
  { name: 'SK하이닉스', type: 'stock', price: 2150000 },
  { name: '삼성전자', type: 'stock', price: 322500 },
  { name: '현대차', type: 'stock', price: 607000 },
  { name: '두산에너빌리티', type: 'stock', price: 106805 },
  { name: 'TIGER 반도체TOP10', type: 'etf', price: 53000 },
  { name: 'TIGER S&P500 ETF', type: 'etf', price: 310000 },
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
  { name: 'QQQ', type: 'etf', price: 1100000, usdPrice: 733.33, ticker: 'QQQ' },
  { name: 'SCHD', type: 'etf', price: 49230, usdPrice: 32.82 },
  { name: '시놉시스', type: 'stock', price: 680835, usdPrice: 453.89 },
  { name: 'TSMC', type: 'stock', price: 635895, usdPrice: 423.93 },
  { name: '테슬라', type: 'stock', price: 630000, usdPrice: 420, ticker: 'TSLA' },
  { name: 'VOO', type: 'etf', price: 1022925, usdPrice: 681.95 },
  { name: 'ASML', type: 'stock', price: 2795325, usdPrice: 1863.55 },
  { name: 'GLD', type: 'etf', price: 579810, usdPrice: 386.54 },
  { name: '노키아 ADR', type: 'stock', price: 22200, usdPrice: 14.8 },
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

/** 미국 주식 간편 선택 UI용 영문 표시명 (내부 식별·매수는 한글 canonical name 유지) */
export const US_ASSET_ENGLISH_NAMES: Readonly<Record<string, string>> = {
  AMD: 'AMD',
  '알파벳 Class A': 'Alphabet (Class A)',
  아마존: 'Amazon',
  애플: 'Apple',
  브로드컴: 'Broadcom',
  메타: 'Meta',
  마이크로소프트: 'Microsoft',
  마이크론: 'Micron Technology',
  엔비디아: 'NVIDIA',
  팔란티어: 'Palantir',
  SPY: 'SPY',
  QQQ: 'QQQ',
  SCHD: 'SCHD',
  시놉시스: 'Synopsys',
  TSMC: 'TSMC',
  테슬라: 'Tesla',
  VOO: 'VOO',
  ASML: 'ASML',
  GLD: 'GLD',
  '노키아 ADR': 'Nokia ADR',
  록히드마틴: 'Lockheed Martin',
  '루멘텀 홀딩스': 'Lumentum Holdings',
  브룩필드: 'Brookfield',
  '스페이스 X': 'SpaceX',
};

export function getUsAssetDisplayName(name: string): string {
  const trimmed = name.trim();
  if (US_ASSET_ENGLISH_NAMES[trimmed]) return US_ASSET_ENGLISH_NAMES[trimmed];
  const lower = trimmed.toLowerCase();
  const match = Object.entries(US_ASSET_ENGLISH_NAMES).find(
    ([key]) => key.toLowerCase() === lower
  );
  return match?.[1] ?? trimmed;
}
