import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchAllLatest, fetchFinancialMetricsAsOf, type FinancialMetricAsOf, type WatchlistStock } from "@/lib/db";
import {
  buildWatsonPortfolio,
  computeWatsonHistory,
  DEFAULT_WATSON_CONFIG,
  type WatsonHistory,
} from "@/lib/gabriel-watson-portfolio";
import { cachedHistorical } from "@/lib/yf-cache";
import { fetchFmpIncomeAnnual, fetchFmpIncomeQuarterly, type FmpIncomeQ } from "@/lib/fmp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type MarketKey = "US" | "CHINA" | "HK" | "CN" | "ALL";

function yearsBeforeISO(anchor: Date, years: number): string {
  const d = new Date(anchor);
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().split("T")[0];
}

function addDaysISO(anchor: Date, days: number): string {
  const d = new Date(anchor);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function parseEndDate(value: unknown): { endDate?: string; period2?: string; anchor: Date } {
  if (typeof value !== "string" || value.trim() === "") {
    return { anchor: new Date() };
  }
  const raw = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error("endDate must use YYYY-MM-DD format");
  }
  const anchor = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(anchor.getTime())) {
    throw new Error("Invalid endDate");
  }
  return { endDate: raw, period2: addDaysISO(anchor, 1), anchor };
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

function isFiniteValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function hasWatsonFundamentals(s: WatchlistStock): boolean {
  return (
    isFiniteValue(s.market_cap) &&
    isFiniteValue(s.price) &&
    isFiniteValue(s.revenue_growth_recent_q) &&
    isFiniteValue(s.revenue_growth_ttm ?? s.revenue_growth_annual) &&
    isFiniteValue(s.revenue_cagr_3y ?? s.revenue_cagr_5y)
  );
}

interface RevenueGrowthAsOf {
  revenue_growth_ttm: number | null;
  revenue_cagr_3y: number | null;
  revenue_growth_recent_q: number | null;
}

function metricToRevenueGrowth(metric: FinancialMetricAsOf | undefined): RevenueGrowthAsOf | null {
  if (!metric) return null;
  if (
    !isFiniteValue(metric.revenue_growth_ttm) ||
    !isFiniteValue(metric.revenue_growth_recent_q) ||
    !isFiniteValue(metric.revenue_cagr_3y)
  ) {
    return null;
  }
  return {
    revenue_growth_ttm: Number(metric.revenue_growth_ttm),
    revenue_growth_recent_q: Number(metric.revenue_growth_recent_q),
    revenue_cagr_3y: Number(metric.revenue_cagr_3y),
  };
}

function sumRevenue(rows: FmpIncomeQ[]): number | null {
  if (rows.length < 4) return null;
  const vals = rows.map((row) => Number(row.revenue)).filter((v) => Number.isFinite(v));
  return vals.length >= 4 ? vals.reduce((sum, v) => sum + v, 0) : null;
}

function computeRevenueGrowthAsOf(
  annual: FmpIncomeQ[],
  quarterly: FmpIncomeQ[],
  anchor: Date
): RevenueGrowthAsOf | null {
  const asOf = anchor.getTime();
  const q = quarterly
    .filter((row) => row.date && new Date(`${row.date}T00:00:00Z`).getTime() <= asOf)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const a = annual
    .filter((row) => row.date && new Date(`${row.date}T00:00:00Z`).getTime() <= asOf)
    .sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());

  let revenueGrowthTtm: number | null = null;
  if (q.length >= 8) {
    const currentTtm = sumRevenue(q.slice(0, 4));
    const priorTtm = sumRevenue(q.slice(4, 8));
    if (currentTtm != null && priorTtm != null && priorTtm > 0) {
      revenueGrowthTtm = +(((currentTtm - priorTtm) / priorTtm) * 100).toFixed(1);
    }
  }

  let revenueGrowthRecentQ: number | null = null;
  if (q.length >= 5 && q[0].revenue && q[4].revenue && q[4].revenue > 0) {
    revenueGrowthRecentQ = +(((q[0].revenue - q[4].revenue) / q[4].revenue) * 100).toFixed(1);
  }

  let revenueCagr3y: number | null = null;
  if (a.length >= 4 && a[0].revenue && a[3].revenue && a[3].revenue > 0) {
    revenueCagr3y = +((Math.pow(a[0].revenue / a[3].revenue, 1 / 3) - 1) * 100).toFixed(1);
  }

  if (revenueGrowthTtm == null || revenueGrowthRecentQ == null || revenueCagr3y == null) {
    return null;
  }

  return {
    revenue_growth_ttm: revenueGrowthTtm,
    revenue_growth_recent_q: revenueGrowthRecentQ,
    revenue_cagr_3y: revenueCagr3y,
  };
}

async function fetchRevenueGrowthAsOf(stocks: WatchlistStock[], anchor: Date): Promise<Record<string, RevenueGrowthAsOf | null>> {
  const out: Record<string, RevenueGrowthAsOf | null> = {};
  const concurrency = 6;

  for (let i = 0; i < stocks.length; i += concurrency) {
    const batch = stocks.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (stock) => {
        try {
          const [quarterly, annual] = await Promise.all([
            fetchFmpIncomeQuarterly(stock.symbol, 16),
            fetchFmpIncomeAnnual(stock.symbol, 8),
          ]);
          return [stock.symbol, computeRevenueGrowthAsOf(annual, quarterly, anchor)] as const;
        } catch {
          return [stock.symbol, null] as const;
        }
      })
    );
    for (const [symbol, growth] of results) out[symbol] = growth;
  }

  return out;
}

async function loadRevenueGrowthAsOf(stocks: WatchlistStock[], asOfDate: string, anchor: Date): Promise<Record<string, RevenueGrowthAsOf | null>> {
  const symbols = stocks.map((s) => s.symbol);
  const dbMetrics = await fetchFinancialMetricsAsOf(symbols, asOfDate);
  const out: Record<string, RevenueGrowthAsOf | null> = {};
  const missing: WatchlistStock[] = [];

  for (const stock of stocks) {
    const metric = metricToRevenueGrowth(dbMetrics[stock.symbol]);
    if (metric) out[stock.symbol] = metric;
    else missing.push(stock);
  }

  if (missing.length > 0) {
    const fallback = await fetchRevenueGrowthAsOf(missing, anchor);
    for (const stock of missing) out[stock.symbol] = fallback[stock.symbol] ?? null;
  }

  return out;
}

function applyRevenueGrowthAsOf(
  stocks: WatchlistStock[],
  growthMap: Record<string, RevenueGrowthAsOf | null>
): WatchlistStock[] {
  return stocks.map((stock) => {
    const growth = growthMap[stock.symbol];
    return {
      ...stock,
      revenue_growth_ttm: growth?.revenue_growth_ttm ?? null,
      revenue_growth_recent_q: growth?.revenue_growth_recent_q ?? null,
      revenue_cagr_3y: growth?.revenue_cagr_3y ?? null,
      revenue_growth_annual: null,
      revenue_cagr_5y: null,
    } as unknown as WatchlistStock;
  });
}

async function fetchHistories(stocks: WatchlistStock[], anchor: Date, period2?: string): Promise<Record<string, WatsonHistory | null>> {
  const period1 = yearsBeforeISO(anchor, 2);
  const out: Record<string, WatsonHistory | null> = {};
  const concurrency = 8;

  for (let i = 0; i < stocks.length; i += concurrency) {
    const batch = stocks.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (stock) => {
        try {
          const rows = (await cachedHistorical(stock.symbol, period1, "1d", period2)) as Array<{
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
  let end;
  try {
    end = parseEndDate(body.endDate);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid endDate" },
      { status: 400 }
    );
  }

  const allStocks = await fetchAllLatest();
  const marketStocks = marketFilter(allStocks, market);
  const revenueAdjusted = end.endDate
    ? applyRevenueGrowthAsOf(marketStocks, await loadRevenueGrowthAsOf(marketStocks, end.endDate, end.anchor))
    : marketStocks;
  const filtered = revenueAdjusted.filter(hasWatsonFundamentals);
  const histories = await fetchHistories(filtered, end.anchor, end.period2);

  const result = buildWatsonPortfolio(filtered, histories, capital, { maxHoldings });
  return NextResponse.json({ ...result, asOf: end.endDate || result.asOf });
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
        endDate:
          "optional YYYY-MM-DD; price/volume and revenue growth windows end at this date. " +
          "Revenue growth is recomputed from historical income statements.",
      },
    },
  });
}
