import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchAllLatest, type WatchlistStock } from "@/lib/db";
import {
  buildWatsonPortfolio,
  computeWatsonHistory,
  DEFAULT_WATSON_CONFIG,
  type WatsonHistory,
} from "@/lib/gabriel-watson-portfolio";
import { cachedHistorical } from "@/lib/yf-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type MarketKey = "US" | "CHINA" | "HK" | "CN" | "ALL";

function yearsAgoISO(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().split("T")[0];
}

function marketFilter(stocks: WatchlistStock[], market: MarketKey): WatchlistStock[] {
  return stocks.filter((s) => {
    if (market === "ALL") return true;
    if (market === "US") return !s.symbol.includes(".HK") && !s.symbol.includes(".SS") && !s.symbol.includes(".SZ");
    if (market === "HK") return s.symbol.includes(".HK");
    if (market === "CN") return s.symbol.includes(".SS") || s.symbol.includes(".SZ");
    if (market === "CHINA") return s.symbol.includes(".HK") || s.symbol.includes(".SS") || s.symbol.includes(".SZ");
    return true;
  });
}

function hasWatsonFundamentals(s: WatchlistStock): boolean {
  return (
    Number.isFinite(Number(s.market_cap)) &&
    Number.isFinite(Number(s.price)) &&
    Number.isFinite(Number(s.revenue_growth_recent_q)) &&
    Number.isFinite(Number(s.revenue_growth_ttm ?? s.revenue_growth_annual)) &&
    Number.isFinite(Number(s.revenue_cagr_3y ?? s.revenue_cagr_5y))
  );
}

async function fetchHistories(stocks: WatchlistStock[]): Promise<Record<string, WatsonHistory | null>> {
  const period1 = yearsAgoISO(2);
  const out: Record<string, WatsonHistory | null> = {};
  const concurrency = 8;

  for (let i = 0; i < stocks.length; i += concurrency) {
    const batch = stocks.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (stock) => {
        try {
          const rows = (await cachedHistorical(stock.symbol, period1, "1d")) as Array<{
            close?: number | null;
            volume?: number | null;
          }>;
          return [stock.symbol, computeWatsonHistory(stock, rows)] as const;
        } catch {
          return [stock.symbol, null] as const;
        }
      })
    );
    for (const [symbol, history] of results) out[symbol] = history;
  }

  return out;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const capital = Number(body.capital) || 1_000_000;
  const market = ((body.market as string) || "ALL").toUpperCase() as MarketKey;
  const maxHoldings = Number(body.maxHoldings) || DEFAULT_WATSON_CONFIG.maxHoldings;

  const allStocks = await fetchAllLatest();
  const filtered = marketFilter(allStocks, market).filter(hasWatsonFundamentals);
  const histories = await fetchHistories(filtered);

  const result = buildWatsonPortfolio(filtered, histories, capital, { maxHoldings });
  return NextResponse.json(result);
}

export async function GET() {
  return NextResponse.json({
    name: "watson-portfolio",
    description:
      "Gabriel Watson growth-momentum portfolio: revenue acceleration, price momentum, " +
      "volume turnover confirmation, then top trailing-Sharpe names equal-weighted.",
    usage: {
      method: "POST",
      body: {
        capital: "number (default: 1_000_000)",
        market: "US | CHINA | HK | CN | ALL (default: ALL)",
        maxHoldings: `number (default: ${DEFAULT_WATSON_CONFIG.maxHoldings})`,
      },
    },
  });
}
