/** logicalName: realtimePriceApiPhase6 */
import axios from 'axios';
import {
  ASSET_PRICE_REGISTRY,
  AssetPriceConfig,
  resolveAssetPriceConfig,
} from './assetPriceRegistry';

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
  usdKrw: number;
  updatedAt: string | null;
  prices: Record<string, RealtimePriceQuote>;
}

const HTTP_HEADERS = {
  'User-Agent': 'Invest10M-RealtimePrice/1.0',
  Accept: 'application/json',
};

const priceCache = new Map<string, RealtimePriceQuote>();
let usdKrwRate = 1500;
let lastRefreshAt: string | null = null;
let refreshInFlight: Promise<void> | null = null;

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

async function fetchUsdKrwRate(): Promise<number> {
  try {
    const { data } = await axios.get('https://open.er-api.com/v6/latest/USD', {
      timeout: 8000,
      headers: HTTP_HEADERS,
    });
    const rate = parseNumeric(data?.rates?.KRW);
    if (rate) return Math.round(rate);
  } catch (error) {
    console.warn('[realtimePrice] USD/KRW fetch failed:', error instanceof Error ? error.message : error);
  }
  return usdKrwRate || 1500;
}

async function fetchYahooPrice(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const { data } = await axios.get(url, { timeout: 10000, headers: HTTP_HEADERS });
    const meta = data?.chart?.result?.[0]?.meta;
    return parseNumeric(meta?.regularMarketPrice ?? meta?.previousClose);
  } catch (error) {
    console.warn(`[realtimePrice] Yahoo fetch failed (${symbol}):`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function fetchNaverKrPrice(code: string): Promise<number | null> {
  try {
    const url = `https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`;
    const { data } = await axios.get(url, { timeout: 10000, headers: HTTP_HEADERS });
    const row = data?.datas?.[0];
    return parseNumeric(row?.closePrice ?? row?.openPrice ?? row?.nowVal);
  } catch (error) {
    console.warn(`[realtimePrice] Naver fetch failed (${code}):`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function fetchUpbitPrice(market: string): Promise<number | null> {
  try {
    const url = `https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(market)}`;
    const { data } = await axios.get(url, { timeout: 10000, headers: HTTP_HEADERS });
    return parseNumeric(data?.[0]?.trade_price);
  } catch (error) {
    console.warn(`[realtimePrice] Upbit fetch failed (${market}):`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function fetchQuoteForConfig(
  config: AssetPriceConfig,
  requestedName: string,
  usdKrw: number
): Promise<RealtimePriceQuote> {
  const now = new Date().toISOString();
  let priceKRW = config.fallbackPriceKRW;
  let source = 'fallback';
  let currency: 'KRW' | 'USD' = 'KRW';
  let usdPrice: number | undefined;

  if (config.market === 'crypto' && config.upbitMarket) {
    const upbitPrice = await fetchUpbitPrice(config.upbitMarket);
    if (upbitPrice) {
      priceKRW = Math.round(upbitPrice);
      source = 'upbit';
    }
  } else if (config.market === 'kr') {
    let krPrice: number | null = null;
    if (config.naverCode) {
      krPrice = await fetchNaverKrPrice(config.naverCode);
      if (krPrice) source = 'naver';
    }
    if (!krPrice && config.yahooSymbol) {
      krPrice = await fetchYahooPrice(config.yahooSymbol);
      if (krPrice) source = 'yahoo_kr';
    }
    if (krPrice) priceKRW = Math.round(krPrice);
  } else if (config.market === 'us' && config.yahooSymbol) {
    const usPrice = await fetchYahooPrice(config.yahooSymbol);
    if (usPrice) {
      usdPrice = usPrice;
      priceKRW = Math.round(usPrice * usdKrw);
      source = 'yahoo_us';
      currency = 'USD';
    }
  }

  return {
    name: requestedName,
    canonicalName: config.canonicalName,
    priceKRW,
    source,
    sourceUrl: config.sourceUrl,
    updatedAt: now,
    currency,
    ...(usdPrice != null ? { usdPrice } : {}),
  };
}

function cacheQuote(quote: RealtimePriceQuote): void {
  priceCache.set(normalizeCacheKey(quote.name), quote);
  priceCache.set(normalizeCacheKey(quote.canonicalName), quote);
}

function normalizeCacheKey(name: string): string {
  return name.trim().toLowerCase();
}

export function getCachedQuote(name: string): RealtimePriceQuote | null {
  return priceCache.get(normalizeCacheKey(name)) ?? null;
}

export function getPriceSnapshot(): RealtimePriceSnapshot {
  const unique = new Map<string, RealtimePriceQuote>();
  for (const quote of priceCache.values()) {
    unique.set(quote.canonicalName, quote);
  }
  return {
    usdKrw: usdKrwRate,
    updatedAt: lastRefreshAt,
    prices: Object.fromEntries(unique.entries()),
  };
}

export async function refreshTrackedAssetPrices(
  assetNames?: string[]
): Promise<RealtimePriceSnapshot> {
  if (refreshInFlight) {
    await refreshInFlight;
    return getPriceSnapshot();
  }

  refreshInFlight = (async () => {
    usdKrwRate = await fetchUsdKrwRate();

    const configsToRefresh: Array<{ config: AssetPriceConfig; requestedName: string }> = [];

    if (assetNames && assetNames.length > 0) {
      for (const rawName of assetNames) {
        const config = resolveAssetPriceConfig(rawName);
        if (config) {
          configsToRefresh.push({ config, requestedName: rawName.trim() });
        }
      }
    } else {
      for (const config of ASSET_PRICE_REGISTRY) {
        configsToRefresh.push({ config, requestedName: config.canonicalName });
      }
    }

    const seen = new Set<string>();
    for (const item of configsToRefresh) {
      const key = item.config.canonicalName;
      if (seen.has(key)) continue;
      seen.add(key);

      const quote = await fetchQuoteForConfig(item.config, item.requestedName, usdKrwRate);
      cacheQuote(quote);
    }

    lastRefreshAt = new Date().toISOString();
    console.info(
      `[realtimePrice] refreshed ${seen.size} assets (USD/KRW=${usdKrwRate}) at ${lastRefreshAt}`
    );
  })();

  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }

  return getPriceSnapshot();
}

export async function getRealtimeQuotesForAssets(
  assetNames: string[],
  options?: { forceRefresh?: boolean }
): Promise<RealtimePriceQuote[]> {
  const uniqueNames = Array.from(new Set(assetNames.map((n) => n.trim()).filter(Boolean)));
  const stale =
    !lastRefreshAt || Date.now() - new Date(lastRefreshAt).getTime() > 10 * 60 * 1000;

  const missing = uniqueNames.filter((name) => !getCachedQuote(name));
  if (options?.forceRefresh || stale || missing.length > 0) {
    await refreshTrackedAssetPrices(uniqueNames.length > 0 ? uniqueNames : undefined);
  }

  return uniqueNames.map((name) => {
    const cached = getCachedQuote(name);
    if (cached) return { ...cached, fromCache: true };

    const config = resolveAssetPriceConfig(name);
    if (!config) {
      return {
        name,
        canonicalName: name,
        priceKRW: 0,
        source: 'unknown',
        sourceUrl: '',
        updatedAt: new Date().toISOString(),
        currency: 'KRW' as const,
      };
    }

    return {
      name,
      canonicalName: config.canonicalName,
      priceKRW: config.fallbackPriceKRW,
      source: 'fallback',
      sourceUrl: config.sourceUrl,
      updatedAt: new Date().toISOString(),
      currency: 'KRW' as const,
      fromCache: true,
    };
  });
}

/** /api/fetch-prices 호환 형식으로 변환 */
export function toLegacyFetchPriceResults(
  quotes: RealtimePriceQuote[],
  assets: Array<{ name: string; price?: number }>
): Array<{
  name: string;
  buyPrice: number;
  actualPrice: number;
  sourceUrl: string;
  searchReasoning: string;
}> {
  return assets.map((asset) => {
    const quote =
      quotes.find((q) => normalizeCacheKey(q.name) === normalizeCacheKey(asset.name)) ??
      quotes.find((q) => normalizeCacheKey(q.canonicalName) === normalizeCacheKey(asset.name));

    const buyPrice = Number(asset.price) || 0;
    if (!quote || quote.priceKRW <= 0) {
      return {
        name: asset.name,
        buyPrice,
        actualPrice: buyPrice,
        sourceUrl: '',
        searchReasoning: '실시간 API 매핑 없음 — 매수가 기준 적용',
      };
    }

    const sourceLabel =
      quote.source === 'upbit'
        ? 'Upbit'
        : quote.source === 'naver'
          ? 'Naver Finance'
          : quote.source === 'yahoo_us'
            ? 'Yahoo Finance (USD→KRW)'
            : quote.source === 'yahoo_kr'
              ? 'Yahoo Finance (KRX)'
              : '백업 시세';

    return {
      name: asset.name,
      buyPrice,
      actualPrice: quote.priceKRW,
      sourceUrl: quote.sourceUrl,
      searchReasoning: `${sourceLabel} 실시간 API 연동 (${quote.updatedAt})`,
    };
  });
}
