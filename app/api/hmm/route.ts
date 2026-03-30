import { NextRequest, NextResponse } from "next/server";
import { cachedHistorical } from "@/lib/yf-cache";
import { fitHmm, type HmmResult } from "@/lib/hmm";
import { withCacheHeaders } from "@/lib/cache-headers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase();
  const years = parseInt(req.nextUrl.searchParams.get("years") || "5", 10);
  const nStates = parseInt(req.nextUrl.searchParams.get("states") || "3", 10);

  if (!symbol) {
    return NextResponse.json({ error: "Symbol required" }, { status: 400 });
  }

  if (nStates < 2 || nStates > 3) {
    return NextResponse.json({ error: "States must be 2 or 3" }, { status: 400 });
  }

  try {
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);
    const period1 = startDate.toISOString().split("T")[0];

    const hist = await cachedHistorical(symbol, period1, "1d");

    if (!hist || hist.length < 60) {
      return NextResponse.json(
        { error: `Insufficient data for ${symbol} (need 60+ days, got ${hist?.length || 0})` },
        { status: 400 }
      );
    }

    type HistRow = { date: Date | string; close: number };
    const prices: number[] = [];
    const dates: string[] = [];

    for (const row of hist as HistRow[]) {
      const close = row.close;
      if (close && close > 0) {
        prices.push(close);
        const d = row.date instanceof Date ? row.date : new Date(row.date);
        dates.push(d.toISOString().split("T")[0]);
      }
    }

    if (prices.length < 60) {
      return NextResponse.json(
        { error: `Insufficient valid prices for ${symbol}` },
        { status: 400 }
      );
    }

    const result: HmmResult = fitHmm(prices, dates, nStates);

    // Thin data for transfer (keep every Nth point if > 1500 days)
    const thin = prices.length > 1500 ? Math.ceil(prices.length / 500) : 1;
    const thinned = {
      ...result,
      states: thin > 1 ? result.states.filter((_, i) => i % thin === 0) : result.states,
      prices: thin > 1 ? result.prices.filter((_, i) => i % thin === 0) : result.prices,
      dates: thin > 1 ? result.dates.filter((_, i) => i % thin === 0) : result.dates,
      backtest: {
        momentum: { ...result.backtest.momentum, equity: thin > 1 ? result.backtest.momentum.equity.filter((_, i) => i % thin === 0) : result.backtest.momentum.equity },
        meanrev: { ...result.backtest.meanrev, equity: thin > 1 ? result.backtest.meanrev.equity.filter((_, i) => i % thin === 0) : result.backtest.meanrev.equity },
        buyhold: { ...result.backtest.buyhold, equity: thin > 1 ? result.backtest.buyhold.equity.filter((_, i) => i % thin === 0) : result.backtest.buyhold.equity },
      },
      thin,
      totalDays: prices.length,
    };

    return withCacheHeaders(NextResponse.json(thinned), "long");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("HMM error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
