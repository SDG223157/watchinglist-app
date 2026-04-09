/**
 * In-memory cache for Yahoo Finance data.
 * Prevents duplicate API calls when add-stock and analyze-report
 * run back-to-back for the same symbol.
 *
 * TTL: 1 hour for quotes, 6 hours for historical data.
 * Cache is per-process — resets on deploy/restart.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const YahooFinance = require("yahoo-finance2").default;
const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const quoteCache = new Map<string, CacheEntry<unknown>>();
const summaryCache = new Map<string, CacheEntry<unknown>>();
const histCache = new Map<string, CacheEntry<unknown[]>>();
const ftsCache = new Map<string, CacheEntry<unknown[]>>();

const QUOTE_TTL = 60 * 60 * 1000; // 1 hour
const HIST_TTL = 6 * 60 * 60 * 1000; // 6 hours

function isValid<T>(entry: CacheEntry<T> | undefined, ttl: number): entry is CacheEntry<T> {
  return !!entry && Date.now() - entry.ts < ttl;
}

export async function cachedQuote(symbol: string) {
  const key = symbol.toUpperCase();
  const cached = quoteCache.get(key);
  if (isValid(cached, QUOTE_TTL)) return cached.data;

  const data = await yahooFinance.quote(key);
  quoteCache.set(key, { data, ts: Date.now() });
  return data;
}

export async function cachedSummary(
  symbol: string,
  modules = ["assetProfile", "defaultKeyStatistics", "financialData"]
) {
  const key = `${symbol.toUpperCase()}:${modules.join(",")}`;
  const cached = summaryCache.get(key);
  if (isValid(cached, QUOTE_TTL)) return cached.data;

  try {
    const data = await yahooFinance.quoteSummary(symbol.toUpperCase(), { modules });
    summaryCache.set(key, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

export async function cachedHistorical(
  symbol: string,
  period1: string,
  interval: "1d" | "1wk" | "1mo" = "1d"
) {
  const key = `${symbol.toUpperCase()}:${period1}:${interval}`;
  const cached = histCache.get(key);
  if (isValid(cached, HIST_TTL)) return cached.data;

  try {
    const raw = await yahooFinance.historical(symbol.toUpperCase(), {
      period1,
      period2: new Date().toISOString().split("T")[0],
      interval,
    });
    const data = (raw || []).map((r: Record<string, unknown>) => ({
      ...r,
      close: r.close ?? r.adjClose ?? r.adjclose ?? null,
    }));
    histCache.set(key, { data, ts: Date.now() });
    return data;
  } catch {
    return [];
  }
}

export async function cachedFundamentals(symbol: string) {
  const key = symbol.toUpperCase();
  const cached = ftsCache.get(key);
  if (isValid(cached, QUOTE_TTL)) return cached.data;

  try {
    const data = await yahooFinance.fundamentalsTimeSeries(key, {
      period1: "2019-01-01",
      period2: new Date().toISOString().split("T")[0],
      type: "annual",
      module: "all",
    });
    ftsCache.set(key, { data: data || [], ts: Date.now() });
    return data || [];
  } catch {
    return [];
  }
}

export function invalidateSymbol(symbol: string) {
  const key = symbol.toUpperCase();
  for (const [k] of quoteCache) if (k.startsWith(key)) quoteCache.delete(k);
  for (const [k] of summaryCache) if (k.startsWith(key)) summaryCache.delete(k);
  for (const [k] of histCache) if (k.startsWith(key)) histCache.delete(k);
  for (const [k] of ftsCache) if (k.startsWith(key)) ftsCache.delete(k);
}

export { yahooFinance };
