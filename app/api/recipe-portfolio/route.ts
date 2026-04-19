import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchAllLatest, type WatchlistStock } from "@/lib/db";
import {
  buildRecipeAllocation,
  marketFilter,
  type RecipeAllocation,
} from "@/lib/recipe-portfolio";
import { cachedHistorical } from "@/lib/yf-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type MarketKey = "US" | "CHINA" | "HK" | "CN" | "ALL";

function yearsAgoISO(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().split("T")[0];
}

/**
 * Fetch ~2y daily closes in parallel, with per-symbol error tolerance.
 * Returns a map of symbol -> array of closes (oldest first).
 */
async function fetchPriceHistory(
  symbols: string[]
): Promise<Record<string, number[]>> {
  const period1 = yearsAgoISO(2);
  const results: Record<string, number[]> = {};
  const concurrency = 8;
  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    const fetched = await Promise.all(
      batch.map(async (sym) => {
        try {
          const rows = (await cachedHistorical(sym, period1, "1d")) as Array<{
            close: number | null;
          }>;
          const closes = (rows || [])
            .map((r) => (r && r.close != null ? Number(r.close) : NaN))
            .filter((v) => Number.isFinite(v) && v > 0);
          return [sym, closes] as const;
        } catch {
          return [sym, [] as number[]] as const;
        }
      })
    );
    for (const [sym, closes] of fetched) {
      if (closes.length > 0) results[sym] = closes;
    }
  }
  return results;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const market = ((body.market as string) || "US").toUpperCase() as MarketKey;
  const topN = Number(body.topN) || 30;
  const capital = Number(body.capital) || 1_000_000;
  const previousHoldings = Array.isArray(body.previousHoldings)
    ? (body.previousHoldings as Array<{
        ticker: string;
        weight: number;
        trailing60d?: number;
      }>)
    : undefined;

  // 1. Pull watchlist universe and filter by market
  const all = await fetchAllLatest();
  const filteredByMarket = marketFilter(all, market);
  const actionable: WatchlistStock[] = filteredByMarket.filter((s) => {
    const a = (s.action || "").toLowerCase();
    return (
      (a.startsWith("left-side") || a.startsWith("right-side")) &&
      Number(s.composite_score || 0) >= 50
    );
  });

  if (actionable.length < 5) {
    return NextResponse.json({
      asOf: new Date().toISOString().slice(0, 10),
      market,
      universeSize: actionable.length,
      topN,
      invested: 0,
      cashReserve: 1,
      leaderThreshold: 0,
      positions: [],
      sectorSummary: [],
      tierSummary: [],
      rotation: null,
      error: `Only ${actionable.length} actionable names in ${market}.`,
    });
  }

  // 2. Pull 2Y daily history (cached)
  const priceHistory = await fetchPriceHistory(actionable.map((s) => s.symbol));

  // 3. Run the engine
  const allocation: RecipeAllocation = buildRecipeAllocation({
    stocks: actionable,
    priceHistory,
    market,
    topN,
    previousHoldings,
  });

  // 4. Attach dollar amounts
  const positionsWithDollars = allocation.positions.map((p) => {
    const stock = actionable.find((s) => s.symbol === p.ticker);
    const price = Number(stock?.price || 0);
    const amount = p.weight * capital;
    const shares = price > 0 ? Math.floor(amount / price) : 0;
    return { ...p, price, amount, shares };
  });

  return NextResponse.json({
    ...allocation,
    capital,
    positions: positionsWithDollars,
  });
}

export async function GET() {
  return NextResponse.json({
    name: "recipe-portfolio",
    description:
      "Bayesian prior + Transfer Entropy + vector Kelly allocation over the " +
      "actionable watchlist, partitioned by market (US / CHINA / HK / CN / ALL).",
    usage: {
      method: "POST",
      body: {
        market: "US | CHINA | HK | CN | ALL (default: US)",
        topN: "number (default: 30)",
        capital: "number (default: 1_000_000)",
        previousHoldings:
          "Array<{ticker, weight, trailing60d?}> — for rotation diff",
      },
    },
  });
}
