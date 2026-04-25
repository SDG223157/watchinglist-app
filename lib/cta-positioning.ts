import { cachedHistorical } from "@/lib/yf-cache";

export type CTAAssetClass = "Equities" | "Rates" | "FX" | "Commodities";

export interface CTAMarket {
  code: string;
  name: string;
  assetClass: CTAAssetClass;
  ticker: string;
  cotMarket: string | null;
  cotReport: "disaggregated" | "financial" | null;
}

export interface CTARow {
  code: string;
  name: string;
  assetClass: CTAAssetClass;
  ticker: string;
  price: number;
  asOf: string;
  rawTrend: number;
  trendSignal: number;
  realizedVol60d: number | null;
  targetVol: number;
  volScale: number;
  modelExposure: number;
  finalCta: number;
  cot: COTSnapshot | null;
  oneDayChange: number | null;
  fiveDayChange: number | null;
  oneMonthAgo: number | null;
  oneMonthChange: number | null;
  flipShock: number | null;
  deriskShock: number | null;
  flowDown2Pct: number | null;
  flowUp2Pct: number | null;
  classification: string;
  flowRegime: string;
  dealerGammaRegime: "unknown";
  components: Record<string, { return: number | null; z: number; weight: number }>;
  shockGrid: Record<string, { exposure: number; flow: number }>;
}

export interface COTSnapshot {
  report: "Disaggregated" | "TFF";
  proxy: "Managed Money" | "Leveraged Funds";
  market: string;
  reportDate: string;
  long: number;
  short: number;
  spread: number;
  net: number;
  openInterest: number;
  netPctOi: number;
  zScore: number | null;
  signal: number | null;
  historyWeeks: number;
}

export interface CTADashboard {
  generatedAt: string;
  targetVol: number;
  period: CTAPeriod;
  method: string;
  rows: CTARow[];
  errors: { code: string; ticker: string; assetClass: CTAAssetClass; error: string }[];
  summary: {
    markets: number;
    crowded: number;
    fragile: number;
    netExposure: number;
    grossExposure: number;
    cotCoverage: number;
    reducing: number;
    covering: number;
  };
}

type CTAPeriod = "1y" | "2y" | "3y" | "5y" | "max";

const LOOKBACKS: [number, number][] = [[21, 0.2], [63, 0.3], [126, 0.3], [252, 0.2]];
const SHOCKS = [-0.05, -0.03, -0.02, -0.01, 0.01, 0.02, 0.03, 0.05];
const DEFAULT_TARGET_VOL = 0.15;

export const CTA_MARKETS: CTAMarket[] = [
  { code: "ES", name: "S&P 500 E-mini", assetClass: "Equities", ticker: "ES=F", cotMarket: "E-MINI S&P 500", cotReport: "financial" },
  { code: "NQ", name: "Nasdaq 100 E-mini", assetClass: "Equities", ticker: "NQ=F", cotMarket: "NASDAQ-100", cotReport: "financial" },
  { code: "RTY", name: "Russell 2000 E-mini", assetClass: "Equities", ticker: "RTY=F", cotMarket: "RUSSELL E-MINI", cotReport: "financial" },
  { code: "YM", name: "Dow E-mini", assetClass: "Equities", ticker: "YM=F", cotMarket: "DJIA", cotReport: "financial" },
  { code: "ZN", name: "US 10Y Note", assetClass: "Rates", ticker: "ZN=F", cotMarket: "10-YEAR U.S. TREASURY NOTES", cotReport: "financial" },
  { code: "ZF", name: "US 5Y Note", assetClass: "Rates", ticker: "ZF=F", cotMarket: "5-YEAR U.S. TREASURY NOTES", cotReport: "financial" },
  { code: "ZB", name: "US 30Y Bond", assetClass: "Rates", ticker: "ZB=F", cotMarket: "U.S. TREASURY BONDS", cotReport: "financial" },
  { code: "DX", name: "US Dollar Index", assetClass: "FX", ticker: "DX-Y.NYB", cotMarket: "U.S. DOLLAR INDEX", cotReport: "financial" },
  { code: "EURUSD", name: "Euro / US Dollar", assetClass: "FX", ticker: "EURUSD=X", cotMarket: "EURO FX", cotReport: "financial" },
  { code: "USDJPY", name: "US Dollar / Yen", assetClass: "FX", ticker: "JPY=X", cotMarket: "JAPANESE YEN", cotReport: "financial" },
  { code: "GBPUSD", name: "British Pound / US Dollar", assetClass: "FX", ticker: "GBPUSD=X", cotMarket: "BRITISH POUND", cotReport: "financial" },
  { code: "AUDUSD", name: "Australian Dollar / US Dollar", assetClass: "FX", ticker: "AUDUSD=X", cotMarket: "AUSTRALIAN DOLLAR", cotReport: "financial" },
  { code: "CL", name: "WTI Crude Oil", assetClass: "Commodities", ticker: "CL=F", cotMarket: "CRUDE OIL, LIGHT SWEET", cotReport: "disaggregated" },
  { code: "BZ", name: "Brent Crude Oil", assetClass: "Commodities", ticker: "BZ=F", cotMarket: "BRENT CRUDE OIL", cotReport: "disaggregated" },
  { code: "GC", name: "Gold", assetClass: "Commodities", ticker: "GC=F", cotMarket: "GOLD", cotReport: "disaggregated" },
  { code: "SI", name: "Silver", assetClass: "Commodities", ticker: "SI=F", cotMarket: "SILVER", cotReport: "disaggregated" },
  { code: "HG", name: "Copper", assetClass: "Commodities", ticker: "HG=F", cotMarket: "COPPER", cotReport: "disaggregated" },
  { code: "NG", name: "Natural Gas", assetClass: "Commodities", ticker: "NG=F", cotMarket: "NATURAL GAS", cotReport: "disaggregated" },
  { code: "ZC", name: "Corn", assetClass: "Commodities", ticker: "ZC=F", cotMarket: "CORN", cotReport: "disaggregated" },
  { code: "ZW", name: "Wheat", assetClass: "Commodities", ticker: "ZW=F", cotMarket: "WHEAT", cotReport: "disaggregated" },
  { code: "ZS", name: "Soybeans", assetClass: "Commodities", ticker: "ZS=F", cotMarket: "SOYBEANS", cotReport: "disaggregated" },
];

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mu = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mu) ** 2, 0) / (values.length - 1));
}

function round(value: number | null, digits = 3): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.trim().replace(/^"|"$/g, "").replace(/,/g, "");
  if (!cleaned || cleaned === ".") return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

function marketMatches(rowName: string, target: string): boolean {
  const row = rowName.toUpperCase();
  const needle = target.toUpperCase();
  if (row.includes(needle)) return true;
  const compactRow = row.replace(/[^A-Z0-9]/g, "");
  const compactNeedle = needle.replace(/[^A-Z0-9]/g, "");
  return compactRow.includes(compactNeedle);
}

function periodStart(period: CTAPeriod): string {
  if (period === "max") return "2000-01-01";
  const years = Number(period.replace("y", ""));
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) out.push(closes[i] / closes[i - 1] - 1);
  }
  return out;
}

function pctReturn(closes: number[], lookback: number): number | null {
  if (closes.length <= lookback || closes[closes.length - lookback - 1] <= 0) return null;
  return closes[closes.length - 1] / closes[closes.length - lookback - 1] - 1;
}

function computeTrend(closes: number[]) {
  const returns = dailyReturns(closes);
  const components: CTARow["components"] = {};
  let rawTrend = 0;

  for (const [lookback, weight] of LOOKBACKS) {
    const ret = pctReturn(closes, lookback);
    const window = returns.slice(-lookback);
    const windowVol = std(window) * Math.sqrt(Math.max(lookback, 1));
    const z = ret != null && windowVol > 0 ? ret / windowVol : 0;
    rawTrend += weight * z;
    components[`${lookback}d`] = { return: round(ret, 4), z: round(z) ?? 0, weight };
  }

  return {
    rawTrend,
    trendSignal: Math.tanh(rawTrend / 2),
    components,
  };
}

function computeExposure(closes: number[], targetVol: number) {
  const trend = computeTrend(closes);
  const returns = dailyReturns(closes);
  const realizedVol60d = std(returns.slice(-60)) * Math.sqrt(252);
  const volScale = realizedVol60d > 0 ? clamp(targetVol / realizedVol60d, 0, 1.5) : 0;
  const exposure = clamp(trend.trendSignal * volScale, -1, 1);

  return {
    rawTrend: round(trend.rawTrend) ?? 0,
    trendSignal: round(trend.trendSignal) ?? 0,
    realizedVol60d: round(realizedVol60d, 4),
    targetVol,
    volScale: round(volScale) ?? 0,
    modelExposure: round(exposure) ?? 0,
    finalCta: round(exposure) ?? 0,
    components: trend.components,
  };
}

interface COTPoint {
  market: string;
  reportDate: string;
  long: number;
  short: number;
  spread: number;
  net: number;
  openInterest: number;
  netPctOi: number;
}

async function fetchCOTText(report: "disaggregated" | "financial"): Promise<string> {
  const url = report === "disaggregated"
    ? "https://www.cftc.gov/dea/newcot/f_disagg.txt"
    : "https://www.cftc.gov/dea/newcot/FinFutWk.txt";
  const resp = await fetch(url, { next: { revalidate: 6 * 60 * 60 } });
  if (!resp.ok) throw new Error(`CFTC ${report} fetch failed: HTTP ${resp.status}`);
  return resp.text();
}

async function fetchCOTHistory(
  report: "disaggregated" | "financial",
  marketName: string
): Promise<COTPoint[]> {
  const text = await fetchCOTText(report);
  const rows: COTPoint[] = [];

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!cols.length || !marketMatches(cols[0], marketName)) continue;

    const openInterest = parseNumber(cols[7]);
    const reportDate = (cols[2] || "").trim().replace(/^"|"$/g, "");
    let long = 0;
    let short = 0;
    let spread = 0;

    if (report === "disaggregated") {
      long = parseNumber(cols[13]);
      short = parseNumber(cols[14]);
      spread = parseNumber(cols[15]);
    } else {
      long = parseNumber(cols[14]);
      short = parseNumber(cols[15]);
      spread = parseNumber(cols[16]);
    }

    if (!openInterest || !reportDate) continue;
    const net = long - short;
    rows.push({
      market: cols[0].replace(/^"|"$/g, ""),
      reportDate,
      long,
      short,
      spread,
      net,
      openInterest,
      netPctOi: net / openInterest,
    });
  }

  rows.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  return rows;
}

async function getCOTSnapshot(market: CTAMarket): Promise<COTSnapshot | null> {
  if (!market.cotMarket || !market.cotReport) return null;

  const history = await fetchCOTHistory(market.cotReport, market.cotMarket);
  if (!history.length) return null;

  const latest = history[history.length - 1];
  const series = history.map((p) => p.netPctOi);
  const sigma = std(series);
  const zScore = sigma > 0 ? (latest.netPctOi - mean(series)) / sigma : null;
  const signal = zScore == null ? null : Math.tanh(zScore / 2);

  return {
    report: market.cotReport === "disaggregated" ? "Disaggregated" : "TFF",
    proxy: market.cotReport === "disaggregated" ? "Managed Money" : "Leveraged Funds",
    market: latest.market,
    reportDate: latest.reportDate,
    long: latest.long,
    short: latest.short,
    spread: latest.spread,
    net: latest.net,
    openInterest: latest.openInterest,
    netPctOi: round(latest.netPctOi, 4) ?? latest.netPctOi,
    zScore: round(zScore),
    signal: round(signal),
    historyWeeks: history.length,
  };
}

function blendCOT(modelExposure: number, cot: COTSnapshot | null): number {
  if (cot?.signal == null) return modelExposure;
  return round(0.7 * modelExposure + 0.3 * cot.signal) ?? modelExposure;
}

function classify(exposure: number, flowDown2Pct: number | null, flowUp2Pct: number | null): string {
  const absExp = Math.abs(exposure);
  const base = absExp >= 0.7
    ? exposure > 0 ? "Max Long" : "Max Short"
    : absExp >= 0.25
      ? exposure > 0 ? "Long" : "Short"
      : "Neutral";

  if (exposure > 0.25 && flowDown2Pct != null && flowDown2Pct < -0.25) return `${base} / downside convexity`;
  if (exposure < -0.25 && flowUp2Pct != null && flowUp2Pct > 0.25) return `${base} / squeeze risk`;
  return base;
}

function classifyFlowRegime(
  exposure: number,
  oneMonthChange: number | null,
  flowDown2Pct: number | null,
  flowUp2Pct: number | null
): string {
  if (oneMonthChange != null && exposure > 0.25 && oneMonthChange < -0.15) {
    return "Long but reducing";
  }
  if (oneMonthChange != null && exposure < -0.25 && oneMonthChange > 0.15) {
    return "Short covering";
  }
  if (flowDown2Pct != null && flowDown2Pct < -0.25) {
    return "Downside amplifier";
  }
  if (flowUp2Pct != null && flowUp2Pct > 0.25) {
    return "Upside squeeze fuel";
  }
  if (Math.abs(exposure) < 0.25) {
    return "Neutral / choppy";
  }
  return exposure > 0 ? "Stable long" : "Stable short";
}

function scanTrigger(
  closes: number[],
  currentExposure: number,
  targetVol: number,
  cot: COTSnapshot | null,
  mode: "flip" | "derisk"
): number | null {
  if (Math.abs(currentExposure) < 0.05) return null;

  const last = closes[closes.length - 1];
  for (let bp = -2000; bp <= 2000; bp += 25) {
    const shock = bp / 10000;
    if (shock === 0) continue;
    const shocked = closes.slice(0, -1).concat(last * (1 + shock));
    const exposure = blendCOT(computeExposure(shocked, targetVol).modelExposure, cot);

    if (mode === "flip" && exposure * currentExposure <= 0) return round(shock, 4);
    if (mode === "derisk") {
      const sameDirection = exposure * currentExposure > 0;
      const halfSized = Math.abs(exposure) <= Math.abs(currentExposure) * 0.5;
      const adverseForLong = currentExposure > 0 && shock < 0;
      const adverseForShort = currentExposure < 0 && shock > 0;
      if (sameDirection && halfSized && (adverseForLong || adverseForShort)) return round(shock, 4);
    }
  }
  return null;
}

function normalizeHistory(rows: unknown[]): { close: number; date: string }[] {
  return rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      const rawClose = Number(r.close ?? r.adjClose ?? r.adjclose);
      const rawDate = r.date instanceof Date ? r.date.toISOString() : String(r.date ?? "");
      return { close: rawClose, date: rawDate.slice(0, 10) };
    })
    .filter((r) => Number.isFinite(r.close) && r.close > 0 && r.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function analyzeMarket(market: CTAMarket, targetVol: number, period: CTAPeriod): Promise<CTARow> {
  const [historyRaw, cot] = await Promise.all([
    cachedHistorical(market.ticker, periodStart(period), "1d"),
    getCOTSnapshot(market).catch(() => null),
  ]);
  const history = normalizeHistory(historyRaw);
  if (history.length < 260) throw new Error(`insufficient history: ${history.length} closes`);

  const closes = history.map((r) => r.close);
  const current = computeExposure(closes, targetVol);
  const exposure = blendCOT(current.modelExposure, cot);
  const lastPrice = closes[closes.length - 1];

  const shockGrid: CTARow["shockGrid"] = {};
  for (const shock of SHOCKS) {
    const shocked = closes.slice(0, -1).concat(lastPrice * (1 + shock));
    const shockedExposure = blendCOT(computeExposure(shocked, targetVol).modelExposure, cot);
    shockGrid[`${shock > 0 ? "+" : ""}${Math.round(shock * 100)}%`] = {
      exposure: shockedExposure,
      flow: round(shockedExposure - exposure) ?? 0,
    };
  }

  const oneDayChange = closes.length > 260
    ? round(exposure - blendCOT(computeExposure(closes.slice(0, -1), targetVol).modelExposure, cot))
    : null;
  const fiveDayChange = closes.length > 265
    ? round(exposure - blendCOT(computeExposure(closes.slice(0, -5), targetVol).modelExposure, cot))
    : null;
  const oneMonthAgo = closes.length > 281
    ? blendCOT(computeExposure(closes.slice(0, -21), targetVol).modelExposure, cot)
    : null;
  const oneMonthChange = oneMonthAgo != null ? round(exposure - oneMonthAgo) : null;
  const flowDown2Pct = shockGrid["-2%"]?.flow ?? null;
  const flowUp2Pct = shockGrid["+2%"]?.flow ?? null;

  return {
    code: market.code,
    name: market.name,
    assetClass: market.assetClass,
    ticker: market.ticker,
    price: round(lastPrice, 4) ?? lastPrice,
    asOf: history[history.length - 1].date,
    ...current,
    finalCta: exposure,
    cot,
    oneDayChange,
    fiveDayChange,
    oneMonthAgo,
    oneMonthChange,
    flipShock: scanTrigger(closes, exposure, targetVol, cot, "flip"),
    deriskShock: scanTrigger(closes, exposure, targetVol, cot, "derisk"),
    flowDown2Pct,
    flowUp2Pct,
    classification: classify(exposure, flowDown2Pct, flowUp2Pct),
    flowRegime: classifyFlowRegime(exposure, oneMonthChange, flowDown2Pct, flowUp2Pct),
    dealerGammaRegime: "unknown",
    shockGrid,
  };
}

export async function buildCTADashboard({
  assetClass,
  targetVol = DEFAULT_TARGET_VOL,
  period = "3y",
}: {
  assetClass?: CTAAssetClass | "All" | null;
  targetVol?: number;
  period?: CTAPeriod;
} = {}): Promise<CTADashboard> {
  const safeTargetVol = clamp(Number(targetVol) || DEFAULT_TARGET_VOL, 0.02, 0.6);
  const selected = assetClass && assetClass !== "All"
    ? CTA_MARKETS.filter((m) => m.assetClass === assetClass)
    : CTA_MARKETS;

  const settled = await Promise.allSettled(selected.map((m) => analyzeMarket(m, safeTargetVol, period)));
  const rows: CTARow[] = [];
  const errors: CTADashboard["errors"] = [];

  settled.forEach((result, idx) => {
    const market = selected[idx];
    if (result.status === "fulfilled") rows.push(result.value);
    else errors.push({
      code: market.code,
      ticker: market.ticker,
      assetClass: market.assetClass,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });

  rows.sort((a, b) => a.assetClass.localeCompare(b.assetClass) || Math.abs(b.finalCta) - Math.abs(a.finalCta));

  const fragile = rows.filter((r) =>
    (r.flowDown2Pct != null && r.flowDown2Pct < -0.25) ||
    (r.flowUp2Pct != null && r.flowUp2Pct > 0.25)
  );

  return {
    generatedAt: new Date().toISOString(),
    targetVol: safeTargetVol,
    period,
    method: "70% daily trend/vol model + 30% weekly CFTC COT signal when available",
    rows,
    errors,
    summary: {
      markets: rows.length,
      crowded: rows.filter((r) => Math.abs(r.finalCta) >= 0.7).length,
      fragile: fragile.length,
      netExposure: round(mean(rows.map((r) => r.finalCta))) ?? 0,
      grossExposure: round(mean(rows.map((r) => Math.abs(r.finalCta)))) ?? 0,
      cotCoverage: rows.filter((r) => r.cot?.signal != null).length,
      reducing: rows.filter((r) => r.oneMonthChange != null && r.oneMonthChange < -0.15).length,
      covering: rows.filter((r) => r.oneMonthChange != null && r.oneMonthChange > 0.15).length,
    },
  };
}
