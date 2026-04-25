import { cachedHistorical } from "@/lib/yf-cache";

export type CTAAssetClass = "Equities" | "Rates" | "FX" | "Commodities";

export interface CTAMarket {
  code: string;
  name: string;
  assetClass: CTAAssetClass;
  ticker: string;
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
  oneDayChange: number | null;
  fiveDayChange: number | null;
  flipShock: number | null;
  deriskShock: number | null;
  flowDown2Pct: number | null;
  flowUp2Pct: number | null;
  classification: string;
  components: Record<string, { return: number | null; z: number; weight: number }>;
  shockGrid: Record<string, { exposure: number; flow: number }>;
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
  };
}

type CTAPeriod = "1y" | "2y" | "3y" | "5y" | "max";

const LOOKBACKS: [number, number][] = [[21, 0.2], [63, 0.3], [126, 0.3], [252, 0.2]];
const SHOCKS = [-0.05, -0.03, -0.02, -0.01, 0.01, 0.02, 0.03, 0.05];
const DEFAULT_TARGET_VOL = 0.15;

export const CTA_MARKETS: CTAMarket[] = [
  { code: "ES", name: "S&P 500 E-mini", assetClass: "Equities", ticker: "ES=F" },
  { code: "NQ", name: "Nasdaq 100 E-mini", assetClass: "Equities", ticker: "NQ=F" },
  { code: "RTY", name: "Russell 2000 E-mini", assetClass: "Equities", ticker: "RTY=F" },
  { code: "YM", name: "Dow E-mini", assetClass: "Equities", ticker: "YM=F" },
  { code: "ZN", name: "US 10Y Note", assetClass: "Rates", ticker: "ZN=F" },
  { code: "ZF", name: "US 5Y Note", assetClass: "Rates", ticker: "ZF=F" },
  { code: "ZB", name: "US 30Y Bond", assetClass: "Rates", ticker: "ZB=F" },
  { code: "DX", name: "US Dollar Index", assetClass: "FX", ticker: "DX-Y.NYB" },
  { code: "EURUSD", name: "Euro / US Dollar", assetClass: "FX", ticker: "EURUSD=X" },
  { code: "USDJPY", name: "US Dollar / Yen", assetClass: "FX", ticker: "JPY=X" },
  { code: "GBPUSD", name: "British Pound / US Dollar", assetClass: "FX", ticker: "GBPUSD=X" },
  { code: "AUDUSD", name: "Australian Dollar / US Dollar", assetClass: "FX", ticker: "AUDUSD=X" },
  { code: "CL", name: "WTI Crude Oil", assetClass: "Commodities", ticker: "CL=F" },
  { code: "BZ", name: "Brent Crude Oil", assetClass: "Commodities", ticker: "BZ=F" },
  { code: "GC", name: "Gold", assetClass: "Commodities", ticker: "GC=F" },
  { code: "SI", name: "Silver", assetClass: "Commodities", ticker: "SI=F" },
  { code: "HG", name: "Copper", assetClass: "Commodities", ticker: "HG=F" },
  { code: "NG", name: "Natural Gas", assetClass: "Commodities", ticker: "NG=F" },
  { code: "ZC", name: "Corn", assetClass: "Commodities", ticker: "ZC=F" },
  { code: "ZW", name: "Wheat", assetClass: "Commodities", ticker: "ZW=F" },
  { code: "ZS", name: "Soybeans", assetClass: "Commodities", ticker: "ZS=F" },
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

function scanTrigger(
  closes: number[],
  currentExposure: number,
  targetVol: number,
  mode: "flip" | "derisk"
): number | null {
  if (Math.abs(currentExposure) < 0.05) return null;

  const last = closes[closes.length - 1];
  for (let bp = -2000; bp <= 2000; bp += 25) {
    const shock = bp / 10000;
    if (shock === 0) continue;
    const shocked = closes.slice(0, -1).concat(last * (1 + shock));
    const exposure = computeExposure(shocked, targetVol).finalCta;

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
  const history = normalizeHistory(await cachedHistorical(market.ticker, periodStart(period), "1d"));
  if (history.length < 260) throw new Error(`insufficient history: ${history.length} closes`);

  const closes = history.map((r) => r.close);
  const current = computeExposure(closes, targetVol);
  const exposure = current.finalCta;
  const lastPrice = closes[closes.length - 1];

  const shockGrid: CTARow["shockGrid"] = {};
  for (const shock of SHOCKS) {
    const shocked = closes.slice(0, -1).concat(lastPrice * (1 + shock));
    const shockedExposure = computeExposure(shocked, targetVol).finalCta;
    shockGrid[`${shock > 0 ? "+" : ""}${Math.round(shock * 100)}%`] = {
      exposure: shockedExposure,
      flow: round(shockedExposure - exposure) ?? 0,
    };
  }

  const oneDayChange = closes.length > 260 ? round(exposure - computeExposure(closes.slice(0, -1), targetVol).finalCta) : null;
  const fiveDayChange = closes.length > 265 ? round(exposure - computeExposure(closes.slice(0, -5), targetVol).finalCta) : null;
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
    oneDayChange,
    fiveDayChange,
    flipShock: scanTrigger(closes, exposure, targetVol, "flip"),
    deriskShock: scanTrigger(closes, exposure, targetVol, "derisk"),
    flowDown2Pct,
    flowUp2Pct,
    classification: classify(exposure, flowDown2Pct, flowUp2Pct),
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
    method: "multi-lookback trend signal + 60d volatility targeting; COT calibration reserved",
    rows,
    errors,
    summary: {
      markets: rows.length,
      crowded: rows.filter((r) => Math.abs(r.finalCta) >= 0.7).length,
      fragile: fragile.length,
      netExposure: round(mean(rows.map((r) => r.finalCta))) ?? 0,
      grossExposure: round(mean(rows.map((r) => Math.abs(r.finalCta)))) ?? 0,
    },
  };
}
