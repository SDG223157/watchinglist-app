import { NextRequest, NextResponse } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb, fetchStock } from "@/lib/db";
import { cachedQuote, cachedSummary, cachedHistorical, cachedFundamentals } from "@/lib/yf-cache";
import { computeCompositeScore } from "@/lib/composite-score";

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
    const [quote, summary, fts] = await Promise.all([
      cachedQuote(symbol),
      cachedSummary(symbol),
      cachedFundamentals(symbol),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const annuals: any[] = fts || [];
    const latest = annuals.length > 0 ? annuals[annuals.length - 1] : null;
    const prev = annuals.length >= 2 ? annuals[annuals.length - 2] : null;

    // --- Historical prices (from 2020 for 200-day geometric order) ---
    let closes: number[] = [];
    let closeDates: string[] = [];
    const hist = await cachedHistorical(symbol, "2020-01-01", "1d");
    if (hist.length > 0) {
      closes = hist
        .map((q: { close?: number | null }) => q.close)
        .filter((c: number | null | undefined): c is number => c != null);
      closeDates = hist.map(
        (q: { date?: Date }) => q.date?.toISOString?.()?.split("T")[0] ?? ""
      );
    }

    const { order: geoOrder, details: geoDetails } = computeGeometricOrder(closes);
    const tw = computeTrendWise(closes, closeDates);

    const allTimeHigh =
      closes.length > 0 ? Math.max(...closes) : quote.fiftyTwoWeekHigh ?? 0;
    const price = quote.regularMarketPrice;
    const distFromAth =
      allTimeHigh > 0
        ? `${(((price - allTimeHigh) / allTimeHigh) * 100).toFixed(1)}%`
        : null;

    // --- Fundamentals ---
    const sector = profile.sector || quote.sector || null;
    const industry = profile.industry || quote.industry || null;
    const beta = keyStats.beta ?? quote.beta ?? null;
    const pb = keyStats.priceToBook ?? quote.priceToBook ?? null;
    const evEbitda = keyStats.enterpriseToEbitda ?? null;
    const evSales = keyStats.enterpriseToRevenue ?? null;
    const mcap = quote.marketCap ?? null;
    const mcapB = mcap ? +(mcap / 1e9).toFixed(1) : null;

    const pct = (v: number | undefined | null) =>
      v != null ? +(v * 100).toFixed(1) : null;

    const roe = pct(finData.returnOnEquity);
    const opMargin = pct(finData.operatingMargins);
    const netMargin = pct(finData.profitMargins);
    const grossMargin = pct(finData.grossMargins);
    const ebitdaMargin = pct(finData.ebitdaMargins);
    const de = finData.debtToEquity ?? null;
    const currentRatio = finData.currentRatio ?? null;
    const divYieldRaw = quote.trailingAnnualDividendYield ?? null;
    const divYield = divYieldRaw ? +(divYieldRaw * 100).toFixed(2) : null;
    const revenueRaw = finData.totalRevenue ?? null;
    const revenue = revenueRaw ? +(revenueRaw / 1e9).toFixed(2) : null;
    const fcfRaw = finData.freeCashflow ?? null;
    const fcfYield = fcfRaw && mcap && mcap > 0 ? +((fcfRaw / mcap) * 100).toFixed(2) : null;

    // --- ROIC from fundamentalsTimeSeries ---
    let roic: number | null = null;
    if (latest?.EBIT && latest?.totalDebt != null && latest?.commonStockEquity) {
      const ebit = latest.EBIT;
      const nopat = ebit * 0.79; // assume ~21% tax
      const investedCapital = (latest.totalDebt ?? 0) + (latest.commonStockEquity ?? 0);
      if (investedCapital > 0) {
        roic = +((nopat / investedCapital) * 100).toFixed(1);
      }
    }

    // --- Revenue growth (YoY from annual FTS) ---
    let revenueGrowthAnnual: number | null = null;
    if (latest?.totalRevenue && prev?.totalRevenue && prev.totalRevenue > 0) {
      revenueGrowthAnnual = +(((latest.totalRevenue - prev.totalRevenue) / prev.totalRevenue) * 100).toFixed(1);
    }

    // --- Earnings growth (YoY) ---
    let earningsGrowthAnnual: number | null = null;
    if (latest?.netIncomeCommonStockholders && prev?.netIncomeCommonStockholders) {
      const ni0 = latest.netIncomeCommonStockholders;
      const ni1 = prev.netIncomeCommonStockholders;
      if (ni1 !== 0) {
        earningsGrowthAnnual = +(((ni0 - ni1) / Math.abs(ni1)) * 100).toFixed(1);
      }
    }

    // --- Debt/EBITDA ---
    let debtToEbitda: number | null = null;
    if (latest?.totalDebt && latest?.EBITDA && latest.EBITDA > 0) {
      debtToEbitda = +(latest.totalDebt / latest.EBITDA).toFixed(2);
    }

    // --- Interest coverage ---
    let interestCoverage: number | null = null;
    if (latest?.EBIT && latest?.interestExpense && Math.abs(latest.interestExpense) > 0) {
      interestCoverage = +(latest.EBIT / Math.abs(latest.interestExpense)).toFixed(1);
    }

    // --- FCF: prefer financialData (in B), fallback to FTS ---
    const ftsFcfRaw = latest?.freeCashFlow ?? null;
    const fcfB = fcfRaw ? +(fcfRaw / 1e9).toFixed(2) : ftsFcfRaw ? +(ftsFcfRaw / 1e9).toFixed(2) : null;

    // --- Revenue CAGR 3Y and 5Y ---
    let revenueCagr3y: number | null = null;
    let revenueCagr5y: number | null = null;
    if (annuals.length >= 4) {
      const rev3 = annuals[annuals.length - 4]?.totalRevenue;
      const revNow = latest?.totalRevenue;
      if (rev3 && revNow && rev3 > 0) {
        revenueCagr3y = +((Math.pow(revNow / rev3, 1 / 3) - 1) * 100).toFixed(1);
      }
    }
    if (annuals.length >= 6) {
      const rev5 = annuals[annuals.length - 6]?.totalRevenue;
      const revNow = latest?.totalRevenue;
      if (rev5 && revNow && rev5 > 0) {
        revenueCagr5y = +((Math.pow(revNow / rev5, 1 / 5) - 1) * 100).toFixed(1);
      }
    }

    const sql = getDb();

    // Check if symbol already exists — update latest record (preserve analysis)
    const existing = await sql`
      SELECT id FROM watchlist_items
      WHERE symbol = ${symbol}
      ORDER BY created_at DESC LIMIT 1
    `;

    if (existing.length > 0) {
      await sql`
        UPDATE watchlist_items SET
          name = ${quote.shortName || quote.longName || symbol},
          sector = COALESCE(${sector}, sector),
          industry = COALESCE(${industry}, industry),
          price = ${price},
          market_cap = ${mcapB},
          pe_ratio = ${quote.trailingPE ?? null},
          price_to_book = ${pb},
          ev_ebitda = COALESCE(${evEbitda}, ev_ebitda),
          ev_sales = COALESCE(${evSales}, ev_sales),
          dividend_yield = ${divYield},
          eps = ${quote.epsTrailingTwelveMonths ?? null},
          beta = ${beta},
          high_52w = ${quote.fiftyTwoWeekHigh ?? null},
          low_52w = ${quote.fiftyTwoWeekLow ?? null},
          distance_from_ath = ${distFromAth},
          roe = COALESCE(${roe}, roe),
          roic = COALESCE(${roic}, roic),
          gross_margin = COALESCE(${grossMargin}, gross_margin),
          operating_margin = COALESCE(${opMargin}, operating_margin),
          net_margin = COALESCE(${netMargin}, net_margin),
          ebitda_margin = COALESCE(${ebitdaMargin}, ebitda_margin),
          debt_to_equity = COALESCE(${de}, debt_to_equity),
          current_ratio = COALESCE(${currentRatio}, current_ratio),
          debt_to_ebitda = COALESCE(${debtToEbitda}, debt_to_ebitda),
          interest_coverage = COALESCE(${interestCoverage}, interest_coverage),
          revenue = COALESCE(${revenue}, revenue),
          fcf = COALESCE(${fcfB}, fcf),
          fcf_yield = COALESCE(${fcfYield}, fcf_yield),
          revenue_growth_annual = COALESCE(${revenueGrowthAnnual}, revenue_growth_annual),
          earnings_growth_annual = COALESCE(${earningsGrowthAnnual}, earnings_growth_annual),
          revenue_cagr_3y = COALESCE(${revenueCagr3y}, revenue_cagr_3y),
          revenue_cagr_5y = COALESCE(${revenueCagr5y}, revenue_cagr_5y),
          geometric_order = ${geoOrder},
          geometric_details = ${geoDetails},
          trend_signal = ${tw.signal},
          trend_entry_date = ${tw.entryDate},
          trend_entry_price = ${tw.entryPrice},
          data_sources = ${"yahoo-finance2 (web)"},
          updated_at = NOW()
        WHERE id = ${existing[0].id}
      `;
    } else {
      await sql`
        INSERT INTO watchlist_items (
          symbol, name, market, sector, industry, price, market_cap,
          pe_ratio, price_to_book, ev_ebitda, ev_sales, dividend_yield,
          eps, beta, high_52w, low_52w, distance_from_ath,
          roe, roic, gross_margin, operating_margin, net_margin, ebitda_margin,
          debt_to_equity, current_ratio, debt_to_ebitda, interest_coverage,
          revenue, fcf, fcf_yield,
          revenue_growth_annual, earnings_growth_annual,
          revenue_cagr_3y, revenue_cagr_5y,
          geometric_order, geometric_details,
          trend_signal, trend_entry_date, trend_entry_price,
          data_sources
        ) VALUES (
          ${symbol},
          ${quote.shortName || quote.longName || symbol},
          ${quote.market || "us_market"},
          ${sector},
          ${industry},
          ${price},
          ${mcapB},
          ${quote.trailingPE ?? null},
          ${pb},
          ${evEbitda},
          ${evSales},
          ${divYield},
          ${quote.epsTrailingTwelveMonths ?? null},
          ${beta},
          ${quote.fiftyTwoWeekHigh ?? null},
          ${quote.fiftyTwoWeekLow ?? null},
          ${distFromAth},
          ${roe},
          ${roic},
          ${grossMargin},
          ${opMargin},
          ${netMargin},
          ${ebitdaMargin},
          ${de},
          ${currentRatio},
          ${debtToEbitda},
          ${interestCoverage},
          ${revenue},
          ${fcfB},
          ${fcfYield},
          ${revenueGrowthAnnual},
          ${earningsGrowthAnnual},
          ${revenueCagr3y},
          ${revenueCagr5y},
          ${geoOrder},
          ${geoDetails},
          ${tw.signal},
          ${tw.entryDate},
          ${tw.entryPrice},
          ${"yahoo-finance2 (web)"}
        )
      `;
    }

    // Compute and save composite score
    const saved = await fetchStock(symbol);
    if (saved) {
      const { total } = computeCompositeScore(saved);
      await sql`
        UPDATE watchlist_items SET composite_score = ${total}
        WHERE id = (SELECT id FROM watchlist_items WHERE symbol = ${symbol} ORDER BY created_at DESC LIMIT 1)
      `;
    }

    revalidateTag("stocks", "max");
    revalidatePath("/");

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
