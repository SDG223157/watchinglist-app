import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const YahooFinance = require("yahoo-finance2").default;
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

export const dynamic = "force-dynamic";

function computeTrendWise(
  closes: number[],
  dates: string[],
  window = 60
): { signal: string; entryDate: string | null; entryPrice: number | null } {
  if (closes.length < window + 1)
    return { signal: "No Signal", entryDate: null, entryPrice: null };

  const retracement: number[] = [];
  const position: number[] = [];

  for (let i = window; i < closes.length; i++) {
    const slice = closes.slice(i - window, i + 1);
    const high = Math.max(...slice);
    const low = Math.min(...slice);
    const range = high - low || 1;
    retracement.push(((high - closes[i]) / range) * 100);
    position.push(((closes[i] - low) / range) * 100);
  }

  let lastSignal: "Open" | "Closed" | null = null;
  let entryDate: string | null = null;
  let entryPrice: number | null = null;

  for (let i = 1; i < retracement.length; i++) {
    const prevPosBelowRet = position[i - 1] <= retracement[i - 1];
    const curPosAboveRet = position[i] > retracement[i];
    const prevPosAboveRet = position[i - 1] >= retracement[i - 1];
    const curPosBelowRet = position[i] < retracement[i];

    const dataIdx = window + i;
    if (prevPosBelowRet && curPosAboveRet) {
      lastSignal = "Open";
      entryDate = dates[dataIdx] || null;
      entryPrice = closes[dataIdx];
    } else if (prevPosAboveRet && curPosBelowRet) {
      lastSignal = "Closed";
      entryDate = null;
      entryPrice = null;
    }
  }

  return {
    signal: lastSignal || "No Signal",
    entryDate,
    entryPrice,
  };
}

function computeGeometricOrder(closes: number[]): {
  order: number;
  details: string;
} {
  if (closes.length < 200)
    return { order: 0, details: "insufficient data" };

  const ma200 =
    closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
  const latest = closes[closes.length - 1];
  const stdDev =
    Math.sqrt(
      closes.slice(-200).reduce((s, c) => s + (c - ma200) ** 2, 0) / 200
    ) || 1;
  const sigma = (latest - ma200) / stdDev;

  const recent60 = closes.slice(-60);
  const logReturns = recent60
    .slice(1)
    .map((c, i) => Math.log(c / recent60[i]));
  const slope =
    logReturns.length > 0
      ? logReturns.reduce((a, b) => a + b, 0) / logReturns.length
      : 0;

  const half = Math.floor(logReturns.length / 2);
  const firstHalf = logReturns.slice(0, half);
  const secondHalf = logReturns.slice(half);
  const avgFirst =
    firstHalf.length > 0
      ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
      : 0;
  const avgSecond =
    secondHalf.length > 0
      ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length
      : 0;
  const accelRatio = avgFirst !== 0 ? avgSecond / avgFirst : 1;

  const q1 = logReturns.slice(0, Math.floor(logReturns.length / 4));
  const q4 = logReturns.slice(Math.floor((3 * logReturns.length) / 4));
  const avgQ1 =
    q1.length > 0 ? q1.reduce((a, b) => a + b, 0) / q1.length : 0;
  const avgQ4 =
    q4.length > 0 ? q4.reduce((a, b) => a + b, 0) / q4.length : 0;
  const jerk = Math.abs(avgQ4 - avgQ1);

  let order = 0;
  if (Math.abs(sigma) > 1.5) order = 1;
  if (order === 1 && Math.abs(accelRatio) > 1.3) order = 2;
  if (order === 2 && jerk > 0.005) order = 3;

  const details = `sigma=${sigma.toFixed(2)} slope=${(slope * 252).toFixed(3)} accel=${accelRatio.toFixed(2)} jerk=${jerk.toFixed(4)}`;
  return { order, details };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const symbol = (body.symbol || "").trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json(
      { error: "Symbol is required" },
      { status: 400 }
    );
  }

  try {
    const [quote, summary] = await Promise.all([
      yahooFinance.quote(symbol),
      yahooFinance
        .quoteSummary(symbol, {
          modules: ["assetProfile", "defaultKeyStatistics", "financialData"],
        })
        .catch(() => null),
    ]);

    if (!quote || !quote.regularMarketPrice) {
      return NextResponse.json(
        { error: `No data found for ${symbol}` },
        { status: 404 }
      );
    }

    const profile = summary?.assetProfile || {};
    const keyStats = summary?.defaultKeyStatistics || {};
    const finData = summary?.financialData || {};

    let closes: number[] = [];
    let closeDates: string[] = [];
    try {
      const hist = await yahooFinance.historical(symbol, {
        period1: "2023-01-01",
        period2: new Date().toISOString().split("T")[0],
        interval: "1d",
      });
      closes = hist
        .map((q: { close?: number | null }) => q.close)
        .filter((c: number | null | undefined): c is number => c != null);
      closeDates = hist.map(
        (q: { date?: Date }) => q.date?.toISOString?.()?.split("T")[0] ?? ""
      );
    } catch {
      // historical data unavailable
    }
    const { order: geoOrder, details: geoDetails } =
      computeGeometricOrder(closes);
    const tw = computeTrendWise(closes, closeDates);

    const allTimeHigh =
      closes.length > 0 ? Math.max(...closes) : quote.fiftyTwoWeekHigh ?? 0;
    const distFromAth =
      allTimeHigh > 0
        ? `${(((quote.regularMarketPrice - allTimeHigh) / allTimeHigh) * 100).toFixed(1)}%`
        : null;

    const mcapB = quote.marketCap ? quote.marketCap / 1e9 : null;
    const sector = profile.sector || quote.sector || null;
    const industry = profile.industry || quote.industry || null;
    const beta = keyStats.beta ?? quote.beta ?? null;
    const pb = keyStats.priceToBook ?? quote.priceToBook ?? null;
    const roe = finData.returnOnEquity ? +(finData.returnOnEquity * 100).toFixed(1) : null;
    const opMargin = finData.operatingMargins ? +(finData.operatingMargins * 100).toFixed(1) : null;
    const netMargin = finData.profitMargins ? +(finData.profitMargins * 100).toFixed(1) : null;
    const de = finData.debtToEquity ?? null;
    const divYield = quote.dividendYield ? quote.dividendYield * 100 : null;

    const sql = getDb();
    await sql`
      INSERT INTO watchlist_items (
        symbol, name, market, sector, industry, price, market_cap,
        pe_ratio, price_to_book, dividend_yield,
        eps, beta, high_52w, low_52w, distance_from_ath,
        roe, operating_margin, net_margin, debt_to_equity,
        geometric_order, geometric_details,
        trend_signal, trend_entry_date, trend_entry_price,
        data_sources
      ) VALUES (
        ${symbol},
        ${quote.shortName || quote.longName || symbol},
        ${quote.market || "us_market"},
        ${sector},
        ${industry},
        ${quote.regularMarketPrice},
        ${mcapB},
        ${quote.trailingPE ?? null},
        ${pb},
        ${divYield},
        ${quote.epsTrailingTwelveMonths ?? null},
        ${beta},
        ${quote.fiftyTwoWeekHigh ?? null},
        ${quote.fiftyTwoWeekLow ?? null},
        ${distFromAth},
        ${roe},
        ${opMargin},
        ${netMargin},
        ${de},
        ${geoOrder},
        ${geoDetails},
        ${tw.signal},
        ${tw.entryDate},
        ${tw.entryPrice},
        ${"yahoo-finance2 (web)"}
      )
    `;

    return NextResponse.json({
      ok: true,
      symbol,
      name: quote.shortName || quote.longName || symbol,
      price: quote.regularMarketPrice,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("analyze error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
