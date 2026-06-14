export type AssetType = 'stock' | 'etf' | 'fund' | 'crypto' | 'commodity' | 'etc';
export type AssetMarket = 'US' | 'Korea' | 'Crypto';
export type DisplayCurrency = 'USD' | 'KRW' | 'CRYPTO';
export type MarketSegment = 'us_stock' | 'kr_stock' | 'us_etf' | 'kr_etf' | 'crypto';

export const SECTOR_OPTIONS = [
  'AI·반도체',
  '빅테크·플랫폼',
  '미국자수 ETF',
  '배당 ETF',
  '에너지·전력',
  '자동차',
  '방산',
  '통신',
  '금융',
  '인프라·자산운용',
  '금(GLD)',
  '비트코인',
  '현금',
] as const;

export type SectorOption = (typeof SECTOR_OPTIONS)[number];

/** 자산별 매수/매도 거래 이력 */
export interface PurchaseRecord {
  id: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  amount: number;
  exchangeRateAtTransaction?: number;
  amountInKRW?: number;
  averagePriceAtSale?: number;
  averageExchangeRateAtSale?: number;
  realizedProfit?: number;
  realizedProfitRate?: number;
  timestamp: any;
  date: string;
}

export interface AssetItem {
  name: string;
  type: AssetType; // Type of investment asset
  /**
   * 평균 매입가 (KRW/주 또는 국내 주식 원화 단가).
   * 미국 주식: purchasePriceUSD × purchaseExchangeRate.
   * 매수 시에만 갱신, 매도 시 절대 변하지 않음.
   */
  price: number;
  quantity: number;
  currentPrice?: number;
  /** USD 주당 평균 매입가 (averagePurchasePrice) */
  priceUSD?: number;
  priceKRW?: number;
  priceCrypto?: string;
  /** USD 주당 평균 매입가 — priceUSD와 동일, 매도 후에도 유지 */
  purchasePriceUSD?: number;
  /** 첫 매수 시점 환율 (KRW/USD). 추가 매수·매도 후에도 변경 없음 */
  purchaseExchangeRate?: number;
  /** 총 매입금액 KRW (purchasePriceUSD × purchaseExchangeRate × quantity) */
  totalPurchaseAmount?: number;
  /** UI용 미실현 손익 스냅샷 */
  unrealizedProfit?: number;
  unrealizedProfitRate?: number;
  market?: AssetMarket;
  displayCurrency?: DisplayCurrency;
  sourceUrl?: string;
  searchReasoning?: string;
  marketGroup?: string;
  sector?: string;
  purchaseHistory?: PurchaseRecord[];
}

export interface CustomAsset {
  id: string; // 자산 고유 ID
  name: string; // 자산명
  ticker?: string; // 티커 심볼
  type: 'stock' | 'etf' | 'crypto' | 'fund' | 'etc'; // 자산 종류
  price: number; // KRW 환산 가격 (포트폴리오 계산용, 하위 호환)
  priceUSD?: number; // USD 기준 가격
  priceKRW?: number; // KRW 기준 가격
  priceCrypto?: string; // 암호화폐 가격 (예: "0.0532")
  purchasePriceUSD?: number; // USD 기준 매수가
  purchasePriceKRW?: number; // KRW 기준 매수가
  purchasePriceCrypto?: string; // 암호화폐 매수가
  quantity?: number; // 보유 수량
  sector?: string; // 섹터
  market?: string; // 시장 (예: "국내주식", "미국주식")
  marketRegion?: AssetMarket; // 시장 구분 (US / Korea / Crypto)
  displayCurrency?: DisplayCurrency; // 가격 표시 통화
  addedBy: string; // 추가한 사용자 닉네임
  addedAt: any; // 추가 날짜 (Firestore timestamp)
  isVerified?: boolean; // AI 검증 여부
  verificationStatus?: string; // 검증 상태
  sourceUrl?: string; // 참고 링크
  hiddenByOwner?: boolean; // 추가자 관리 목록에서만 숨김 (시장에는 유지)
  lastPriceUpdatedAt?: any; // 마지막 실시간 가격 갱신 시각 (legacy)
  priceSource?: string; // 가격 출처 (yahoo_finance, naver_finance, coingecko)
  lastUpdatedBy?: LastUpdatedBy;
  lastUpdatedAt?: any;
  updateReason?: AdminPriceUpdateReason;
}

export type LastUpdatedBy = 'api' | 'admin';

export type AdminPriceUpdateReason =
  | '시장 변동'
  | '데이터 정정'
  | '기술적 오류'
  | '기타';

export type AdminExchangeRateUpdateReason =
  | '실시간 환율 반영'
  | '데이터 정정'
  | '시장 변동';

export interface AdminPriceUpdateResult {
  success: boolean;
  message: string;
}

export type MarketPriceMap = Record<string, number>;

export interface Transaction {
  id: string; // 거래 ID
  assetName: string; // 자산명
  /** 티커 심볼 (예: 000660, MU) */
  ticker?: string;
  type: 'BUY' | 'SELL'; // 거래 종류
  quantity: number; // 수량
  /** 거래 당시 단가 — 미국 주식 매수/매도(legacy): USD, 국내·매도(KRW저장): KRW */
  price: number;
  /** 미국 주식 단가 (USD) — 표시용 */
  priceUsd?: number;
  /** KRW 환산 총 거래금액 */
  totalAmount: number;
  /** 미국 주식 매수/매도 시 적용 환율 */
  exchangeRateAtPurchase?: number;
  /** 매도 시 평가 환율 (미국 주식) */
  exchangeRateAtSale?: number;
  /** @deprecated exchangeRateAtPurchase 와 동일 — 하위 호환 */
  exchangeRateAtTransaction?: number;
  /** KRW 환산 거래금액 (totalAmount와 동일 권장) */
  amountInKRW?: number;
  averagePriceAtSale?: number;
  averageExchangeRateAtSale?: number;
  transactionDate: string; // 거래 날짜 (YYYY-MM-DD)
  timestamp: any; // Firestore timestamp
  realizedProfit?: number; // 매도 실현 손익 (KRW)
  profitRate?: number; // 매도 수익률 (%)
}

/** logicalName: phase8TransactionHistory — 거래 상세 UI 한 줄 */
export interface TransactionDetailRow {
  label: string;
  value: string;
  valueClass?: string;
}

/** logicalName: phase8TransactionHistory — 메인 화면 탭 */
export type PortfolioMainTab = 'portfolio' | 'transactions' | 'settings';

export type TransactionFilterType = 'ALL' | 'BUY' | 'SELL';

export type TransactionPeriodFilter = 'ALL' | '1M' | '3M' | '1Y';

export interface TransactionMonthlyStat {
  monthKey: string;
  label: string;
  count: number;
}

/** logicalName: phase8TransactionHistory — 거래 통계 요약 */
export interface TransactionStats {
  totalCount: number;
  buyCount: number;
  sellCount: number;
  totalBuyAmountKrw: number;
  totalSellAmountKrw: number;
  totalRealizedProfitKrw: number;
  uniqueAssetCount: number;
  /** 매도 거래 profitRate 평균 (%) */
  averageProfitRate: number;
  monthlyBreakdown: TransactionMonthlyStat[];
}

export interface TransactionListFilters {
  type?: TransactionFilterType;
  assetName?: string;
  period?: TransactionPeriodFilter;
  searchQuery?: string;
  startDate?: Date;
  endDate?: Date;
}

/** logicalName: transactionHistoryPhase8 — 거래 이력 UI 필터 상태 */
export interface TransactionFilterState {
  type: TransactionFilterType;
  assetName: string;
  searchQuery: string;
  period: TransactionPeriodFilter;
  page: number;
  pageSize: number;
}

export interface Portfolio {
  nickname: string;
  assets: AssetItem[];
  /** 파킹통장 현금 */
  savings: number;
  /** USD/KRW 환율 (기본 1500) */
  exchangeRate?: number;
  lastExchangeRateUpdate?: any;
  /** 초기 자본 — 포트폴리오 생성 시 고정, 이후 변경 없음 */
  initialCapital?: number;
  /** 보유 자산 평가금액 합계 (현금 제외) */
  totalCurrentValue?: number;
  /** 미실현 손익 (KRW) — 보유 자산 평가 기준, 현금 변동 없음 */
  profitAmount?: number;
  /** 미실현 수익률 (%) — 매입금액 대비 */
  profitRate?: number;
  /** 현재 총자산 = savings + totalCurrentValue */
  totalAssets?: number;
  /** 전체 손익액 = totalAssets − initialCapital */
  totalProfitAmount?: number;
  /** 종합 실질 수익률 (%) */
  totalProfitRate?: number;
  /** 총 매입금액 (KRW) */
  totalPurchaseAmount?: number;
  hasRealPrices?: boolean;
  updatedAt: any;
  reason?: string;
  /** @deprecated 가용 예산 한도 — cumulativeRealizedProfit 기반 */
  totalBudget?: number;
  /** 매도로 확정된 누적 실현 손익 (KRW) */
  cumulativeRealizedProfit?: number;
  /** @deprecated profitAmount와 동일 — 하위 호환 */
  unrealizedProfitAmount?: number;
  transactions?: Transaction[];
}

export interface ValidationResult {
  isValid: boolean;
  assetName: string;
  ticker?: string;
  sector?: string;
  market?: string;
  confidence: number;
  message: string;
  apiError?: boolean;
}

export interface BuyRequest {
  assetId: string;
  assetName: string;
  quantity: number;
  /**
   * 주당 단가 — displayCurrency 단위.
   * USD: 미국 주식 USD 가격 (예: 479.78)
   * KRW: 국내 주식 원화 가격
   */
  pricePerUnit: number;
  /**
   * 총 매입금액 — 항상 KRW (현금 차감·Firestore 저장용).
   * USD 매수: pricePerUnit(USD) × quantity × 매수 시점 환율
   * KRW 매수: pricePerUnit × quantity
   */
  totalAmount: number;
  displayCurrency: 'USD' | 'KRW';
  ticker?: string;
  timestamp?: any;
}

export class BuyAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuyAssetError';
  }
}

export class SellAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SellAssetError';
  }
}

export interface SellAssetRequest {
  assetName: string;
  quantity: number;
  sellPriceKrw: number;
}

export interface SellAssetResult {
  assetName: string;
  quantity: number;
  sellPriceKrw: number;
  /** 매도 입금액 (KRW) — 현금 증가분 */
  sellAmount: number;
  cashInflow: number;
  purchasePriceKrw: number;
  purchaseAmount: number;
  realizedProfit: number;
  profitRate: number;
  previousSavings: number;
  newSavings: number;
  newCumulativeRealizedProfit: number;
  assets: AssetItem[];
  message: string;
}

/** logicalName: realtimePriceApiPhase6 */
export interface RealtimePriceQuote {
  name: string;
  canonicalName: string;
  priceKRW: number;
  source: string;
  sourceUrl: string;
  updatedAt: string;
  currency: 'KRW' | 'USD';
  usdPrice?: number;
  fromCache?: boolean;
}

export interface RealtimePriceSnapshot {
  success?: boolean;
  usdKrw: number;
  updatedAt: string | null;
  prices: Record<string, RealtimePriceQuote>;
}
