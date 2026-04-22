import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchAllLatest } from "@/lib/db";
import { runRegime, classifyMarket, type RegimeResult } from "@/lib/regime";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type MarketKey = "us" | "hk" | "cn" | "all";

const cache = new Map<string, { data: RegimeResult; ts: number }>();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours — price data updates daily

const LABELS: Record<MarketKey, string> = {
  us: "US Watchlist",
  hk: "HK Watchlist",
  cn: "CN A-Share Watchlist",
  all: "Full Watchlist",
};

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const market = (url.searchParams.get("market") || "us").toLowerCase() as MarketKey;
  const forceRefresh = url.searchParams.get("refresh") === "1";
  const signal = Number(url.searchParams.get("signal") || 30);
  const horizon = Number(url.searchParams.get("horizon") || 30);
  const years = Number(url.searchParams.get("years") || 5);
  const topN = Number(url.searchParams.get("top") || 10);

  if (!["us", "hk", "cn", "all"].includes(market)) {
    return NextResponse.json({ error: "Invalid market" }, { status: 400 });
  }

  const cacheKey = `${market}|${signal}|${horizon}|${years}|${topN}`;
  if (!forceRefresh) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      return NextResponse.json({ ...hit.data, source: "memory" }, {
        headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" },
      });
    }
  }

  try {
    const stocks = await fetchAllLatest();
    const filtered = market === "all"
      ? stocks
      : stocks.filter((s) => classifyMarket(s.symbol) === market);
    const symbols = filtered.map((s) => s.symbol);

    if (symbols.length < 30) {
      return NextResponse.json({
        error: `Universe too small: ${symbols.length} stocks in market=${market}. Need >= 30.`,
      }, { status: 400 });
    }

    const data = await runRegime(symbols, {
      label: LABELS[market],
      years,
      signal,
      horizon,
      topN,
    });
    cache.set(cacheKey, { data, ts: Date.now() });
    return NextResponse.json({ ...data, source: "live" }, {
      headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[regime]", message);
    return NextResponse.json({ error: "Regime computation failed", detail: message.slice(0, 500) }, { status: 500 });
  }
}
