/**
 * Shared data-refresh logic: fetches Yahoo Finance + FMP data and upserts
 * all fundamental fields into watchlist_items.  Used by both
 * /api/analyze  (add/refresh a stock) and
 * /api/analyze-report  (ensure data is fresh before LLM call).
 */

import { getDb, fetchStock } from "@/lib/db";
import {
  cachedQuote,
  cachedSummary,
  cachedHistorical,
  cachedFundamentals,
} from "@/lib/yf-cache";
import { fetchAllFmpData, computeFmpDerived } from "@/lib/fmp";
import { computeCompositeScore } from "@/lib/composite-score";

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

  return { signal: lastSignal || "No Signal", entryDate, entryPrice };
}

function computeCapmFromReturns(
  stockCloses: number[],
  benchCloses: number[],
  window: number,
  benchSym: string
): {
  alpha: number | null;
  beta: number | null;
  r2: number | null;
  benchmark: string;
  alpha1y: number | null;
  alphaTrend: string | null;
} {
  const nil = { alpha: null, beta: null, r2: null, benchmark: benchSym, alpha1y: null, alphaTrend: null };
  const n = Math.min(stockCloses.length, benchCloses.length);
  if (n < window + 1) return nil;

  const sCloses = stockCloses.slice(-n);
  const bCloses = benchCloses.slice(-n);

  function dailyReturns(c: number[]): number[] {
    return c.slice(1).map((v, i) => (v - c[i]) / c[i]);
  }

  function regress(y: number[], x: number[]): { alpha: number; beta: number; r2: number } {
    const len = y.length;
    if (len === 0) return { alpha: 0, beta: 0, r2: 0 };
    let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < len; i++) {
      sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]; syy += y[i] * y[i];
    }
    const denom = len * sxx - sx * sx;
    if (Math.abs(denom) < 1e-15) return { alpha: 0, beta: 0, r2: 0 };
    const b = (len * sxy - sx * sy) / denom;
    const a = (sy - b * sx) / len;
    const ssTot = syy - (sy * sy) / len;
    const ssRes = y.reduce((s, yi, i) => s + (yi - a - b * x[i]) ** 2, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    return { alpha: a, beta: b, r2 };
  }

  const sRet = dailyReturns(sCloses);
  const bRet = dailyReturns(bCloses);

  // 6-month window
  const sRet6 = sRet.slice(-window);
  const bRet6 = bRet.slice(-window);
  const reg6 = regress(sRet6, bRet6);
  const alpha6Ann = reg6.alpha * 252 * 100;

  // 1-year window
  const win1y = Math.min(252, sRet.length);
  let alpha1y: number | null = null;
  if (win1y >= 200) {
    const reg1y = regress(sRet.slice(-win1y), bRet.slice(-win1y));
    alpha1y = Math.round(reg1y.alpha * 252 * 100 * 10) / 10;
  }

  // Alpha trend: compare first-half vs second-half 6M alpha
  let alphaTrend: string | null = "stable";
  if (sRet.length >= window * 2) {
    const firstHalf = regress(sRet.slice(-window * 2, -window), bRet.slice(-window * 2, -window));
    const a1 = firstHalf.alpha * 252 * 100;
    const a2 = alpha6Ann;
    const diff = a2 - a1;
    if (diff > 5) alphaTrend = "accelerating";
    else if (diff < -5) alphaTrend = "decelerating";
  }

  return {
    alpha: Math.round(alpha6Ann * 10) / 10,
    beta: Math.round(reg6.beta * 100) / 100,
    r2: Math.round(reg6.r2 * 100) / 100,
    benchmark: benchSym,
    alpha1y,
    alphaTrend,
  };
}

function computeGeometricOrder(closes: number[]): {
  order: number;
  details: string;
} {
  if (closes.length < 200)
    return { order: 0, details: "insufficient data" };

  const ma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
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

export interface RefreshResult {
  symbol: string;
  name: string;
  price: number;
  quote: Record<string, unknown>;
  summary: Record<string, unknown> | null;
  hist: { close: number; date: string }[];
}

/**
 * Fetch all Yahoo Finance data for a symbol and upsert into watchlist_items.
 * Returns the quote + summary objects so the caller (analyze-report) can
 * build an LLM prompt from fresh data without re-fetching.
 */
export async function refreshStockData(symbol: string): Promise<RefreshResult> {
  const [quote, summary, fts, fmpData] = await Promise.all([
    cachedQuote(symbol),
    cachedSummary(symbol),
    cachedFundamentals(symbol),
    fetchAllFmpData(symbol),
  ]);

  if (!quote || !quote.regularMarketPrice) {
    throw new Error(`No data found for ${symbol}`);
  }

  const price = (quote as Record<string, unknown>).regularMarketPrice as number;
  const fmp = computeFmpDerived(fmpData, price);

  const profile = (summary as Record<string, unknown>)?.assetProfile || {};
  const keyStats = (summary as Record<string, unknown>)?.defaultKeyStatistics || {};
  const finData = (summary as Record<string, unknown>)?.financialData || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const annuals: any[] = (fts as any[]) || [];
  const latest = annuals.length > 0 ? annuals[annuals.length - 1] : null;
  const prev = annuals.length >= 2 ? annuals[annuals.length - 2] : null;

  // Historical prices
  let closes: number[] = [];
  let closeDates: string[] = [];
  const rawHist = await cachedHistorical(symbol, "2020-01-01", "1d");
  if (rawHist.length > 0) {
    closes = rawHist
      .map((q: { close?: number | null }) => q.close)
      .filter((c: number | null | undefined): c is number => c != null);
    closeDates = rawHist.map(
      (q: { date?: Date }) => q.date?.toISOString?.()?.split("T")[0] ?? ""
    );
  }

  const { order: geoOrder, details: geoDetails } = computeGeometricOrder(closes);
  const tw = computeTrendWise(closes, closeDates);

  // CAPM: fetch benchmark and compute alpha/beta/R²
  const benchSym = symbol.endsWith(".SS") || symbol.endsWith(".SZ")
    ? "000300.SS"
    : symbol.endsWith(".HK")
      ? "^HSI"
      : "^GSPC";
  let capm = { alpha: null as number | null, beta: null as number | null, r2: null as number | null, benchmark: benchSym, alpha1y: null as number | null, alphaTrend: null as string | null };
  try {
    const benchHist = await cachedHistorical(benchSym, "2020-01-01", "1d");
    const benchCloses = benchHist
      .map((q: { close?: number | null }) => q.close)
      .filter((c: number | null | undefined): c is number => c != null);
    if (benchCloses.length > 130 && closes.length > 130) {
      capm = computeCapmFromReturns(closes, benchCloses, 126, benchSym);
    }
  } catch {
    // Benchmark fetch failed — leave CAPM null
  }

  // True ATH: fetch full history (monthly, use high not close to capture intra-month peaks)
  const athHist = await cachedHistorical(symbol, "1970-01-01", "1mo");
  const athHighs = athHist
    .map((q: { high?: number | null }) => q.high)
    .filter((h: number | null | undefined): h is number => h != null);
  const allTimeHigh = athHighs.length > 0
    ? Math.max(...athHighs, price)
    : closes.length > 0
      ? Math.max(...closes, price)
      : (quote as Record<string, unknown>).fiftyTwoWeekHigh ?? 0;
  const pctFromAth = Number(allTimeHigh) > 0
    ? ((price - Number(allTimeHigh)) / Number(allTimeHigh)) * 100
    : null;
  const distFromAth = pctFromAth != null
    ? `${Math.min(pctFromAth, 0).toFixed(1)}%`
    : null;

  const sector = (profile as Record<string, unknown>).sector || (quote as Record<string, unknown>).sector || null;
  const industry = (profile as Record<string, unknown>).industry || (quote as Record<string, unknown>).industry || null;
  const beta = (keyStats as Record<string, unknown>).beta ?? (quote as Record<string, unknown>).beta ?? null;
  const pb = (keyStats as Record<string, unknown>).priceToBook ?? (quote as Record<string, unknown>).priceToBook ?? null;
  const evEbitda = (keyStats as Record<string, unknown>).enterpriseToEbitda ?? null;
  const evSales = (keyStats as Record<string, unknown>).enterpriseToRevenue ?? null;
  const mcap = (quote as Record<string, unknown>).marketCap ?? null;
  const mcapB = mcap ? +(Number(mcap) / 1e9).toFixed(1) : null;

  const pct = (v: number | undefined | null) =>
    v != null ? +(Number(v) * 100).toFixed(1) : null;

  const fd = finData as Record<string, unknown>;
  const roe = pct(fd.returnOnEquity as number | undefined);
  const opMargin = pct(fd.operatingMargins as number | undefined);
  const netMargin = pct(fd.profitMargins as number | undefined);
  const grossMargin = pct(fd.grossMargins as number | undefined);
  const ebitdaMargin = pct(fd.ebitdaMargins as number | undefined);
  const de = fd.debtToEquity ?? null;
  const currentRatio = fd.currentRatio ?? null;
  const divYieldRaw = (quote as Record<string, unknown>).trailingAnnualDividendYield ?? null;
  const divYield = divYieldRaw ? +(Number(divYieldRaw) * 100).toFixed(2) : null;
  const revenueRaw = fd.totalRevenue ?? null;
  const revenue = revenueRaw ? +(Number(revenueRaw) / 1e9).toFixed(2) : null;
  const fcfRaw = fd.freeCashflow ?? null;
  const fcfYield = fcfRaw && mcap && Number(mcap) > 0 ? +((Number(fcfRaw) / Number(mcap)) * 100).toFixed(2) : null;

  let roic: number | null = null;
  if (latest?.EBIT && latest?.totalDebt != null && latest?.commonStockEquity) {
    const nopat = latest.EBIT * 0.79;
    const investedCapital = (latest.totalDebt ?? 0) + (latest.commonStockEquity ?? 0);
    if (investedCapital > 0) {
      roic = +((nopat / investedCapital) * 100).toFixed(1);
    }
  }

  let revenueGrowthAnnual: number | null = null;
  if (latest?.totalRevenue && prev?.totalRevenue && prev.totalRevenue > 0) {
    revenueGrowthAnnual = +(((latest.totalRevenue - prev.totalRevenue) / prev.totalRevenue) * 100).toFixed(1);
  }

  let earningsGrowthAnnual: number | null = null;
  if (latest?.netIncomeCommonStockholders && prev?.netIncomeCommonStockholders) {
    const ni1 = prev.netIncomeCommonStockholders;
    if (ni1 !== 0) {
      earningsGrowthAnnual = +(((latest.netIncomeCommonStockholders - ni1) / Math.abs(ni1)) * 100).toFixed(1);
    }
  }

  let debtToEbitda: number | null = null;
  if (latest?.totalDebt && latest?.EBITDA && latest.EBITDA > 0) {
    debtToEbitda = +(latest.totalDebt / latest.EBITDA).toFixed(2);
  }

  let interestCoverage: number | null = null;
  if (latest?.EBIT && latest?.interestExpense && Math.abs(latest.interestExpense) > 0) {
    interestCoverage = +(latest.EBIT / Math.abs(latest.interestExpense)).toFixed(1);
  }

  const ftsFcfRaw = latest?.freeCashFlow ?? null;
  const fcfB = fcfRaw ? +(Number(fcfRaw) / 1e9).toFixed(2) : ftsFcfRaw ? +(ftsFcfRaw / 1e9).toFixed(2) : null;

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

  let earningsCagr3y: number | null = null;
  if (annuals.length >= 4) {
    const ni3 = annuals[annuals.length - 4]?.netIncomeCommonStockholders;
    const niNow = latest?.netIncomeCommonStockholders;
    if (ni3 && niNow && ni3 > 0 && niNow > 0) {
      earningsCagr3y = +((Math.pow(niNow / ni3, 1 / 3) - 1) * 100).toFixed(1);
    }
  }

  // Yahoo fundamentalsTimeSeries balance sheet fallbacks for data FMP misses
  // (e.g. Chinese A-shares where FMP returns 0 for totalAssets, totalDebt, etc.)
  const yfTotalAssets = latest?.totalAssets > 0 ? +(latest.totalAssets / 1e9).toFixed(1) : null;
  const yfTotalDebt = latest?.totalDebt > 0 ? +(latest.totalDebt / 1e9).toFixed(1) : null;
  const yfNetDebt = latest?.netDebt != null ? +(latest.netDebt / 1e9).toFixed(1) : null;
  const yfCash = latest?.cashAndCashEquivalents > 0 ? +(latest.cashAndCashEquivalents / 1e9).toFixed(1) : null;
  const yfCurrentRatio = latest?.currentAssets > 0 && latest?.currentLiabilities > 0
    ? +(latest.currentAssets / latest.currentLiabilities).toFixed(2) : null;
  const yfRoa = latest?.netIncomeCommonStockholders != null && latest?.totalAssets > 0
    ? +((latest.netIncomeCommonStockholders / latest.totalAssets) * 100).toFixed(1) : null;
  const yfRoce = latest?.EBIT != null && latest?.totalAssets > 0 && latest?.currentLiabilities > 0
    ? +((latest.EBIT / (latest.totalAssets - latest.currentLiabilities)) * 100).toFixed(1) : null;

  const q = quote as Record<string, unknown>;
  const sql = getDb();

  const existing = await sql`
    SELECT id FROM watchlist_items
    WHERE symbol = ${symbol}
    ORDER BY created_at DESC LIMIT 1
  `;

  const dataSources = process.env.FMP_API_KEY ? "yahoo-finance2, FMP" : "yahoo-finance2 (web)";

  if (existing.length > 0) {
    await sql`
      UPDATE watchlist_items SET
        name = ${(q.shortName || q.longName || symbol) as string},
        sector = COALESCE(${sector as string | null}, sector),
        industry = COALESCE(${industry as string | null}, industry),
        price = ${price},
        market_cap = ${mcapB},
        pe_ratio = ${(q.trailingPE ?? null) as number | null},
        price_to_book = ${pb as number | null},
        ev_ebitda = COALESCE(${evEbitda as number | null}, ev_ebitda),
        ev_sales = COALESCE(${evSales as number | null}, ev_sales),
        dividend_yield = COALESCE(${divYield}, ${fmp.dividend_yield}, dividend_yield),
        eps = ${(q.epsTrailingTwelveMonths ?? null) as number | null},
        beta = ${beta as number | null},
        high_52w = ${(q.fiftyTwoWeekHigh ?? null) as number | null},
        low_52w = ${(q.fiftyTwoWeekLow ?? null) as number | null},
        distance_from_ath = ${distFromAth},
        roe = COALESCE(${roe}, roe),
        roic = COALESCE(${roic}, roic),
        gross_margin = COALESCE(${grossMargin}, gross_margin),
        operating_margin = COALESCE(${opMargin}, operating_margin),
        net_margin = COALESCE(${netMargin}, net_margin),
        ebitda_margin = COALESCE(${ebitdaMargin}, ebitda_margin),
        debt_to_equity = COALESCE(${de as number | null}, debt_to_equity),
        current_ratio = COALESCE(${currentRatio as number | null}, ${yfCurrentRatio}, current_ratio),
        debt_to_ebitda = COALESCE(${debtToEbitda}, debt_to_ebitda),
        interest_coverage = COALESCE(${interestCoverage}, interest_coverage),
        revenue = COALESCE(${revenue}, revenue),
        fcf = COALESCE(${fcfB}, fcf),
        fcf_yield = COALESCE(${fcfYield}, fcf_yield),
        revenue_growth_annual = COALESCE(${revenueGrowthAnnual}, revenue_growth_annual),
        earnings_growth_annual = COALESCE(${earningsGrowthAnnual}, earnings_growth_annual),
        revenue_cagr_3y = COALESCE(${revenueCagr3y}, ${fmp.revenue_cagr_3y}, revenue_cagr_3y),
        revenue_cagr_5y = COALESCE(${revenueCagr5y}, ${fmp.revenue_cagr_5y}, revenue_cagr_5y),
        earnings_cagr_3y = COALESCE(${earningsCagr3y}, earnings_cagr_3y),
        geometric_order = ${geoOrder},
        geometric_details = ${geoDetails},
        trend_signal = ${tw.signal},
        trend_entry_date = ${tw.entryDate},
        trend_entry_price = ${tw.entryPrice},
        pe_ttm = COALESCE(${fmp.pe_ttm}, pe_ttm),
        forward_pe = COALESCE(${fmp.forward_pe}, forward_pe),
        forward_eps = COALESCE(${fmp.forward_eps}, forward_eps),
        peg_ratio = COALESCE(${fmp.peg_ratio}, peg_ratio),
        price_to_sales = COALESCE(${fmp.price_to_sales}, price_to_sales),
        price_to_fcf = COALESCE(${fmp.price_to_fcf}, price_to_fcf),
        earnings_yield = COALESCE(${fmp.earnings_yield}, earnings_yield),
        dcf_fair_value = COALESCE(${fmp.dcf_fair_value}, dcf_fair_value),
        dcf_levered = COALESCE(${fmp.dcf_levered}, dcf_levered),
        roa = COALESCE(${fmp.roa}, ${yfRoa}, roa),
        roce = COALESCE(${fmp.roce}, ${yfRoce}, roce),
        revenue_ttm = COALESCE(${fmp.revenue_ttm}, revenue_ttm),
        net_income_ttm = COALESCE(${fmp.net_income_ttm}, net_income_ttm),
        ebitda_ttm = COALESCE(${fmp.ebitda_ttm}, ebitda_ttm),
        fcf_ttm = COALESCE(${fmp.fcf_ttm}, fcf_ttm),
        owner_earnings = COALESCE(${fmp.owner_earnings}, owner_earnings),
        total_assets = COALESCE(${fmp.total_assets}, ${yfTotalAssets}, total_assets),
        total_debt = COALESCE(${fmp.total_debt}, ${yfTotalDebt}, total_debt),
        net_debt = COALESCE(${fmp.net_debt}, ${yfNetDebt}, net_debt),
        cash_and_equivalents = COALESCE(${fmp.cash_and_equivalents}, ${yfCash}, cash_and_equivalents),
        fmp_rating = COALESCE(${fmp.fmp_rating}, fmp_rating),
        fmp_rating_score = COALESCE(${fmp.fmp_rating_score}, fmp_rating_score),
        piotroski_score = COALESCE(${fmp.piotroski_score}, piotroski_score),
        altman_z_score = COALESCE(${fmp.altman_z_score}, altman_z_score),
        revenue_growth_ttm = COALESCE(${fmp.revenue_growth_ttm}, revenue_growth_ttm),
        revenue_growth_recent_q = COALESCE(${fmp.revenue_growth_recent_q}, revenue_growth_recent_q),
        earnings_growth_ttm = COALESCE(${fmp.earnings_growth_ttm}, earnings_growth_ttm),
        earnings_growth_recent_q = COALESCE(${fmp.earnings_growth_recent_q}, earnings_growth_recent_q),
        shareholder_yield = COALESCE(${fmp.shareholder_yield}, shareholder_yield),
        capm_alpha = COALESCE(${capm.alpha}, capm_alpha),
        capm_beta = COALESCE(${capm.beta}, capm_beta),
        capm_r2 = COALESCE(${capm.r2}, capm_r2),
        capm_benchmark = COALESCE(${capm.benchmark}, capm_benchmark),
        capm_alpha_1y = COALESCE(${capm.alpha1y}, capm_alpha_1y),
        capm_alpha_trend = COALESCE(${capm.alphaTrend}, capm_alpha_trend),
        data_sources = ${dataSources},
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
        revenue_cagr_3y, revenue_cagr_5y, earnings_cagr_3y,
        geometric_order, geometric_details,
        trend_signal, trend_entry_date, trend_entry_price,
        pe_ttm, forward_pe, forward_eps, peg_ratio,
        price_to_sales, price_to_fcf, earnings_yield,
        dcf_fair_value, dcf_levered,
        roa, roce,
        revenue_ttm, net_income_ttm, ebitda_ttm, fcf_ttm, owner_earnings,
        total_assets, total_debt, net_debt, cash_and_equivalents,
        fmp_rating, fmp_rating_score, piotroski_score, altman_z_score,
        revenue_growth_ttm, revenue_growth_recent_q,
        earnings_growth_ttm, earnings_growth_recent_q,
        shareholder_yield,
        capm_alpha, capm_beta, capm_r2, capm_benchmark, capm_alpha_1y, capm_alpha_trend,
        data_sources
      ) VALUES (
        ${symbol},
        ${(q.shortName || q.longName || symbol) as string},
        ${(q.market || "us_market") as string},
        ${sector as string | null},
        ${industry as string | null},
        ${price},
        ${mcapB},
        ${(q.trailingPE ?? null) as number | null},
        ${pb as number | null},
        ${evEbitda as number | null},
        ${evSales as number | null},
        ${divYield ?? fmp.dividend_yield},
        ${(q.epsTrailingTwelveMonths ?? null) as number | null},
        ${beta as number | null},
        ${(q.fiftyTwoWeekHigh ?? null) as number | null},
        ${(q.fiftyTwoWeekLow ?? null) as number | null},
        ${distFromAth},
        ${roe},
        ${roic},
        ${grossMargin},
        ${opMargin},
        ${netMargin},
        ${ebitdaMargin},
        ${de as number | null},
        ${(currentRatio as number | null) ?? yfCurrentRatio},
        ${debtToEbitda},
        ${interestCoverage},
        ${revenue},
        ${fcfB},
        ${fcfYield},
        ${revenueGrowthAnnual},
        ${earningsGrowthAnnual},
        ${revenueCagr3y ?? fmp.revenue_cagr_3y},
        ${revenueCagr5y ?? fmp.revenue_cagr_5y},
        ${earningsCagr3y},
        ${geoOrder},
        ${geoDetails},
        ${tw.signal},
        ${tw.entryDate},
        ${tw.entryPrice},
        ${fmp.pe_ttm},
        ${fmp.forward_pe},
        ${fmp.forward_eps},
        ${fmp.peg_ratio},
        ${fmp.price_to_sales},
        ${fmp.price_to_fcf},
        ${fmp.earnings_yield},
        ${fmp.dcf_fair_value},
        ${fmp.dcf_levered},
        ${fmp.roa ?? yfRoa},
        ${fmp.roce ?? yfRoce},
        ${fmp.revenue_ttm},
        ${fmp.net_income_ttm},
        ${fmp.ebitda_ttm},
        ${fmp.fcf_ttm},
        ${fmp.owner_earnings},
        ${fmp.total_assets ?? yfTotalAssets},
        ${fmp.total_debt ?? yfTotalDebt},
        ${fmp.net_debt ?? yfNetDebt},
        ${fmp.cash_and_equivalents ?? yfCash},
        ${fmp.fmp_rating},
        ${fmp.fmp_rating_score},
        ${fmp.piotroski_score},
        ${fmp.altman_z_score},
        ${fmp.revenue_growth_ttm},
        ${fmp.revenue_growth_recent_q},
        ${fmp.earnings_growth_ttm},
        ${fmp.earnings_growth_recent_q},
        ${fmp.shareholder_yield},
        ${capm.alpha}, ${capm.beta}, ${capm.r2}, ${capm.benchmark}, ${capm.alpha1y}, ${capm.alphaTrend},
        ${dataSources}
      )
    `;
  }

  const saved = await fetchStock(symbol);
  if (saved) {
    const { total } = computeCompositeScore(saved);
    await sql`
      UPDATE watchlist_items SET composite_score = ${total}
      WHERE id = ${saved.id}
    `;
  }

  // Build weekly hist for LLM prompt
  const weeklyHist = await cachedHistorical(symbol, "2020-01-01", "1wk");
  const hist = weeklyHist.map((r: { close: number; date: Date }) => ({
    close: r.close,
    date: r.date?.toISOString?.() ?? "",
  }));

  return {
    symbol,
    name: (q.shortName || q.longName || symbol) as string,
    price,
    quote: quote as Record<string, unknown>,
    summary: summary as Record<string, unknown> | null,
    hist,
  };
}
