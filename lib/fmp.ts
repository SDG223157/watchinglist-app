/**
 * FMP (Financial Modeling Prep) API client.
 * Uses the /stable/ endpoints (post-Aug 2025 migration).
 * In-memory cache with 1-hour TTL per-process.
 */

const FMP_BASE = "https://financialmodelingprep.com/stable";

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const TTL = 60 * 60 * 1000; // 1 hour

function cached<T>(key: string): T | null {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < TTL) return e.data as T;
  return null;
}

function store<T>(key: string, data: T): T {
  cache.set(key, { data, ts: Date.now() });
  return data;
}

async function fmpGet<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;

  const qs = new URLSearchParams({ ...params, apikey: apiKey });
  const url = `${FMP_BASE}/${path}?${qs}`;
  const cacheKey = `fmp:${path}:${JSON.stringify(params)}`;

  const hit = cached<T>(cacheKey);
  if (hit) return hit;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || (Array.isArray(data) && data.length === 0)) return null;
    if (data["Error Message"]) return null;
    return store(cacheKey, data as T);
  } catch {
    return null;
  }
}

// ─── Endpoint types ───

export interface FmpRatiosTTM {
  priceToEarningsRatioTTM: number;
  priceToEarningsGrowthRatioTTM: number;
  priceToSalesRatioTTM: number;
  priceToFreeCashFlowRatioTTM: number;
  earningsYieldTTM: number;
  freeCashFlowYieldTTM: number;
  dividendYieldTTM: number;
  returnOnAssetsTTM: number;
  returnOnEquityTTM: number;
  returnOnCapitalEmployedTTM: number;
  currentRatioTTM: number;
  interestCoverageRatioTTM: number;
  debtToEquityRatioTTM: number;
  [key: string]: unknown;
}

export interface FmpRating {
  symbol: string;
  rating: string;
  overallScore: number;
  [key: string]: unknown;
}

export interface FmpDcf {
  symbol: string;
  dcf: number;
  "Stock Price": number;
  [key: string]: unknown;
}

export interface FmpProfile {
  symbol: string;
  price: number;
  marketCap: number;
  beta: number;
  companyName: string;
  sector: string;
  industry: string;
  [key: string]: unknown;
}

export interface FmpBalanceSheet {
  totalAssets: number;
  totalDebt: number;
  netDebt: number;
  cashAndCashEquivalents: number;
  totalCurrentAssets: number;
  totalCurrentLiabilities: number;
  [key: string]: unknown;
}

export interface FmpIncomeQ {
  date: string;
  period: string;
  fiscalYear: string;
  revenue: number;
  netIncome: number;
  ebitda: number;
  eps: number;
  epsDiluted: number;
  operatingIncome: number;
  depreciationAndAmortization: number;
  [key: string]: unknown;
}

export interface FmpCashFlowQ {
  date: string;
  period: string;
  netIncome: number;
  depreciationAndAmortization: number;
  capitalExpenditure: number;
  freeCashFlow: number;
  netCashProvidedByOperatingActivities: number;
  [key: string]: unknown;
}

export interface FmpEstimate {
  date: string;
  epsAvg: number;
  epsHigh: number;
  epsLow: number;
  revenueAvg: number;
  numAnalystsEps: number;
  [key: string]: unknown;
}

export interface FmpKeyMetricsTTM {
  returnOnAssetsTTM: number;
  returnOnCapitalEmployedTTM: number;
  earningsYieldTTM: number;
  freeCashFlowYieldTTM: number;
  evToEBITDATTM: number;
  netDebtToEBITDATTM: number;
  [key: string]: unknown;
}

// ─── Fetchers ───

export async function fetchFmpRatiosTTM(symbol: string): Promise<FmpRatiosTTM | null> {
  const data = await fmpGet<FmpRatiosTTM[]>("ratios-ttm", { symbol });
  return data?.[0] ?? null;
}

export async function fetchFmpRating(symbol: string): Promise<FmpRating | null> {
  const data = await fmpGet<FmpRating[]>("ratings-snapshot", { symbol });
  return data?.[0] ?? null;
}

export async function fetchFmpDcf(symbol: string): Promise<FmpDcf | null> {
  const data = await fmpGet<FmpDcf[]>("discounted-cash-flow", { symbol });
  return data?.[0] ?? null;
}

export async function fetchFmpProfile(symbol: string): Promise<FmpProfile | null> {
  const data = await fmpGet<FmpProfile[]>("profile", { symbol });
  return data?.[0] ?? null;
}

export async function fetchFmpBalanceSheet(symbol: string): Promise<FmpBalanceSheet | null> {
  const data = await fmpGet<FmpBalanceSheet[]>("balance-sheet-statement", {
    symbol,
    period: "annual",
    limit: "1",
  });
  return data?.[0] ?? null;
}

export async function fetchFmpIncomeQuarterly(symbol: string, limit = 8): Promise<FmpIncomeQ[]> {
  const data = await fmpGet<FmpIncomeQ[]>("income-statement", {
    symbol,
    period: "quarter",
    limit: String(limit),
  });
  return data ?? [];
}

export async function fetchFmpIncomeAnnual(symbol: string, limit = 7): Promise<FmpIncomeQ[]> {
  const data = await fmpGet<FmpIncomeQ[]>("income-statement", {
    symbol,
    period: "annual",
    limit: String(limit),
  });
  return data ?? [];
}

export async function fetchFmpCashFlowQuarterly(symbol: string, limit = 8): Promise<FmpCashFlowQ[]> {
  const data = await fmpGet<FmpCashFlowQ[]>("cash-flow-statement", {
    symbol,
    period: "quarter",
    limit: String(limit),
  });
  return data ?? [];
}

export async function fetchFmpEstimates(symbol: string): Promise<FmpEstimate[]> {
  const data = await fmpGet<FmpEstimate[]>("analyst-estimates", {
    symbol,
    period: "annual",
    limit: "5",
  });
  return data ?? [];
}

export async function fetchFmpKeyMetricsTTM(symbol: string): Promise<FmpKeyMetricsTTM | null> {
  const data = await fmpGet<FmpKeyMetricsTTM[]>("key-metrics-ttm", { symbol });
  return data?.[0] ?? null;
}

// ─── Composite: fetch everything in parallel ───

export interface FmpData {
  ratios: FmpRatiosTTM | null;
  rating: FmpRating | null;
  dcf: FmpDcf | null;
  profile: FmpProfile | null;
  balanceSheet: FmpBalanceSheet | null;
  incomeQ: FmpIncomeQ[];
  incomeAnnual: FmpIncomeQ[];
  cashFlowQ: FmpCashFlowQ[];
  estimates: FmpEstimate[];
  keyMetrics: FmpKeyMetricsTTM | null;
}

export async function fetchAllFmpData(symbol: string): Promise<FmpData> {
  const [ratios, rating, dcf, profile, balanceSheet, incomeQ, incomeAnnual, cashFlowQ, estimates, keyMetrics] =
    await Promise.all([
      fetchFmpRatiosTTM(symbol),
      fetchFmpRating(symbol),
      fetchFmpDcf(symbol),
      fetchFmpProfile(symbol),
      fetchFmpBalanceSheet(symbol),
      fetchFmpIncomeQuarterly(symbol),
      fetchFmpIncomeAnnual(symbol),
      fetchFmpCashFlowQuarterly(symbol),
      fetchFmpEstimates(symbol),
      fetchFmpKeyMetricsTTM(symbol),
    ]);

  return { ratios, rating, dcf, profile, balanceSheet, incomeQ, incomeAnnual, cashFlowQ, estimates, keyMetrics };
}

// ─── Peer comparison ───

interface FmpPeerEntry {
  symbol: string;
  companyName: string;
  price: number;
  mktCap: number;
}

export interface PeerMetrics {
  symbol: string;
  name: string;
  price: number;
  change: number;
  marketCap: number;
  pe: number | null;
  roe: number | null;
  operatingMargin: number | null;
  fcfYield: number | null;
  debtToEquity: number | null;
}

export async function fetchPeerComparison(symbol: string, limit = 10): Promise<PeerMetrics[]> {
  const peers = await fmpGet<FmpPeerEntry[]>("stock-peers", { symbol });
  if (!peers || peers.length === 0) return [];

  const entries = peers.slice(0, limit);

  const results = await Promise.all(
    entries.map(async (peer): Promise<PeerMetrics | null> => {
      const ratios = await fmpGet<FmpRatiosTTM[]>("ratios-ttm", { symbol: peer.symbol });
      const r = ratios?.[0];
      const num = (v: unknown, mult = 1, dp = 1): number | null => {
        if (v == null || typeof v !== "number" || isNaN(v)) return null;
        return +(v * mult).toFixed(dp);
      };
      return {
        symbol: peer.symbol,
        name: peer.companyName ?? peer.symbol,
        price: peer.price ?? 0,
        change: 0,
        marketCap: peer.mktCap ?? 0,
        pe: num(r?.priceToEarningsRatioTTM),
        roe: num(r?.returnOnEquityTTM, 100),
        operatingMargin: num((r as Record<string, unknown> | undefined)?.operatingProfitMarginTTM as number, 100),
        fcfYield: num(r?.freeCashFlowYieldTTM, 100, 2),
        debtToEquity: num(r?.debtToEquityRatioTTM, 1, 2),
      };
    })
  );

  return results.filter((r): r is PeerMetrics => r !== null);
}

// ─── Derived computations from FMP data ───

export function computeFmpDerived(fmp: FmpData, currentPrice: number) {
  const r = fmp.ratios;
  const bs = fmp.balanceSheet;
  const incQ = fmp.incomeQ;
  const incA = fmp.incomeAnnual; // sorted newest-first from FMP
  const cfQ = fmp.cashFlowQ;
  const est = fmp.estimates;

  // TTM aggregates from quarterly statements (most recent 4 quarters)
  const last4Inc = incQ.slice(0, 4);
  const last4Cf = cfQ.slice(0, 4);
  const prev4Inc = incQ.slice(4, 8);

  const sum = (arr: { [k: string]: unknown }[], key: string): number | null => {
    const vals = arr.map((x) => x[key]).filter((v): v is number => typeof v === "number");
    return vals.length >= 4 ? vals.reduce((a, b) => a + b, 0) : null;
  };

  const revenueTtm = sum(last4Inc, "revenue");
  const netIncomeTtm = sum(last4Inc, "netIncome");
  const ebitdaTtm = sum(last4Inc, "ebitda");
  const fcfTtm = sum(last4Cf, "freeCashFlow");
  const opCfTtm = sum(last4Cf, "netCashProvidedByOperatingActivities");
  const capexTtm = sum(last4Cf, "capitalExpenditure");
  const depTtm = sum(last4Cf, "depreciationAndAmortization");

  // Owner earnings = net income + D&A - capex (Buffett method)
  let ownerEarnings: number | null = null;
  if (netIncomeTtm != null && depTtm != null && capexTtm != null) {
    ownerEarnings = netIncomeTtm + depTtm - Math.abs(capexTtm);
  }

  // Forward PE and EPS from analyst estimates
  let forwardEps: number | null = null;
  let forwardPe: number | null = null;
  if (est.length > 0) {
    const now = new Date();
    const future = est
      .filter((e) => new Date(e.date) > now && e.epsAvg > 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (future.length > 0) {
      forwardEps = future[0].epsAvg;
      forwardPe = currentPrice > 0 && forwardEps > 0 ? +(currentPrice / forwardEps).toFixed(2) : null;
    }
  }

  // PEG ratio from ratios-ttm
  const pegRatio = r?.priceToEarningsGrowthRatioTTM
    ? +r.priceToEarningsGrowthRatioTTM.toFixed(2)
    : null;

  // TTM growth: revenue & earnings (last 4Q sum vs prior 4Q sum)
  const revenuePrev = sum(prev4Inc, "revenue");
  const netIncomePrev = sum(prev4Inc, "netIncome");

  let revenueGrowthTtm: number | null = null;
  if (revenueTtm != null && revenuePrev != null && revenuePrev > 0) {
    revenueGrowthTtm = +(((revenueTtm - revenuePrev) / revenuePrev) * 100).toFixed(1);
  }

  let earningsGrowthTtm: number | null = null;
  if (netIncomeTtm != null && netIncomePrev != null && netIncomePrev !== 0) {
    earningsGrowthTtm = +(((netIncomeTtm - netIncomePrev) / Math.abs(netIncomePrev)) * 100).toFixed(1);
  }

  // Recent Q YoY growth (latest Q vs same Q prior year — index 0 vs index 4)
  let revenueGrowthRecentQ: number | null = null;
  let earningsGrowthRecentQ: number | null = null;
  if (incQ.length >= 5) {
    const latestQ = incQ[0];
    const sameQPriorYear = incQ[4];
    if (latestQ.revenue && sameQPriorYear.revenue && sameQPriorYear.revenue > 0) {
      revenueGrowthRecentQ = +(((latestQ.revenue - sameQPriorYear.revenue) / sameQPriorYear.revenue) * 100).toFixed(1);
    }
    if (latestQ.netIncome && sameQPriorYear.netIncome && sameQPriorYear.netIncome !== 0) {
      earningsGrowthRecentQ = +(((latestQ.netIncome - sameQPriorYear.netIncome) / Math.abs(sameQPriorYear.netIncome)) * 100).toFixed(1);
    }
  }

  // Shareholder yield = dividend yield + buyback yield
  // Approximate buyback from cash flow: commonStockRepurchased / marketCap
  let shareholderYield: number | null = null;
  const divYield = r?.dividendYieldTTM ?? null;
  const buybackRaw = sum(last4Cf, "commonStockRepurchased" as string);
  const mktCap = fmp.profile?.marketCap;
  if (divYield != null && mktCap && mktCap > 0) {
    const buybackYield = buybackRaw != null ? Math.abs(buybackRaw) / mktCap : 0;
    shareholderYield = +((divYield + buybackYield) * 100).toFixed(2);
  }

  // Revenue CAGR from FMP annual income statements (newest-first)
  let revenueCagr3y: number | null = null;
  let revenueCagr5y: number | null = null;
  if (incA.length >= 4) {
    const revNow = incA[0]?.revenue;
    const rev3 = incA[3]?.revenue;
    if (revNow && rev3 && rev3 > 0) {
      revenueCagr3y = +((Math.pow(revNow / rev3, 1 / 3) - 1) * 100).toFixed(1);
    }
  }
  if (incA.length >= 6) {
    const revNow = incA[0]?.revenue;
    const rev5 = incA[5]?.revenue;
    if (revNow && rev5 && rev5 > 0) {
      revenueCagr5y = +((Math.pow(revNow / rev5, 1 / 5) - 1) * 100).toFixed(1);
    }
  }

  // Piotroski F-Score (computed from available data)
  let piotroskiScore: number | null = null;
  if (last4Inc.length >= 4 && prev4Inc.length >= 4 && bs) {
    let score = 0;
    if (netIncomeTtm != null && netIncomeTtm > 0) score++;
    if (opCfTtm != null && opCfTtm > 0) score++;
    if (netIncomeTtm != null && netIncomePrev != null && netIncomeTtm > netIncomePrev) score++;
    if (opCfTtm != null && netIncomeTtm != null && opCfTtm > netIncomeTtm) score++;
    // Leverage: current ratio > 1
    if (bs.totalCurrentAssets && bs.totalCurrentLiabilities && bs.totalCurrentAssets > bs.totalCurrentLiabilities) score++;
    // Revenue growth
    if (revenueTtm != null && revenuePrev != null && revenueTtm > revenuePrev) score++;
    // Gross margin improvement (approximate)
    const costKey = "costOfRevenue";
    const gm0 = last4Inc.reduce((s, q) => s + (q.revenue - (Number((q as Record<string, unknown>)[costKey]) || 0)), 0) / (revenueTtm || 1);
    const gm1 = prev4Inc.reduce((s, q) => s + (q.revenue - (Number((q as Record<string, unknown>)[costKey]) || 0)), 0) / (revenuePrev || 1);
    if (gm0 > gm1) score++;
    // Asset turnover improvement
    if (revenueTtm != null && revenuePrev != null && bs.totalAssets > 0) {
      const at0 = revenueTtm / bs.totalAssets;
      const at1 = revenuePrev / bs.totalAssets;
      if (at0 > at1) score++;
    }
    // No dilution (shares outstanding stable or decreased)
    const sharesNow = last4Inc[0]?.weightedAverageShsOut as number | undefined;
    const sharesPrev = prev4Inc[0]?.weightedAverageShsOut as number | undefined;
    if (sharesNow && sharesPrev && sharesNow <= sharesPrev) score++;

    piotroskiScore = score;
  }

  // Altman Z-Score = 1.2*WC/TA + 1.4*RE/TA + 3.3*EBIT/TA + 0.6*ME/TL + Sales/TA
  let altmanZScore: number | null = null;
  if (bs && revenueTtm != null && ebitdaTtm != null && mktCap) {
    const ta = bs.totalAssets;
    const wc = (bs.totalCurrentAssets || 0) - (bs.totalCurrentLiabilities || 0);
    const tl = ta - ((ta - (bs.totalDebt || 0)) * 0.75); // approximate total liabilities
    if (ta > 0 && tl > 0) {
      const re = netIncomeTtm ?? 0; // retained earnings approximation
      const ebit = ebitdaTtm - (depTtm ?? 0);
      altmanZScore = +(
        1.2 * (wc / ta) +
        1.4 * (re / ta) +
        3.3 * (ebit / ta) +
        0.6 * (mktCap / tl) +
        revenueTtm / ta
      ).toFixed(2);
    }
  }

  // Helper: safely convert a possibly-missing numeric field to a fixed value
  const num = (v: unknown, mult = 1, dp = 1): number | null => {
    if (v == null || typeof v !== "number" || isNaN(v)) return null;
    return +(v * mult).toFixed(dp);
  };

  // Merge ratios-ttm and key-metrics-ttm: some stocks (e.g. XOM) have
  // ROA/ROCE/earningsYield only in key-metrics-ttm, not ratios-ttm
  const km = fmp.keyMetrics;
  const roaTTM = r?.returnOnAssetsTTM ?? km?.returnOnAssetsTTM;
  const roceTTM = r?.returnOnCapitalEmployedTTM ?? km?.returnOnCapitalEmployedTTM;
  const earningsYieldTTM = r?.earningsYieldTTM ?? km?.earningsYieldTTM;

  return {
    // Valuation
    pe_ttm: num(r?.priceToEarningsRatioTTM),
    forward_pe: forwardPe,
    forward_eps: forwardEps ? +forwardEps.toFixed(2) : null,
    peg_ratio: pegRatio,
    price_to_sales: num(r?.priceToSalesRatioTTM, 1, 2),
    price_to_fcf: num(r?.priceToFreeCashFlowRatioTTM),
    earnings_yield: num(earningsYieldTTM, 100, 2),
    dcf_fair_value: fmp.dcf?.dcf ? +fmp.dcf.dcf.toFixed(2) : null,
    dcf_levered: null as number | null,

    // Profitability (extras beyond Yahoo)
    roa: num(roaTTM, 100),
    roce: num(roceTTM, 100),

    // TTM financials (in billions)
    revenue_ttm: revenueTtm ? +(revenueTtm / 1e9).toFixed(2) : null,
    net_income_ttm: netIncomeTtm ? +(netIncomeTtm / 1e9).toFixed(2) : null,
    ebitda_ttm: ebitdaTtm ? +(ebitdaTtm / 1e9).toFixed(2) : null,
    fcf_ttm: fcfTtm ? +(fcfTtm / 1e9).toFixed(2) : null,
    owner_earnings: ownerEarnings ? +(ownerEarnings / 1e9).toFixed(2) : null,

    // Balance sheet (in billions)
    total_assets: bs ? +(bs.totalAssets / 1e9).toFixed(1) : null,
    total_debt: bs?.totalDebt ? +(bs.totalDebt / 1e9).toFixed(1) : null,
    net_debt: bs?.netDebt ? +(bs.netDebt / 1e9).toFixed(1) : null,
    cash_and_equivalents: bs?.cashAndCashEquivalents ? +(bs.cashAndCashEquivalents / 1e9).toFixed(1) : null,

    // Scores & ratings
    fmp_rating: fmp.rating?.rating ?? null,
    fmp_rating_score: fmp.rating?.overallScore ?? null,
    piotroski_score: piotroskiScore,
    altman_z_score: altmanZScore,

    // Growth (TTM and recent Q)
    revenue_growth_ttm: revenueGrowthTtm,
    revenue_growth_recent_q: revenueGrowthRecentQ,
    earnings_growth_ttm: earningsGrowthTtm,
    earnings_growth_recent_q: earningsGrowthRecentQ,

    // CAGR (from FMP annual income statements)
    revenue_cagr_3y: revenueCagr3y,
    revenue_cagr_5y: revenueCagr5y,

    // Shareholder yield
    shareholder_yield: shareholderYield,
  };
}
