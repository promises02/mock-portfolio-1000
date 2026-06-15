/** logicalName: realtimePriceApiPhase6 — 자산별 실시간 시세 조회 소스 매핑 */

export type PriceMarket = 'kr' | 'us' | 'crypto';

export interface AssetPriceConfig {
  canonicalName: string;
  aliases: string[];
  market: PriceMarket;
  yahooSymbol?: string;
  naverCode?: string;
  upbitMarket?: string;
  fallbackPriceKRW: number;
  sourceUrl: string;
}

function entry(
  canonicalName: string,
  market: PriceMarket,
  fallbackPriceKRW: number,
  sourceUrl: string,
  extras: Partial<Pick<AssetPriceConfig, 'yahooSymbol' | 'naverCode' | 'upbitMarket' | 'aliases'>> = {}
): AssetPriceConfig {
  return {
    canonicalName,
    aliases: extras.aliases ?? [],
    market,
    fallbackPriceKRW,
    sourceUrl,
    yahooSymbol: extras.yahooSymbol,
    naverCode: extras.naverCode,
    upbitMarket: extras.upbitMarket,
  };
}

export const ASSET_PRICE_REGISTRY: AssetPriceConfig[] = [
  entry('SK하이닉스', 'kr', 2150000, 'https://finance.naver.com/item/main.naver?code=000660', {
    naverCode: '000660',
    yahooSymbol: '000660.KS',
    aliases: ['sk하이닉스', 'skhynix', '하이닉스'],
  }),
  entry('삼성전자', 'kr', 322500, 'https://finance.naver.com/item/main.naver?code=005930', {
    naverCode: '005930',
    yahooSymbol: '005930.KS',
    aliases: ['samsung', '삼전', '삼성'],
  }),
  entry('현대차', 'kr', 607000, 'https://finance.naver.com/item/main.naver?code=005380', {
    naverCode: '005380',
    yahooSymbol: '005380.KS',
    aliases: ['hyundai'],
  }),
  entry('두산에너빌리티', 'kr', 106800, 'https://finance.naver.com/item/main.naver?code=034020', {
    naverCode: '034020',
    yahooSymbol: '034020.KS',
    aliases: ['doosan'],
  }),
  entry('LG화학', 'kr', 358000, 'https://finance.naver.com/item/main.naver?code=051910', {
    naverCode: '051910',
    yahooSymbol: '051910.KS',
  }),
  entry('NAVER', 'kr', 212000, 'https://finance.naver.com/item/main.naver?code=035420', {
    naverCode: '035420',
    yahooSymbol: '035420.KS',
  }),
  entry('카카오', 'kr', 45800, 'https://finance.naver.com/item/main.naver?code=035720', {
    naverCode: '035720',
    yahooSymbol: '035720.KS',
  }),
  entry('셀트리온', 'kr', 189500, 'https://finance.naver.com/item/main.naver?code=068270', {
    naverCode: '068270',
    yahooSymbol: '068270.KS',
  }),
  entry('TIGER 반도체TOP10', 'kr', 53000, 'https://finance.naver.com/item/main.naver?code=396500', {
    naverCode: '396500',
    yahooSymbol: '396500.KS',
    aliases: ['tiger반도체top10', 'tiger반도체탑10', 'tiger반도체'],
  }),
  entry('KODEX 미국S&P500', 'kr', 25420, 'https://finance.naver.com/item/main.naver?code=409820', {
    naverCode: '409820',
    yahooSymbol: '409820.KS',
    aliases: ['kodex미국s&p500'],
  }),
  entry('KODEX 미국나스닥100', 'kr', 29645, 'https://finance.naver.com/item/main.naver?code=309230', {
    naverCode: '309230',
    yahooSymbol: '309230.KS',
    aliases: ['kodex미국나스닥100'],
  }),
  entry('AMD', 'us', 767355, 'https://finance.yahoo.com/quote/AMD', {
    yahooSymbol: 'AMD',
  }),
  entry('알파벳 Class A', 'us', 539520, 'https://finance.yahoo.com/quote/GOOGL', {
    yahooSymbol: 'GOOGL',
    aliases: ['alphabet', '구글', 'google', '알파벳'],
  }),
  entry('아마존', 'us', 357825, 'https://finance.yahoo.com/quote/AMZN', {
    yahooSymbol: 'AMZN',
    aliases: ['amazon'],
  }),
  entry('애플', 'us', 436695, 'https://finance.yahoo.com/quote/AAPL', {
    yahooSymbol: 'AAPL',
    aliases: ['apple'],
  }),
  entry('브로드컴', 'us', 573105, 'https://finance.yahoo.com/quote/AVGO', {
    yahooSymbol: 'AVGO',
    aliases: ['broadcom'],
  }),
  entry('메타', 'us', 850470, 'https://finance.yahoo.com/quote/META', {
    yahooSymbol: 'META',
    aliases: ['meta'],
  }),
  entry('마이크로소프트', 'us', 586110, 'https://finance.yahoo.com/quote/MSFT', {
    yahooSymbol: 'MSFT',
    aliases: ['microsoft'],
  }),
  entry('마이크론', 'us', 1472415, 'https://finance.yahoo.com/quote/MU', {
    yahooSymbol: 'MU',
    aliases: ['micron'],
  }),
  entry('엔비디아', 'us', 307785, 'https://finance.yahoo.com/quote/NVDA', {
    yahooSymbol: 'NVDA',
    aliases: ['nvidia'],
  }),
  entry('팔란티어', 'us', 191985, 'https://finance.yahoo.com/quote/PLTR', {
    yahooSymbol: 'PLTR',
    aliases: ['palantir'],
  }),
  entry('SPY', 'us', 1112625, 'https://finance.yahoo.com/quote/SPY', { yahooSymbol: 'SPY' }),
  entry('SCHD', 'us', 49230, 'https://finance.yahoo.com/quote/SCHD', { yahooSymbol: 'SCHD' }),
  entry('시놉시스', 'us', 680835, 'https://finance.yahoo.com/quote/SNPS', {
    yahooSymbol: 'SNPS',
    aliases: ['synopsys'],
  }),
  entry('TSMC', 'us', 635895, 'https://finance.yahoo.com/quote/TSM', { yahooSymbol: 'TSM' }),
  entry('테슬라', 'us', 630000, 'https://finance.yahoo.com/quote/TSLA', {
    yahooSymbol: 'TSLA',
    aliases: ['tesla'],
  }),
  entry('VOO', 'us', 1022925, 'https://finance.yahoo.com/quote/VOO', { yahooSymbol: 'VOO' }),
  entry('ASML', 'us', 2795325, 'https://finance.yahoo.com/quote/ASML', { yahooSymbol: 'ASML' }),
  entry('GLD', 'us', 579810, 'https://finance.yahoo.com/quote/GLD', { yahooSymbol: 'GLD' }),
  entry('노키아 ADR', 'us', 22200, 'https://finance.yahoo.com/quote/NOK', {
    yahooSymbol: 'NOK',
    aliases: ['노키아adr', 'nokia'],
  }),
  entry('록히드마틴', 'us', 810495, 'https://finance.yahoo.com/quote/LMT', {
    yahooSymbol: 'LMT',
    aliases: ['lockheed'],
  }),
  entry('루멘텀 홀딩스', 'us', 1382340, 'https://finance.yahoo.com/quote/LITE', {
    yahooSymbol: 'LITE',
    aliases: ['루멘텀', 'lumentum'],
  }),
  entry('브룩필드', 'us', 67815, 'https://finance.yahoo.com/quote/BN', { yahooSymbol: 'BN' }),
  entry('스페이스 X', 'us', 160425, 'https://www.spacex.com', {
    aliases: ['spacex', '스페이스x', '스페이스X', 'space x'],
  }),
  entry('비트코인', 'crypto', 162000000, 'https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC', {
    upbitMarket: 'KRW-BTC',
    aliases: ['bitcoin', 'btc'],
  }),
  entry('금', 'kr', 114200, 'https://finance.naver.com/marketindex/goldDetail.naver', {
    aliases: ['gold', '실물금(gold)'],
  }),
];

export function normalizeAssetKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '').trim();
}

export function resolveAssetPriceConfig(name: string): AssetPriceConfig | null {
  const target = normalizeAssetKey(name);
  if (!target) return null;

  for (const config of ASSET_PRICE_REGISTRY) {
    const canonical = normalizeAssetKey(config.canonicalName);
    if (target === canonical || target.includes(canonical) || canonical.includes(target)) {
      return config;
    }
    for (const alias of config.aliases) {
      const aliasKey = normalizeAssetKey(alias);
      if (target === aliasKey || target.includes(aliasKey) || aliasKey.includes(target)) {
        return config;
      }
    }
  }

  return null;
}
