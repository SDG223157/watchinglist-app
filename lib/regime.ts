/**
 * Cross-sectional regime engine — TypeScript port of
 * botboard-private/scripts/{cross_sectional_entropy,cross_sectional_momentum}.py
 *
 * Transforms price into rolling log return x_t = log(P_t / P_{t-window}), then
 * at each date computes:
 *    - cross-sectional Shannon entropy of x_t distribution (Layer 2)
 *    - top-minus-bottom decile forward-return spread (Layer 3)
 *
 * Regimes: COLLAPSE | COMPRESSED | NORMAL | DIVERSE | MAX_DISPERSION.
 * Tilt rules: MOMENTUM | MOMENTUM_FADING | MILD_MOMENTUM |
 *             NEUTRAL_DEFENSIVE | REVERSION.
 */

import { cachedHistorical } from "./yf-cache";

const NUM_BINS = 20;
const DEFAULT_SIGNAL = 30;
const DEFAULT_HORIZON = 30;
const DEFAULT_MIN_STOCKS = 30;
const DEFAULT_YEARS = 5;
const N_DECILES = 10;

export type Regime = "COLLAPSE" | "COMPRESSED" | "NORMAL" | "DIVERSE" | "MAX_DISPERSION";
export type Tilt =
  | "MOMENTUM"
  | "MOMENTUM_FADING"
  | "MILD_MOMENTUM"
  | "NEUTRAL_DEFENSIVE"
  | "REVERSION";

const TILT_RULES: Record<Regime, { tilt: Tilt; rationale: string }> = {
  COLLAPSE: {
    tilt: "NEUTRAL_DEFENSIVE",
    rationale: "Correlation collapse — factor bets unreliable. Cut gross, avoid leverage.",
  },
  COMPRESSED: {
    tilt: "MOMENTUM",
    rationale: "Coiled spring. Historical base rate strongest — tilt to top decile.",
  },
  NORMAL: {
    tilt: "MILD_MOMENTUM",
    rationale: "Base rate momentum. Small tilt, size modestly.",
  },
  DIVERSE: {
    tilt: "MOMENTUM_FADING",
    rationale: "Still positive but late-stage. Trim winners into strength.",
  },
  MAX_DISPERSION: {
    tilt: "REVERSION",
    rationale: "Spent system. Fade winners, buy losers.",
  },
};

function shannonEntropy(values: number[], bins = NUM_BINS): number {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 5) return NaN;
  const vmin = Math.min(...clean);
  const vmax = Math.max(...clean);
  if (vmax === vmin) return 0;
  const counts = new Array(bins).fill(0);
  const range = vmax - vmin;
  for (const v of clean) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(((v - vmin) / range) * bins)));
    counts[idx]++;
  }
  const n = clean.length;
  let h = 0;
  for (const c of counts) {
    if (c > 0) {
      const p = c / n;
      h -= p * Math.log2(p);
    }
  }
  return h / Math.log2(bins);
}

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}
function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(s.length - 1, Math.floor((p / 100) * s.length)));
  return s[idx];
}
function percentileRankInPlace(xs: number[], target: number): number {
  let lt = 0;
  for (const v of xs) if (v <= target) lt++;
  return (lt / xs.length) * 100;
}

interface PriceBar { date: string; close: number; }

interface StockHistory {
  symbol: string;
  dates: string[];
  closes: number[];
}

async function fetchStockHistory(symbol: string, years: number): Promise<StockHistory | null> {
  try {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    const since = d.toISOString().split("T")[0];
    const raw = (await cachedHistorical(symbol, since)) as {
      date: Date | string; close?: number;
    }[];
    const rows: PriceBar[] = [];
    for (const r of raw) {
      if (r.close == null || !Number.isFinite(r.close) || r.close <= 0) continue;
      const dateStr = r.date instanceof Date ? r.date.toISOString().split("T")[0] : String(r.date).split("T")[0];
      rows.push({ date: dateStr, close: r.close });
    }
    if (rows.length < 252) return null;
    return {
      symbol,
      dates: rows.map((r) => r.date),
      closes: rows.map((r) => r.close),
    };
  } catch {
    return null;
  }
}

interface Panel {
  dates: string[];                          // sorted union of dates
  closesBySymbol: Map<string, Map<string, number>>; // symbol -> date -> close
  symbols: string[];
}

function buildPanel(histories: StockHistory[]): Panel {
  const dateSet = new Set<string>();
  const closesBySymbol = new Map<string, Map<string, number>>();
  for (const h of histories) {
    const m = new Map<string, number>();
    for (let i = 0; i < h.dates.length; i++) {
      m.set(h.dates[i], h.closes[i]);
      dateSet.add(h.dates[i]);
    }
    closesBySymbol.set(h.symbol, m);
  }
  const dates = [...dateSet].sort();
  return { dates, closesBySymbol, symbols: histories.map((h) => h.symbol) };
}

/** For date t and window w, rolling log return uses close at t and close at trading-day t-w. */
function rollingReturn(priceMap: Map<string, number>, dates: string[], t: number, window: number): number | null {
  if (t < window) return null;
  const pNow = priceMap.get(dates[t]);
  const pPast = priceMap.get(dates[t - window]);
  if (pNow == null || pPast == null || pPast <= 0 || pNow <= 0) return null;
  return Math.log(pNow / pPast);
}

export interface CrossSectionRow {
  date: string;
  n_stocks: number;
  mean: number;
  median: number;
  std: number;
  entropy: number;
  frac_positive: number;
  p10: number;
  p90: number;
}

export interface AnnotatedRow extends CrossSectionRow {
  entropy_pctile: number;
  std_pctile: number;
  regime: Regime;
  regime_streak: number;
}

function labelRegime(entropyPctile: number): Regime {
  if (entropyPctile <= 10) return "COLLAPSE";
  if (entropyPctile <= 25) return "COMPRESSED";
  if (entropyPctile >= 90) return "MAX_DISPERSION";
  if (entropyPctile >= 75) return "DIVERSE";
  return "NORMAL";
}

function buildCrossSectionalSeries(
  panel: Panel,
  signalWin: number,
  minStocks: number,
): CrossSectionRow[] {
  const rows: CrossSectionRow[] = [];
  const dates = panel.dates;
  for (let t = signalWin; t < dates.length; t++) {
    const xs: number[] = [];
    for (const sym of panel.symbols) {
      const m = panel.closesBySymbol.get(sym)!;
      const r = rollingReturn(m, dates, t, signalWin);
      if (r != null && Number.isFinite(r)) xs.push(r);
    }
    if (xs.length < minStocks) continue;
    const posCount = xs.reduce((s, v) => s + (v > 0 ? 1 : 0), 0);
    rows.push({
      date: dates[t],
      n_stocks: xs.length,
      mean: mean(xs),
      median: median(xs),
      std: std(xs),
      entropy: shannonEntropy(xs),
      frac_positive: posCount / xs.length,
      p10: percentile(xs, 10),
      p90: percentile(xs, 90),
    });
  }
  return rows;
}

function annotate(rows: CrossSectionRow[]): AnnotatedRow[] {
  const entropies = rows.map((r) => r.entropy);
  const stds = rows.map((r) => r.std);
  const annotated: AnnotatedRow[] = rows.map((r) => {
    const ep = percentileRankInPlace(entropies, r.entropy);
    const sp = percentileRankInPlace(stds, r.std);
    return { ...r, entropy_pctile: ep, std_pctile: sp, regime: labelRegime(ep), regime_streak: 1 };
  });
  let curr: Regime | null = null;
  let run = 0;
  for (const r of annotated) {
    if (r.regime === curr) run += 1;
    else { curr = r.regime; run = 1; }
    r.regime_streak = run;
  }
  return annotated;
}

export interface MomentumRow {
  date: string;
  n_stocks: number;
  signal_entropy: number;
  top_decile_fwd: number;
  bot_decile_fwd: number;
  spread: number;
  spearman: number;
  regime: Regime;        // inherited from Layer 2 on same date
}

function rank(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  for (let i = 0; i < indexed.length; i++) ranks[indexed[i].i] = i + 1;
  return ranks;
}

function spearman(xs: number[], ys: number[]): number {
  if (xs.length < 3) return 0;
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const meanR = (n + 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - meanR;
    const b = ry[i] - meanR;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const d = Math.sqrt(dx * dy);
  return d > 0 ? num / d : 0;
}

function buildMomentumSeries(
  panel: Panel,
  signalWin: number,
  horizon: number,
  minStocks: number,
  layer2ByDate: Map<string, AnnotatedRow>,
): MomentumRow[] {
  const rows: MomentumRow[] = [];
  const dates = panel.dates;
  for (let t = signalWin; t < dates.length - horizon; t++) {
    const signals: number[] = [];
    const futures: number[] = [];
    const valid: string[] = [];
    for (const sym of panel.symbols) {
      const m = panel.closesBySymbol.get(sym)!;
      const s = rollingReturn(m, dates, t, signalWin);
      const f = rollingReturn(m, dates, t + horizon, horizon);
      if (s != null && f != null && Number.isFinite(s) && Number.isFinite(f)) {
        signals.push(s);
        futures.push(f);
        valid.push(sym);
      }
    }
    if (signals.length < minStocks) continue;
    const ranks = rank(signals);
    const n = signals.length;
    const perDecile = n / N_DECILES;
    const topCut = (N_DECILES - 1) * perDecile;
    const botCut = perDecile;
    const topVals: number[] = [];
    const botVals: number[] = [];
    for (let i = 0; i < n; i++) {
      if (ranks[i] > topCut) topVals.push(futures[i]);
      else if (ranks[i] <= botCut) botVals.push(futures[i]);
    }
    if (topVals.length === 0 || botVals.length === 0) continue;
    const spread = mean(topVals) - mean(botVals);
    const annot = layer2ByDate.get(dates[t]);
    rows.push({
      date: dates[t],
      n_stocks: n,
      signal_entropy: shannonEntropy(signals),
      top_decile_fwd: mean(topVals),
      bot_decile_fwd: mean(botVals),
      spread,
      spearman: spearman(signals, futures),
      regime: annot ? annot.regime : "NORMAL",
    });
  }
  return rows;
}

export interface ConditionalRow {
  regime: Regime;
  count: number;
  mean_spread: number;
  median_spread: number;
  hit_rate: number;
  mean_rho: number;
}

const REGIME_ORDER: Regime[] = ["COLLAPSE", "COMPRESSED", "NORMAL", "DIVERSE", "MAX_DISPERSION"];

function conditionalStats(rows: MomentumRow[]): ConditionalRow[] {
  const buckets = new Map<Regime, MomentumRow[]>();
  for (const r of rows) {
    if (!buckets.has(r.regime)) buckets.set(r.regime, []);
    buckets.get(r.regime)!.push(r);
  }
  const out: ConditionalRow[] = [];
  for (const reg of REGIME_ORDER) {
    const b = buckets.get(reg) ?? [];
    if (b.length === 0) continue;
    const spreads = b.map((r) => r.spread);
    const rhos = b.map((r) => r.spearman);
    out.push({
      regime: reg,
      count: b.length,
      mean_spread: mean(spreads),
      median_spread: median(spreads),
      hit_rate: spreads.reduce((s, v) => s + (v > 0 ? 1 : 0), 0) / spreads.length,
      mean_rho: mean(rhos),
    });
  }
  return out;
}

export interface DecileStock { symbol: string; past_return_pct: number; last_price: number; }

function currentSnapshot(
  panel: Panel,
  signalWin: number,
  topN: number,
): { as_of: string; n_universe: number; top: DecileStock[]; bot: DecileStock[] } {
  const dates = panel.dates;
  const t = dates.length - 1;
  const rows: { symbol: string; ret: number; close: number }[] = [];
  for (const sym of panel.symbols) {
    const m = panel.closesBySymbol.get(sym)!;
    const r = rollingReturn(m, dates, t, signalWin);
    const px = m.get(dates[t]);
    if (r != null && Number.isFinite(r) && px != null) rows.push({ symbol: sym, ret: r, close: px });
  }
  rows.sort((a, b) => a.ret - b.ret);
  const bot = rows.slice(0, topN).map((r) => ({
    symbol: r.symbol, past_return_pct: r.ret * 100, last_price: r.close,
  }));
  const top = rows.slice(-topN).reverse().map((r) => ({
    symbol: r.symbol, past_return_pct: r.ret * 100, last_price: r.close,
  }));
  return { as_of: dates[t], n_universe: rows.length, top, bot };
}

export interface Tilts {
  date: string;
  entropy_regime: Regime;
  entropy_pctile: number;
  dispersion_pctile: number;
  regime_streak_days: number;
  mean_30d_return_pct: number;
  dispersion_pct: number;
  frac_positive: number;
  tilt: Tilt;
  rationale: string;
  conditional_expected_spread_pct: number | null;
  conditional_hit_rate_pct: number | null;
  conditional_n_observations: number;
}

function synthesizeTilt(layer2: AnnotatedRow[], cond: ConditionalRow[]): Tilts {
  const cur = layer2[layer2.length - 1];
  const regime = cur.regime;
  const rule = TILT_RULES[regime];
  const c = cond.find((r) => r.regime === regime);
  return {
    date: cur.date,
    entropy_regime: regime,
    entropy_pctile: round(cur.entropy_pctile, 1),
    dispersion_pctile: round(cur.std_pctile, 1),
    regime_streak_days: cur.regime_streak,
    mean_30d_return_pct: round(cur.mean * 100, 2),
    dispersion_pct: round(cur.std * 100, 2),
    frac_positive: round(cur.frac_positive * 100, 1),
    tilt: rule.tilt,
    rationale: rule.rationale,
    conditional_expected_spread_pct: c ? round(c.mean_spread * 100, 2) : null,
    conditional_hit_rate_pct: c ? round(c.hit_rate * 100, 1) : null,
    conditional_n_observations: c ? c.count : 0,
  };
}

function round(v: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

export interface RegimeResult {
  universe_label: string;
  signal_window: number;
  horizon: number;
  years: number;
  n_requested: number;
  n_resolved: number;
  computed_at: string;
  tilt: Tilts;
  conditional: ConditionalRow[];
  top_decile: DecileStock[];
  bot_decile: DecileStock[];
  last10: AnnotatedRow[];
}

export interface RegimeOptions {
  years?: number;
  signal?: number;
  horizon?: number;
  minStocks?: number;
  topN?: number;
  label?: string;
  concurrency?: number;
}

export async function runRegime(symbols: string[], opts: RegimeOptions = {}): Promise<RegimeResult> {
  const years = opts.years ?? DEFAULT_YEARS;
  const signalWin = opts.signal ?? DEFAULT_SIGNAL;
  const horizon = opts.horizon ?? DEFAULT_HORIZON;
  const minStocks = opts.minStocks ?? DEFAULT_MIN_STOCKS;
  const topN = opts.topN ?? 10;
  const concurrency = opts.concurrency ?? 8;
  const label = opts.label ?? "watchlist";

  const deduped = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const histories: StockHistory[] = [];
  for (let i = 0; i < deduped.length; i += concurrency) {
    const batch = deduped.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((sym) => fetchStockHistory(sym, years)));
    for (const h of results) if (h) histories.push(h);
  }
  if (histories.length < minStocks) {
    throw new Error(`Insufficient history: ${histories.length} stocks < minStocks=${minStocks}`);
  }

  const panel = buildPanel(histories);
  const xsRows = buildCrossSectionalSeries(panel, signalWin, minStocks);
  if (xsRows.length === 0) throw new Error("No cross-sectional observations.");
  const layer2 = annotate(xsRows);
  const layer2ByDate = new Map(layer2.map((r) => [r.date, r]));
  const layer3 = buildMomentumSeries(panel, signalWin, horizon, minStocks, layer2ByDate);
  const cond = conditionalStats(layer3);
  const snap = currentSnapshot(panel, signalWin, topN);
  const tilt = synthesizeTilt(layer2, cond);

  return {
    universe_label: label,
    signal_window: signalWin,
    horizon,
    years,
    n_requested: deduped.length,
    n_resolved: histories.length,
    computed_at: new Date().toISOString(),
    tilt,
    conditional: cond,
    top_decile: snap.top,
    bot_decile: snap.bot,
    last10: layer2.slice(-10),
  };
}

export function classifyMarket(symbol: string): "us" | "hk" | "cn" | "other" {
  const s = symbol.toUpperCase();
  if (s.endsWith(".HK")) return "hk";
  if (s.endsWith(".SS") || s.endsWith(".SZ")) return "cn";
  if (/^[A-Z.\-]+$/.test(s) && !s.includes(".")) return "us";
  return "other";
}
