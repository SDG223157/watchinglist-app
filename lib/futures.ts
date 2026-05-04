/**
 * Futures data layer.
 *
 * - Proxies the Aktools FastAPI backend (AKShare / Sina Finance)
 * - CRUD for the futures_watchlist table
 * - In-memory cache with TTL (same pattern as lib/fmp.ts)
 */

import { neon } from "@neondatabase/serverless";
import { unstable_cache } from "next/cache";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const AKTOOLS_BASE =
  process.env.AKTOOLS_URL || "http://localhost:8888";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FuturesVariety {
  code: string;
  name: string;
  exchange: string;
  multiplier: number;
  price: number | null;
}

export interface KlineBar {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FuturesWatchlistItem {
  id: number;
  user_email: string;
  variety_code: string;
  variety_name: string;
  exchange: string;
  multiplier: number | null;
  latest_price: number | null;
  price_change_pct: number | null;
  notes: string;
  analysis_report: string | null;
  analysis_date: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// In-memory cache (same pattern as lib/fmp.ts)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const varietiesCache = new Map<string, CacheEntry<unknown>>();
const klineCache = new Map<string, CacheEntry<unknown>>();

const VARIETIES_TTL = 30 * 60 * 1000; // 30 min
const KLINE_TTL = 5 * 60 * 1000; // 5 min

function cached<T>(map: Map<string, CacheEntry<unknown>>, key: string, ttl: number): T | null {
  const e = map.get(key);
  if (e && Date.now() - e.ts < ttl) return e.data as T;
  return null;
}

function store<T>(map: Map<string, CacheEntry<unknown>>, key: string, data: T): T {
  map.set(key, { data, ts: Date.now() });
  return data;
}

// ---------------------------------------------------------------------------
// FastAPI proxy helpers
// ---------------------------------------------------------------------------

async function aktoolsGet<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const qs = new URLSearchParams(params);
  const url = `${AKTOOLS_BASE}${path}${qs.toString() ? "?" + qs : ""}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Varieties
// ---------------------------------------------------------------------------

export async function fetchVarieties(): Promise<Record<string, FuturesVariety[]> | null> {
  const hit = cached<Record<string, FuturesVariety[]>>(varietiesCache, "all", VARIETIES_TTL);
  if (hit) return hit;

  const data = await aktoolsGet<Record<string, FuturesVariety[]>>("/api/varieties");
  if (!data) return null;
  return store(varietiesCache, "all", data);
}

export async function fetchAllVarietiesFlat(): Promise<FuturesVariety[]> {
  const grouped = await fetchVarieties();
  if (!grouped) return [];
  const flat: FuturesVariety[] = [];
  for (const [exchange, items] of Object.entries(grouped)) {
    for (const v of items) {
      flat.push({ ...v, exchange });
    }
  }
  return flat.sort((a, b) => a.code.localeCompare(b.code));
}

export async function searchVarieties(query: string): Promise<FuturesVariety[]> {
  const all = await fetchAllVarietiesFlat();
  if (!query.trim()) return all.slice(0, 20);
  const q = query.toLowerCase();
  return all
    .filter((v) => v.code.toLowerCase().includes(q) || v.name.toLowerCase().includes(q))
    .slice(0, 15);
}

// ---------------------------------------------------------------------------
// K-line
// ---------------------------------------------------------------------------

export async function fetchKline(
  symbol: string,
  startDate = "20240101",
  endDate = "20261231",
  period = "daily"
): Promise<KlineBar[]> {
  const key = `${symbol}:${startDate}:${endDate}:${period}`;
  const hit = cached<KlineBar[]>(klineCache, key, KLINE_TTL);
  if (hit) return hit;

  const data = await aktoolsGet<KlineBar[]>("/api/kline", {
    symbol,
    start_date: startDate,
    end_date: endDate,
    period,
  });
  if (!data || !Array.isArray(data)) return [];
  return store(klineCache, key, data);
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

export async function getFuturesWatchlist(
  userEmail: string
): Promise<FuturesWatchlistItem[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM futures_watchlist
    WHERE user_email = ${userEmail}
    ORDER BY exchange, variety_code
  `;
  return rows as unknown as FuturesWatchlistItem[];
}

export async function addToFuturesWatchlist(
  userEmail: string,
  variety: FuturesVariety
): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO futures_watchlist (user_email, variety_code, variety_name, exchange, multiplier, latest_price)
    VALUES (${userEmail}, ${variety.code}, ${variety.name}, ${variety.exchange}, ${variety.multiplier}, ${variety.price})
    ON CONFLICT (user_email, variety_code) DO UPDATE SET
      variety_name = EXCLUDED.variety_name,
      exchange = EXCLUDED.exchange,
      multiplier = EXCLUDED.multiplier,
      latest_price = EXCLUDED.latest_price,
      updated_at = NOW()
  `;
}

export async function removeFromFuturesWatchlist(
  userEmail: string,
  varietyCode: string
): Promise<void> {
  const sql = getDb();
  await sql`
    DELETE FROM futures_watchlist
    WHERE user_email = ${userEmail} AND variety_code = ${varietyCode}
  `;
}

export async function updateFuturesAnalysis(
  userEmail: string,
  varietyCode: string,
  report: string
): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE futures_watchlist
    SET analysis_report = ${report}, analysis_date = NOW(), updated_at = NOW()
    WHERE user_email = ${userEmail} AND variety_code = ${varietyCode}
  `;
}

export async function getFuturesAnalysis(
  userEmail: string,
  varietyCode: string
): Promise<FuturesWatchlistItem | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM futures_watchlist
    WHERE user_email = ${userEmail} AND variety_code = ${varietyCode}
    LIMIT 1
  `;
  return (rows[0] as unknown as FuturesWatchlistItem) ?? null;
}

// ---------------------------------------------------------------------------
// Cached wrapper for pages (same pattern as getCachedStocks in lib/db.ts)
// ---------------------------------------------------------------------------

export const getCachedFuturesWatchlist = (userEmail: string) =>
  unstable_cache(
    async () => getFuturesWatchlist(userEmail),
    [`futures-watchlist-${userEmail}`],
    { revalidate: 60, tags: ["futures"] }
  )();
