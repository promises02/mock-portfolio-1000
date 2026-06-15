import { AssetItem, AssetMarket, AssetType, DisplayCurrency } from './types';
import { getPresetByName } from './presets';

/**
 * Helper to format numeric values to Korean Won with commas.
 * Example: 10000000 -> "10,000,000"
 */
export function formatCommas(value: number): string {
  return new Intl.NumberFormat('ko-KR').format(value);
}

/** 관리자 시세 조정(admin marketPrices) 우선, 없으면 catalog/fallback */
export function resolveMarketPriceKRW(
  assetName: string,
  fallbackKrw: number,
  marketPrices?: Record<string, number>,
  catalogPrices?: import('./utils/portfolioPnL').CatalogPriceMap
): number {
  const trimmed = assetName.trim();
  const adminOverride = marketPrices?.[trimmed];
  if (adminOverride !== undefined && adminOverride > 0) {
    return Math.round(adminOverride);
  }

  const catalog = catalogPrices?.[trimmed];
  if (catalog?.priceKrw != null && catalog.priceKrw > 0) {
    return Math.round(catalog.priceKrw);
  }

  return Math.round(fallbackKrw);
}

/**
 * Format numeric values to Korean text abbreviations or full text.
 * Example: 10000000 -> "1,000만 원"
 * Example: 250000 -> "25만 원"
 */
export function formatKRW(value: number): string {
  if (value === 0) return '0원';
  
  if (value >= 10000) {
    const manValue = Math.floor(value / 10000);
    const remainder = value % 10000;
    
    if (remainder === 0) {
      return `${formatCommas(manValue)}만 원`;
    } else {
      return `${formatCommas(manValue)}만 ${formatCommas(remainder)}원`;
    }
  }
  
  return `${formatCommas(value)}원`;
}

export const DEFAULT_EXCHANGE_RATE = 1500;

function resolvePurchaseExchangeRateFromAsset(
  asset: AssetItem,
  currentExchangeRate: number
): number {
  if (asset.purchaseExchangeRate != null && asset.purchaseExchangeRate > 0) {
    return asset.purchaseExchangeRate;
  }
  const purchaseUsd = asset.purchasePriceUSD;
  if (purchaseUsd != null && purchaseUsd > 0 && asset.price > 0) {
    return Math.round(asset.price / purchaseUsd);
  }
  return currentExchangeRate > 0 ? currentExchangeRate : DEFAULT_EXCHANGE_RATE;
}

export function convertToKRW(priceUSD: number, exchangeRate: number): number {
  return priceUSD * exchangeRate;
}

function getCryptoSymbol(name: string): string {
  const norm = name.trim().toLowerCase();
  if (norm.includes('비트') || norm.includes('btc') || norm.includes('bitcoin')) return 'BTC';
  if (norm.includes('이더') || norm.includes('eth') || norm.includes('ethereum')) return 'ETH';
  return 'CRYPTO';
}

export function inferAssetMarketRegion(name: string, type: string): AssetMarket {
  const norm = name.trim().toLowerCase();
  if (
    type === 'crypto' ||
    norm.includes('비트코인') ||
    norm.includes('bitcoin') ||
    norm.includes('btc') ||
    norm.includes('이더') ||
    norm.includes('eth') ||
    norm.includes('코인')
  ) {
    return 'Crypto';
  }

  const group = inferAssetMarket(name, type);
  if (group === '미국 주식' || group === '부동산 및 리츠') {
    return 'US';
  }
  if (group === '암호화폐') {
    return 'Crypto';
  }
  return 'Korea';
}

export function getDefaultDisplayCurrency(market: AssetMarket): DisplayCurrency {
  if (market === 'US') return 'USD';
  if (market === 'Crypto') return 'CRYPTO';
  return 'KRW';
}

export function isCryptoMarketAsset(
  asset: Pick<AssetItem, 'name' | 'type' | 'market'>
): boolean {
  return (asset.market ?? inferAssetMarketRegion(asset.name, asset.type || 'stock')) === 'Crypto';
}

/** 암호화폐(비트코인 등) — 소수점 수량 매수·매도 허용 */
export function supportsFractionalQuantity(
  asset: Pick<AssetItem, 'name' | 'type' | 'market'>
): boolean {
  return isCryptoMarketAsset(asset);
}

export function roundFractionalQuantity(
  quantity: number,
  asset: Pick<AssetItem, 'name' | 'type' | 'market'>
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (supportsFractionalQuantity(asset)) {
    return Math.round(quantity * 1e8) / 1e8;
  }
  return Math.floor(quantity);
}

export function getQuantityUnitLabel(
  asset: Pick<AssetItem, 'name' | 'type' | 'market'>
): string {
  return supportsFractionalQuantity(asset) ? '개' : '주';
}

export function formatQuantityDisplay(
  quantity: number,
  asset: Pick<AssetItem, 'name' | 'type' | 'market'>
): string {
  if (supportsFractionalQuantity(asset)) {
    const rounded = roundFractionalQuantity(quantity, asset);
    return rounded.toFixed(8).replace(/\.?0+$/, '');
  }
  return String(Math.floor(quantity));
}

export function resolveDisplayCurrency(asset: AssetItem): DisplayCurrency {
  if (asset.displayCurrency) return asset.displayCurrency;
  const market = asset.market ?? inferAssetMarketRegion(asset.name, asset.type || 'stock');
  return getDefaultDisplayCurrency(market);
}

export function computeKrwEquivalent(
  displayCurrency: DisplayCurrency,
  value: number,
  exchangeRate: number
): number {
  if (displayCurrency === 'KRW') return Math.round(value);
  if (displayCurrency === 'USD') return Math.round(convertToKRW(value, exchangeRate));
  const btcUsd = 90_000;
  return Math.round(value * btcUsd * exchangeRate);
}

export function getDisplayPrice(
  asset: AssetItem,
  exchangeRate: number,
  options?: { priceKrw?: number; priceUsd?: number; priceCrypto?: string }
): string {
  const displayCurrency = resolveDisplayCurrency(asset);

  if (displayCurrency === 'USD') {
    const krw = Math.round(
      options?.priceKrw ??
        asset.priceKRW ??
        asset.price ??
        (options?.priceUsd != null
          ? convertToKRW(options.priceUsd, DEFAULT_EXCHANGE_RATE)
          : asset.priceUSD != null
            ? convertToKRW(asset.priceUSD, DEFAULT_EXCHANGE_RATE)
            : asset.purchasePriceUSD != null
              ? convertToKRW(asset.purchasePriceUSD, DEFAULT_EXCHANGE_RATE)
              : 0)
    );
    return `${formatCommas(krw)}원`;
  }

  if (displayCurrency === 'CRYPTO') {
    const cryptoStr =
      options?.priceCrypto ??
      asset.priceCrypto ??
      (options?.priceUsd ?? asset.priceUSD ?? asset.purchasePriceUSD)?.toString();
    if (cryptoStr) {
      return `${parseFloat(cryptoStr).toFixed(4)} ${getCryptoSymbol(asset.name)}`;
    }
    const preset = getPresetByName(asset.name.trim().toLowerCase());
    const fallback =
      preset?.price ??
      (exchangeRate > 0 ? (asset.priceKRW ?? asset.price) / exchangeRate / 90_000 : 0);
    return `${fallback.toFixed(4)} ${getCryptoSymbol(asset.name)}`;
  }

  const krwAmount = Math.round(
    options?.priceKrw ??
      asset.priceKRW ??
      asset.price ??
      (asset.priceUSD && exchangeRate > 0 ? convertToKRW(asset.priceUSD, exchangeRate) : 0)
  );
  return `${formatCommas(krwAmount)}원`;
}

export function getAssetYieldPercent(
  asset: AssetItem,
  currentPriceKrw: number,
  exchangeRate: number
): number {
  const market = asset.market ?? inferAssetMarketRegion(asset.name, asset.type || 'stock');

  if (market === 'US') {
    const purchaseKrw = asset.price > 0 ? asset.price : 0;
    if (purchaseKrw <= 0) return 0;
    return ((currentPriceKrw - purchaseKrw) / purchaseKrw) * 100;
  }

  if (asset.price <= 0) return 0;
  return ((currentPriceKrw - asset.price) / asset.price) * 100;
}

export function enrichAssetCurrencyFields(
  asset: Partial<AssetItem> & { name: string; type: AssetType; price: number },
  exchangeRate: number
): AssetItem {
  const preset = getPresetByName(asset.name.trim().toLowerCase());
  const market = asset.market ?? inferAssetMarketRegion(asset.name, asset.type);
  const marketGroup = asset.marketGroup ?? inferAssetMarket(asset.name, asset.type);
  const sector = asset.sector ?? inferAssetSector(asset.name, asset.type);
  const displayCurrency = asset.displayCurrency ?? getDefaultDisplayCurrency(market);

  let priceUSD = asset.priceUSD;
  let priceKRW = asset.priceKRW;
  let priceCrypto = asset.priceCrypto;
  let purchasePriceUSD = asset.purchasePriceUSD;
  let purchaseExchangeRate = asset.purchaseExchangeRate;
  let price = asset.price;

  if (displayCurrency === 'USD' && priceUSD != null) {
    purchasePriceUSD = purchasePriceUSD ?? priceUSD;
    purchaseExchangeRate = purchaseExchangeRate ?? exchangeRate;
    if (price <= 0) {
      price = Math.round(convertToKRW(priceUSD, purchaseExchangeRate));
    }
  } else if (displayCurrency === 'KRW' && priceKRW != null) {
    price = priceKRW;
  } else if (displayCurrency === 'CRYPTO' && priceCrypto != null) {
    price = computeKrwEquivalent('CRYPTO', parseFloat(priceCrypto), exchangeRate);
    priceUSD = priceUSD ?? parseFloat(priceCrypto);
    purchasePriceUSD = purchasePriceUSD ?? priceUSD;
  } else if (market === 'US' && preset && 'usdPrice' in preset && preset.usdPrice) {
    purchasePriceUSD = purchasePriceUSD ?? preset.usdPrice;
    priceUSD = priceUSD ?? preset.usdPrice;
    price = Math.round(convertToKRW(preset.usdPrice, exchangeRate));
  } else if (market === 'US' && exchangeRate > 0) {
    const usd = purchasePriceUSD ?? priceUSD ?? price / exchangeRate;
    purchasePriceUSD = purchasePriceUSD ?? usd;
    priceUSD = priceUSD ?? usd;
  } else if (market === 'Crypto') {
    priceUSD = priceUSD ?? 1;
    purchasePriceUSD = purchasePriceUSD ?? priceUSD;
  } else if (priceKRW != null) {
    price = priceKRW;
  }

  return {
    ...asset,
    market,
    marketGroup,
    sector,
    price,
    priceUSD,
    priceKRW,
    priceCrypto,
    purchasePriceUSD,
    purchaseExchangeRate,
    displayCurrency,
    quantity: asset.quantity ?? 0,
  } as AssetItem;
}

/**
 * Helper to check and validate if a string is a clean alphanumeric or Korean nickname.
 * Excludes characters that could cause database or path breaking.
 */
export function sanitizeNickname(name: string): string {
  return name.trim().slice(0, 30);
}

const SECTOR_SHADES: Record<string, string[]> = {
  ai: ['#1E3A8A', '#1E40AF', '#2563EB', '#3B82F6', '#60A5FA', '#0284C7', '#0369A1', '#38BDF8', '#4F46E5', '#6366F1'],
  bigtech: ['#4C1D95', '#5B21B6', '#6D28D9', '#7C3AED', '#8B5CF6', '#A78BFA', '#C084FC', '#D8B4FE'],
  us_index: ['#14532D', '#166534', '#15803D', '#1B6535', '#064E3B', '#0F766E', '#065F46', '#047857'],
  dividend: ['#65A30D', '#84CC16', '#A3E635', '#22C55E', '#10B981', '#34D399', '#4ADE80'],
  energy: ['#C2410C', '#D97706', '#EA580C', '#F97316', '#FB923C', '#F43F5E', '#E63946'],
  car: ['#991B1B', '#B91C1C', '#DC2626', '#EF4444', '#F87171', '#EE6055'],
  defense: ['#556B2F', '#6B8E23', '#808000', '#A3A375', '#BDB76B', '#78716C', '#A8A29E'],
  telecom: ['#0F766E', '#0D9488', '#14B8A6', '#0891B2', '#06B6D4', '#22D3EE'],
  infra: ['#451A03', '#78350F', '#9A3412', '#B45309', '#A16207', '#854D00'],
  gold: ['#B45309', '#D97706', '#EAB308', '#FACC15', '#FDE047'],
  bitcoin: ['#C2410C', '#D97706', '#F59E0B', '#F97316', '#F7931A', '#FF9F1C', '#EE9B00'],
  cash: ['#334155', '#475569', '#64748B', '#94A3B8', '#CBD5E1'],
  finance: ['#EC4899', '#DB2777', '#BE185D', '#F472B6', '#F43F5E', '#E11D48', '#FDA4AF', '#9D174D']
};

const KNOWN_ASSET_COLORS: Record<string, string> = {
  // 🧠 AI·반도체: 파란색 계열
  '삼성전자': '#1E40AF',        // Royal Deep Blue
  'sk하이닉스': '#3B82F6',       // Vibrant Blue
  'sk hynix': '#3B82F6',
  'tiger 반도체top10': '#4F46E5', // Indigo Blue
  '엔비디아': '#1D4ED8',        // Cobalt Blue
  'nvidia': '#1D4ED8',
  'amd': '#2563EB',             // Medium Blue
  '브로드컴': '#1E3A8A',          // Navy Blue
  'broadcom': '#1E3A8A',
  'tsmc': '#0284C7',            // Skies Blue
  'asml': '#38BDF8',            // Sky Light Blue
  '시놉시스': '#0369A1',          // Muted Ocean Blue
  'synopsys': '#0369A1',
  '마이크론': '#3730A3',           // Deep Indigo Blue
  'micron': '#3730A3',
  'mu': '#3730A3',

  // ☁️ 빅테크·플랫폼: 보라색 계열
  '알파벳 Class A': '#8B5CF6',   // Royal Violet
  '알파벳': '#8B5CF6',           // Royal Violet (legacy)
  'alphabet': '#8B5CF6',
  'google': '#8B5CF6',
  '아마존': '#A78BFA',           // Soft Lavender
  'amazon': '#A78BFA',
  '애플': '#6D28D9',             // Deep Purple
  'apple': '#6D28D9',
  '메타': '#7C3AED',             // Amethyst Purple
  'meta': '#7C3AED',
  '마이크로소프트': '#4C1D95',      // Blackberry purple
  'microsoft': '#4C1D95',
  '팔란티어': '#C084FC',          // Light Lavender
  'palantir': '#C084FC',

  // 📈 미국지수 ETF: 진한 초록 계열
  'kodex 미국s&p500': '#15803D',  // Forest Green
  'kodex 미국나스닥100': '#166534', // Deep Green
  'spy': '#065F46',             // Emerald Pine Green
  'voo': '#0F766E',             // Teal Forest Green
  'qqq': '#047857',             // Rich Emerald

  // 💰 배당 ETF: 연두색 계열
  'schd': '#84CC16',            // Lime Green
  'jepi': '#A3E635',            // Pastel Lime Green
  '배당': '#22C55E',            // Light Green

  // ⚡ 에너지·전력: 주황색 계열
  '두산에너빌리티': '#EA580C',     // Strong Orange
  '에너빌리티': '#EA580C',
  'nee': '#F97316',             // Radiant Orange
  'nextera': '#F97316',

  // 🚗 자동차: 빨간색 계열
  '현대차': '#DC2626',          // Dark Red
  'kia': '#B91C1C',             // Crimson Red
  'tesla': '#EF4444',           // Bright Red
  '테슬라': '#EF4444',

  // 🛡️ 방산: 카키/올리브 계열
  '록히드마틴': '#556B2F',        // Dark Olive Green
  'lockheed': '#556B2F',
  'lmt': '#556B2F',
  '방산': '#808000',            // Olive
  '한화에어로스페이스': '#6B8E23',   // Olive Drab

  // 🛰️ 통신: 청록색 계열
  '노키아 adr': '#06B6D4',        // Cyan
  'nokia': '#06B6D4',
  'skt': '#0D9488',             // Deep Teal
  'telecom': '#14B8A6',         // Light Mint

  // 🏢 인프라·자산운용: 갈색 계열
  '맥쿼리인프라': '#854D0E',       // Dark Brown
  '맥쿼리': '#854D0E',
  '자산운용': '#78350F',          // Deep Cocoa Brown

  // 💖 금융: 분홍색 계열
  '브룩필드': '#EC4899',          // Pink
  'brookfield': '#DB2777',

  // 🥇 금(GLD): 금색 계열
  'gld': '#EAB308',             // Shiny Gold
  'gold': '#FACC15',            // Light Gold
  '금': '#EAB308',

  // ₿ 비트코인: 비트코인 오렌지 계열
  '비트코인': '#F7931A',          // Bitcoin Orange
  'bitcoin': '#F7931A',
  'btc': '#F7931A',
  '이더리움': '#FF9F1C',          // Dark Amber Gold
  'ethereum': '#FF9F1C',
  'eth': '#FF9F1C',

  // 💵 현금: 회색 계열
  '파킹통장 예금 (현금)': '#64748B',  // Slate Gray
  '현금': '#475569',             // Charcoal Gray
  'cash': '#64748B',
  'parking savings': '#94A3B8',  // Light Slate Gray
};

const VIBRANT_PALETTE = [
  '#E63946', // Vibrant Crimson
  '#2EC4B6', // Pure Turquoise
  '#FF9F1C', // Amber Orange
  '#457B9D', // Medium Steel Blue
  '#00B4D8', // Sky Blue
  '#9B5DE5', // Grape Amethyst Purple
  '#F15BB5', // Hot Pink
  '#00F5D4', // Neon Cyan
  '#3A86C8', // Royal Indigo
  '#20BF55', // Kelly Green
  '#8338EC', // Electric Violet
  '#FF006E', // Rose Pink
  '#06D6A0', // Teal Green
  '#D90429', // Scarlet Red
  '#FF70A6', // Soft Violet Rose
  '#F4A261', // Peach Sand
  '#E76F51', // Terracotta Coral
  '#2A9D8F', // Dark Mint Teal
  '#7209B7', // Deep Plum
  '#3F37C9', // Navy Blue
  '#4CC9F0', // Ice Blue
];

/**
 * Returns a highly-visible, consistent, deterministic color based on the asset name.
 */
export function getAssetColor(name: string): string {
  const norm = name.trim().toLowerCase();

  if (KNOWN_ASSET_COLORS[norm]) {
    return KNOWN_ASSET_COLORS[norm];
  }

  // Fallback simple string hashing
  let hash = 0;
  for (let i = 0; i < norm.length; i++) {
    hash = norm.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash);

  // Sector keyword matching fallback to ensure any user-typed asset matches colors of requested groups
  if (norm.includes('삼성전자') || norm.includes('samsung') || norm.includes('하이닉스') || norm.includes('hynix') || norm.includes('반도체') || norm.includes('엔비디아') || norm.includes('nvidia') || norm.includes('amd') || norm.includes('broadcom') || norm.includes('tsmc') || norm.includes('asml') || norm.includes('synopsys') || norm.includes('시놉시스') || norm.includes('micron') || norm.includes('마이크론')) {
    return SECTOR_SHADES.ai[idx % SECTOR_SHADES.ai.length];
  }
  if (norm.includes('알파벳') || norm.includes('alphabet') || norm.includes('google') || norm.includes('구글') || norm.includes('아마존') || norm.includes('amazon') || norm.includes('애플') || norm.includes('apple') || norm.includes('메타') || norm.includes('meta') || norm.includes('마이크로소프트') || norm.includes('microsoft') || norm.includes('넷플릭스') || norm.includes('netflix') || norm.includes('팔란티어') || norm.includes('palantir')) {
    return SECTOR_SHADES.bigtech[idx % SECTOR_SHADES.bigtech.length];
  }
  if (norm.includes('s&p500') || norm.includes('spy') || norm.includes('voo') || norm.includes('qqq') || norm.includes('지수') || norm.includes('나스닥') || norm.includes('etf')) {
    return SECTOR_SHADES.us_index[idx % SECTOR_SHADES.us_index.length];
  }
  if (norm.includes('schd') || norm.includes('jepi') || norm.includes('배당') || norm.includes('dividend')) {
    return SECTOR_SHADES.dividend[idx % SECTOR_SHADES.dividend.length];
  }
  if (norm.includes('에너지') || norm.includes('전력') || norm.includes('energy') || norm.includes('원자력') || norm.includes('두산에너빌리티')) {
    return SECTOR_SHADES.energy[idx % SECTOR_SHADES.energy.length];
  }
  if (norm.includes('현대차') || norm.includes('기아') || norm.includes('kia') || norm.includes('tesla') || norm.includes('테슬라') || norm.includes('tsla') || norm.includes('자동차')) {
    return SECTOR_SHADES.car[idx % SECTOR_SHADES.car.length];
  }
  if (norm.includes('록히드마틴') || norm.includes('lockheed') || norm.includes('방산') || norm.includes('defense') || norm.includes('aerospace')) {
    return SECTOR_SHADES.defense[idx % SECTOR_SHADES.defense.length];
  }
  if (norm.includes('노키아') || norm.includes('nokia') || norm.includes('telecom') || norm.includes('통신') || norm.includes('skt') || norm.includes('텔레콤')) {
    return SECTOR_SHADES.telecom[idx % SECTOR_SHADES.telecom.length];
  }
  if (norm.includes('맥쿼리') || norm.includes('인프라') || norm.includes('자산운용')) {
    return SECTOR_SHADES.infra[idx % SECTOR_SHADES.infra.length];
  }
  if (norm.includes('브룩필드') || norm.includes('brookfield') || norm.includes('금융') || norm.includes('finance')) {
    return SECTOR_SHADES.finance[idx % SECTOR_SHADES.finance.length];
  }
  if (norm.includes('gld') || norm.includes('gold') || norm.includes('금')) {
    return SECTOR_SHADES.gold[idx % SECTOR_SHADES.gold.length];
  }
  if (norm.includes('비트코인') || norm.includes('bitcoin') || norm.includes('btc') || norm.includes('이더리움') || norm.includes('ethereum') || norm.includes('eth') || norm.includes('코인') || norm.includes('crypto')) {
    return SECTOR_SHADES.bitcoin[idx % SECTOR_SHADES.bitcoin.length];
  }
  if (norm.includes('현금') || norm.includes('cash') || norm.includes('파킹') || norm.includes('예금')) {
    return SECTOR_SHADES.cash[idx % SECTOR_SHADES.cash.length];
  }

  const index = Math.abs(hash) % VIBRANT_PALETTE.length;
  return VIBRANT_PALETTE[index];
}

/**
 * Infers the market classification / asset group based on asset name and type
 */
export function inferAssetMarket(name: string, type: string): string {
  const norm = name.trim().toLowerCase();
  
  if (norm.includes('현금') || norm.includes('cash') || norm.includes('파킹') || norm.includes('예금') || norm.includes('savings') || type === 'commodity' || norm.includes('gold') || norm.includes('gld') || norm.includes('금') || norm.includes('골드')) {
    return '현금 및 안전자산';
  }
  if (type === 'crypto' || norm.includes('비트코인') || norm.includes('이더리움') || norm.includes('bitcoin') || norm.includes('btc') || norm.includes('eth') || norm.includes('코인') || norm.includes('crypto')) {
    return '암호화폐';
  }
  if (norm.includes('맥쿼리') || norm.includes('리츠') || norm.includes('reit') || norm.includes('부동산') || norm.includes('인프라') || norm.includes('brookfield') || norm.includes('브룩필드')) {
    return '부동산 및 리츠';
  }

  // Identify US stocks/ETFs
  const usKeywords = [
    'amd', 'nvidia', '엔비디아', 'microsoft', '마이크로소프트', 'apple', '애플', 
    'alphabet', '알파벳', 'amazon', '아마존', 'meta', '메타', 'broadcom', '브로드컴', 
    'spy', 'voo', 'qqq', 'schd', 'jepi', 'tsmc', 'asml', 'palantir', '팔란티어', 
    'synopsys', '시놉시스', 'nokia', '노키아', 'lockheed', '록히드마틴', 'lumentum', '루멘텀',
    'tesla', '테슬라', 'tsla', 'micron', '마이크론'
  ];
  if (usKeywords.some(kw => norm.includes(kw))) {
    return '미국 주식';
  }

  // Domestic keywords
  const krKeywords = [
    '삼성전자', '하이닉스', 'hynix', '현대차', '기아', '두산에너빌리티', '에너빌리티',
    'tiger', 'kodex', '한화에어로', 'skt', '텔레콤'
  ];
  if (krKeywords.some(kw => norm.includes(kw))) {
    return '국내 주식';
  }

  // Fallback heuristics: if type is stock or etf
  if (type === 'stock' || type === 'etf' || type === 'fund') {
    if (/[a-zA-Z]/.test(name) || norm.includes('adr') || norm.includes('미국')) {
      return '미국 주식';
    }
    return '국내 주식';
  }

  return '기타';
}

/**
 * Infers the sector classification based on asset name and type
 */
export function inferAssetSector(name: string, type: string): string {
  const norm = name.trim().toLowerCase();

  if (norm.includes('현금') || norm.includes('cash') || norm.includes('파킹') || norm.includes('예금')) {
    return '현금';
  }
  if (norm.includes('삼성전자') || norm.includes('samsung') || norm.includes('하이닉스') || norm.includes('hynix') || norm.includes('반도체') || norm.includes('엔비디아') || norm.includes('nvidia') || norm.includes('amd') || norm.includes('broadcom') || norm.includes('tsmc') || norm.includes('asml') || norm.includes('synopsys') || norm.includes('시놉시스') || norm.includes('micron') || norm.includes('마이크론') || norm.includes('루멘텀') || norm.includes('lumentum')) {
    return '반도체';
  }
  if (norm.includes('알파벳') || norm.includes('alphabet') || norm.includes('google') || norm.includes('구글') || norm.includes('아마존') || norm.includes('amazon') || norm.includes('애플') || norm.includes('apple') || norm.includes('메타') || norm.includes('meta') || norm.includes('마이크로소프트') || norm.includes('microsoft') || norm.includes('넷플릭스') || norm.includes('netflix') || norm.includes('팔란티어') || norm.includes('palantir')) {
    return '정보기술(IT)';
  }
  if (norm.includes('현대차') || norm.includes('기아') || norm.includes('kia') || norm.includes('tesla') || norm.includes('테슬라') || norm.includes('tsla') || norm.includes('자동차')) {
    return '자동차';
  }
  if (norm.includes('브룩필드') || norm.includes('brookfield') || norm.includes('금융') || norm.includes('finance') || norm.includes('은행') || norm.includes('증권') || norm.includes('보험')) {
    return '금융';
  }
  if (norm.includes('gld') || norm.includes('gold') || norm.includes('금') || norm.includes('원자재') || norm.includes('commodity') || norm.includes('골드')) {
    return '원자재';
  }
  if (norm.includes('에너지') || norm.includes('전력') || norm.includes('energy') || norm.includes('원자력') || norm.includes('두산에너빌리티')) {
    return '에너지·전력';
  }
  if (norm.includes('록히드마틴') || norm.includes('lockheed') || norm.includes('방산') || norm.includes('defense') || norm.includes('aerospace')) {
    return '방산';
  }
  if (norm.includes('노키아') || norm.includes('nokia') || norm.includes('telecom') || norm.includes('통신') || norm.includes('skt') || norm.includes('텔레콤')) {
    return '통신';
  }
  if (norm.includes('맥쿼리') || norm.includes('인프라') || norm.includes('리츠') || norm.includes('reits') || norm.includes('부동산')) {
    return '부동산·인프라';
  }
  if (norm.includes('비트코인') || norm.includes('bitcoin') || norm.includes('btc') || norm.includes('이더리움') || norm.includes('ethereum') || norm.includes('eth') || norm.includes('코인') || norm.includes('crypto')) {
    return '암호화폐';
  }
  if (norm.includes('schd') || norm.includes('jepi') || norm.includes('배당') || norm.includes('dividend')) {
    return '배당 ETF';
  }
  if (
    norm.includes('qqq') ||
    norm.includes('나스닥100') ||
    norm.includes('spy') ||
    norm.includes('voo') ||
    norm.includes('s&p500') ||
    norm.includes('지수')
  ) {
    return '미국자수 ETF';
  }

  // Broad fallbacks by type
  if (type === 'crypto') return '암호화폐';
  if (type === 'commodity') return '원자재';

  return '기타';
}

/** 차트·UI용 — 이름 기반 추론 우선 (Firestore에 저장된 잘못된 sector 보정) */
export function resolveAssetSector(
  asset: Pick<AssetItem, 'name' | 'type' | 'sector'>
): string {
  const inferred = inferAssetSector(asset.name, asset.type || 'stock');
  if (inferred !== '기타') return inferred;
  return asset.sector?.trim() || '기타';
}

/** 차트·UI용 — 이름 기반 추론 우선 */
export function resolveAssetMarketGroup(
  asset: Pick<AssetItem, 'name' | 'type' | 'marketGroup'>
): string {
  const inferred = inferAssetMarket(asset.name, asset.type || 'stock');
  if (inferred !== '기타') return inferred;
  return asset.marketGroup?.trim() || '기타';
}
