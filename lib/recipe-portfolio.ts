/**
 * Recipe-Portfolio allocation engine.
 *
 * Applies three tools from quantitative finance to a watchlist universe:
 *   (1) Bayesian updating — blend the composite score as a prior on μ with
 *       observed 1Y daily excess returns.
 *   (2) Transfer Entropy (Schreiber 2000, histogram estimator) — directional
 *       information flow from each name to the portfolio-ex-name; used to
 *       separate anchor / follower / tactical tiers.
 *   (3) Vector Kelly with Ledoit-Wolf-shrunk covariance, quarter-Kelly
 *       fractionation, and three hard caps (per-name 7%, sector 30%,
 *       correlation-cluster 20% at ρ ≥ 0.7).
 *
 * Supports US / CHINA / HK / CN market partitions and a dish-rotation diff
 * that flags names to retire, resize, or add against a previous run.
 */

import type { WatchlistStock } from "./db";
import type { PolymarketTiltMap } from "./polymarket-tilts";
import { POLYMARKET_PRIOR_SLOPE } from "./polymarket-tilts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  riskFreeAnnual: 0.02,
  quarterKelly: 0.25,
  perNameCap: 0.07,
  sectorCap: 0.30,
  clusterCap: 0.20,
  clusterCorrThreshold: 0.70,
  priorSlope: 0.0024, // annual μ per score-point above 50
  priorConfidenceDays: 500,
  minHistoryDays: 150, // skip names with less history than this
  // Dish rotation thresholds
  retireWeightBelow: 0.005, // pipeline ejected — consider retiring
  retireTrailing60dReturn: -0.20, // hard cut if -20% over 60d AND below-median TE
  replaceTopN: 30,
} as const;

export type Config = typeof DEFAULT_CONFIG;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Tier = "anchor" | "follower" | "tactical" | "trim";

export interface RecipePosition {
  ticker: string;
  name: string;
  sector: string;
  market: string;
  score: number;
  action: string;
  priorMu: number;
  posteriorMu: number;
  bayesDiscount: number;
  leaderScore: number;
  kellyFull: number;
  quarterKelly: number;
  weight: number;
  tier: Tier;
  trailing60d: number;
  trailing1y: number;
  polymarketZ?: number;
  polymarketZLive?: number;
  polymarketTopReason?: string | null;
  polymarketDeltaMuPrior?: number;
}

export interface RotationDiff {
  added: string[];
  retired: { ticker: string; reason: string; prevWeight: number }[];
  resized: { ticker: string; prevWeight: number; newWeight: number; deltaPp: number }[];
}

export interface RecipeAllocation {
  asOf: string;
  market: string;
  universeSize: number;
  topN: number;
  invested: number;
  cashReserve: number;
  leaderThreshold: number;
  positions: RecipePosition[];
  sectorSummary: { sector: string; weight: number }[];
  tierSummary: { tier: Tier | "cash"; count: number; weight: number }[];
  rotation: RotationDiff | null;
  config: Config;
  polymarketOverlay?: {
    lambda: number;
    symbolsWithTilt: number;
    symbolsLive: number;
    maxAbsZ: number;
    maxAbsZLive: number;
    sumAbsZWeightedPct: number;
    sumAbsZLiveWeightedPct: number;
  };
}

// ---------------------------------------------------------------------------
// Matrix utilities (small-N; N ≤ 50 is fine for Gauss-Jordan)
// ---------------------------------------------------------------------------

type Matrix = number[][];

function zeros(n: number, m: number): Matrix {
  const M: Matrix = new Array(n);
  for (let i = 0; i < n; i++) M[i] = new Array(m).fill(0);
  return M;
}

function identity(n: number): Matrix {
  const I = zeros(n, n);
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
}

function matMul(A: Matrix, B: Matrix): Matrix {
  const n = A.length;
  const m = B[0].length;
  const k = B.length;
  const C = zeros(n, m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let p = 0; p < k; p++) s += A[i][p] * B[p][j];
      C[i][j] = s;
    }
  }
  return C;
}

function matVec(A: Matrix, x: number[]): number[] {
  const n = A.length;
  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < x.length; j++) s += A[i][j] * x[j];
    y[i] = s;
  }
  return y;
}

/**
 * Gauss-Jordan inversion with partial pivoting.
 * Adds a small ridge on the diagonal to guarantee invertibility
 * when the sample covariance is near-singular (common for N close
 * to the sample length).
 */
function invert(A: Matrix, ridge = 1e-6): Matrix {
  const n = A.length;
  const M = zeros(n, 2 * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i][j] = A[i][j];
    M[i][i] += ridge;
    M[i][n + i] = 1;
  }
  for (let col = 0; col < n; col++) {
    // Pivot
    let best = col;
    let bestAbs = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > bestAbs) {
        best = r;
        bestAbs = v;
      }
    }
    if (bestAbs < 1e-14) {
      // Singular even after ridge; bump and retry
      return invert(A, ridge * 10);
    }
    if (best !== col) {
      const tmp = M[col];
      M[col] = M[best];
      M[best] = tmp;
    }
    // Normalize pivot row
    const piv = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] /= piv;
    // Eliminate other rows
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[col][j];
    }
  }
  const inv = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) inv[i][j] = M[i][n + j];
  }
  return inv;
}

// ---------------------------------------------------------------------------
// Returns and statistics
// ---------------------------------------------------------------------------

/**
 * Daily log returns aligned across all tickers on the common date set.
 * Input: { ticker -> array of closes (newest last) }.
 * Output: aligned n × m matrix of log returns and the list of tickers used.
 *
 * Names with fewer than cfg.minHistoryDays of valid closes are dropped.
 */
export function alignedLogReturns(
  series: Record<string, number[]>,
  minHistory: number
): { tickers: string[]; returns: number[][] } {
  const keepTickers: string[] = [];
  const keepReturns: number[][] = [];
  let maxLen = 0;
  for (const t of Object.keys(series)) {
    const prices = (series[t] || []).filter((p) => p != null && p > 0);
    if (prices.length < minHistory) continue;
    const r: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      r.push(Math.log(prices[i] / prices[i - 1]));
    }
    keepTickers.push(t);
    keepReturns.push(r);
    if (r.length > maxLen) maxLen = r.length;
  }
  // Right-align to the shortest history so every column has the same length
  const minLen = keepReturns.reduce(
    (a, r) => Math.min(a, r.length),
    Number.POSITIVE_INFINITY
  );
  const aligned = keepReturns.map((r) => r.slice(r.length - minLen));
  return { tickers: keepTickers, returns: aligned };
}

function mean(x: number[]): number {
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}

function variance(x: number[]): number {
  const m = mean(x);
  let s = 0;
  for (const v of x) s += (v - m) * (v - m);
  return s / (x.length - 1);
}

// ---------------------------------------------------------------------------
// Ledoit-Wolf shrinkage to constant-correlation target
// ---------------------------------------------------------------------------

/**
 * Returns an annualized shrunk covariance matrix. Columns of `returns`
 * are daily log-return series of equal length.
 */
export function ledoitWolfCovariance(returns: number[][]): {
  cov: Matrix;
  correl: Matrix;
  variances: number[];
} {
  const n = returns.length; // number of names
  const t = returns[0].length; // number of observations
  // Means and centered returns
  const means = returns.map(mean);
  const X: Matrix = returns.map((r, i) => r.map((v) => v - means[i]));
  // Sample covariance (bias-corrected)
  const S = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let k = 0; k < t; k++) s += X[i][k] * X[j][k];
      const c = s / (t - 1);
      S[i][j] = c;
      S[j][i] = c;
    }
  }
  // Sample correlation
  const stds = new Array(n).fill(0).map((_, i) => Math.sqrt(Math.max(S[i][i], 1e-12)));
  const R = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      R[i][j] = S[i][j] / (stds[i] * stds[j]);
    }
  }
  // Average off-diagonal correlation (constant-correlation target)
  let rbar = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      rbar += R[i][j];
      pairs++;
    }
  }
  rbar /= Math.max(pairs, 1);
  const F = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      F[i][j] = i === j ? S[i][i] : rbar * stds[i] * stds[j];
    }
  }
  // Ledoit-Wolf optimal shrinkage intensity delta (simplified):
  //   delta = min(1, pi / (t * gamma))
  //   gamma = ||S - F||_F^2
  //   pi    = variance of sample covariance entries
  let pi = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let p = 0;
      for (let k = 0; k < t; k++) {
        const d = X[i][k] * X[j][k] - S[i][j];
        p += d * d;
      }
      pi += p / t;
    }
  }
  let gamma = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const d = S[i][j] - F[i][j];
      gamma += d * d;
    }
  }
  const delta = gamma > 0 ? Math.max(0, Math.min(1, pi / (t * gamma))) : 0;
  // Shrink
  const covDaily = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      covDaily[i][j] = delta * F[i][j] + (1 - delta) * S[i][j];
    }
  }
  // Annualize
  const cov = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) cov[i][j] = covDaily[i][j] * 252;
  }
  // Recompute correlation from shrunk covariance
  const annStds = new Array(n)
    .fill(0)
    .map((_, i) => Math.sqrt(Math.max(cov[i][i], 1e-12)));
  const correl = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      correl[i][j] = cov[i][j] / (annStds[i] * annStds[j]);
    }
  }
  return { cov, correl, variances: annStds.map((s) => s * s) };
}

// ---------------------------------------------------------------------------
// Transfer Entropy (Schreiber 2000, histogram estimator, 3 bins, k = 1)
// ---------------------------------------------------------------------------

function discretize(x: number[], nBins = 3): number[] {
  const sorted = [...x].sort((a, b) => a - b);
  const q: number[] = [];
  for (let i = 1; i < nBins; i++) {
    const idx = Math.floor((sorted.length * i) / nBins);
    q.push(sorted[Math.min(idx, sorted.length - 1)]);
  }
  return x.map((v) => {
    let b = 0;
    for (let i = 0; i < q.length; i++) if (v > q[i]) b = i + 1;
    return b;
  });
}

export function transferEntropy(
  source: number[],
  target: number[],
  k = 1,
  nBins = 3
): number {
  if (source.length !== target.length || source.length < k + 20) return 0;
  const s = discretize(source, nBins);
  const t = discretize(target, nBins);
  const n = s.length - k;
  // Count joint occurrences (y_next, y_hist, x_hist) and marginals
  const idx = (a: number, b: number, c: number) =>
    a * nBins * nBins + b * nBins + c;
  const cntXYZ = new Int32Array(nBins * nBins * nBins);
  const cntYN_Y = new Int32Array(nBins * nBins); // (y_next, y_hist)
  const cntY_X = new Int32Array(nBins * nBins); // (y_hist, x_hist)
  const cntY = new Int32Array(nBins); // y_hist marginal
  for (let i = 0; i < n; i++) {
    const yn = t[i + k];
    const yh = t[i];
    const xh = s[i];
    cntXYZ[idx(yn, yh, xh)]++;
    cntYN_Y[yn * nBins + yh]++;
    cntY_X[yh * nBins + xh]++;
    cntY[yh]++;
  }
  let te = 0;
  for (let yn = 0; yn < nBins; yn++) {
    for (let yh = 0; yh < nBins; yh++) {
      for (let xh = 0; xh < nBins; xh++) {
        const c = cntXYZ[idx(yn, yh, xh)];
        if (c === 0) continue;
        const pJoint = c / n;
        const cYX = cntY_X[yh * nBins + xh];
        const cY = cntY[yh];
        const pCondXY = cYX > 0 ? c / cYX : 0;
        const pCondY = cY > 0 ? cntYN_Y[yn * nBins + yh] / cY : 0;
        if (pCondXY > 0 && pCondY > 0) {
          te += pJoint * Math.log(pCondXY / pCondY);
        }
      }
    }
  }
  return Math.max(0, te);
}

/**
 * For each name i compute TE from i into the portfolio-ex-i (mean of the
 * rest). Returns array aligned to `returns`. Uses tercile discretization.
 */
function leaderScores(returns: number[][]): number[] {
  const n = returns.length;
  const t = returns[0].length;
  const scores = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const rest = new Array(t).fill(0);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      for (let k = 0; k < t; k++) rest[k] += returns[j][k];
    }
    for (let k = 0; k < t; k++) rest[k] /= n - 1;
    scores[i] = transferEntropy(returns[i], rest);
  }
  return scores;
}

// ---------------------------------------------------------------------------
// Bayesian μ blend
// ---------------------------------------------------------------------------

function blendedMu(
  returns: number[][],
  scores: number[],
  cfg: Config,
  polymarketDeltas?: number[]
): { mu: number[]; prior: number[]; obs: number[] } {
  const rfDaily = cfg.riskFreeAnnual / 252;
  const priorBase = scores.map((s) => (s - 50) * cfg.priorSlope);
  const prior = polymarketDeltas
    ? priorBase.map((p, i) => p + (polymarketDeltas[i] || 0))
    : priorBase;
  const obs = returns.map((r) => (mean(r) - rfDaily) * 252);
  const nObs = returns[0].length;
  const pp = cfg.priorConfidenceDays;
  const mu = prior.map(
    (p, i) => (p * pp + obs[i] * nObs) / (pp + nObs)
  );
  return { mu, prior, obs };
}

function bayesWidthDiscount(returns: number[][]): number[] {
  return returns.map((r) => {
    const m = mean(r);
    const v = variance(r);
    const se = Math.sqrt(v / r.length);
    if (Math.abs(m) < 1e-10) return 0;
    const ratio = se / Math.abs(m);
    return Math.max(0, Math.min(1, 1 - ratio));
  });
}

// ---------------------------------------------------------------------------
// Cap stack
// ---------------------------------------------------------------------------

function applyCaps(
  raw: number[],
  sectors: string[],
  correl: Matrix,
  cfg: Config
): number[] {
  const n = raw.length;
  // Long-only projection + normalize
  let w = raw.map((x) => Math.max(0, x));
  const total = w.reduce((a, b) => a + b, 0);
  if (total > 0) w = w.map((x) => x / total);
  // Per-name cap
  w = w.map((x) => Math.min(cfg.perNameCap, x));
  // Sector cap
  const sectorIdx: Record<string, number[]> = {};
  sectors.forEach((s, i) => {
    if (!sectorIdx[s]) sectorIdx[s] = [];
    sectorIdx[s].push(i);
  });
  for (const s of Object.keys(sectorIdx)) {
    const idxs = sectorIdx[s];
    const sum = idxs.reduce((a, i) => a + w[i], 0);
    if (sum > cfg.sectorCap) {
      const factor = cfg.sectorCap / sum;
      for (const i of idxs) w[i] *= factor;
    }
  }
  // Correlation-cluster cap (greedy)
  const visited = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;
    const cluster: number[] = [];
    for (let j = 0; j < n; j++) {
      if (!visited.has(j) && correl[i][j] >= cfg.clusterCorrThreshold) {
        cluster.push(j);
      }
    }
    const sum = cluster.reduce((a, j) => a + w[j], 0);
    if (sum > cfg.clusterCap && sum > 0) {
      const factor = cfg.clusterCap / sum;
      for (const j of cluster) w[j] *= factor;
    }
    for (const j of cluster) visited.add(j);
  }
  return w;
}

// ---------------------------------------------------------------------------
// Tier assignment and rotation diff
// ---------------------------------------------------------------------------

function assignTier(weight: number, leader: number, threshold: number): Tier {
  if (weight >= 0.055 && leader >= threshold) return "anchor";
  if (weight >= 0.03) return "follower";
  if (weight >= 0.01) return "tactical";
  return "trim";
}

export function computeRotation(
  current: RecipePosition[],
  previous: { ticker: string; weight: number; trailing60d?: number }[] | undefined,
  cfg: Config
): RotationDiff | null {
  if (!previous || previous.length === 0) return null;
  const prevMap = new Map(previous.map((p) => [p.ticker, p.weight]));
  const curMap = new Map(current.map((p) => [p.ticker, p.weight]));
  const curInfo = new Map(current.map((p) => [p.ticker, p]));

  const added: string[] = [];
  for (const t of curMap.keys()) {
    if ((prevMap.get(t) || 0) < 0.005 && (curMap.get(t) || 0) >= 0.01) {
      added.push(t);
    }
  }

  const retired: { ticker: string; reason: string; prevWeight: number }[] = [];
  for (const t of prevMap.keys()) {
    const prevW = prevMap.get(t) || 0;
    const curW = curMap.get(t) || 0;
    if (prevW < 0.005) continue;
    if (curW < cfg.retireWeightBelow) {
      const info = curInfo.get(t);
      let reason = "pipeline ejected";
      if (info) {
        if (info.trailing60d <= cfg.retireTrailing60dReturn) {
          reason = `60d return ${(info.trailing60d * 100).toFixed(1)}%`;
        } else if (info.posteriorMu <= 0) {
          reason = `posterior μ turned negative (${(info.posteriorMu * 100).toFixed(1)}%)`;
        } else if (info.weight < 0.005) {
          reason = `quarter-Kelly weight fell to ${(info.weight * 100).toFixed(2)}%`;
        }
      }
      retired.push({ ticker: t, reason, prevWeight: prevW });
    }
  }

  const resized: {
    ticker: string;
    prevWeight: number;
    newWeight: number;
    deltaPp: number;
  }[] = [];
  for (const t of curMap.keys()) {
    if (!prevMap.has(t)) continue;
    const p = prevMap.get(t) || 0;
    const c = curMap.get(t) || 0;
    const delta = (c - p) * 100;
    if (Math.abs(delta) >= 1) {
      resized.push({ ticker: t, prevWeight: p, newWeight: c, deltaPp: delta });
    }
  }
  resized.sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp));
  return { added: added.sort(), retired, resized };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface BuildInput {
  stocks: WatchlistStock[];
  priceHistory: Record<string, number[]>; // symbol -> array of closes, newest last
  market: string;
  topN?: number;
  previousHoldings?: { ticker: string; weight: number; trailing60d?: number }[];
  cfg?: Partial<Config>;
  polymarketTilts?: PolymarketTiltMap;
  polymarketLambda?: number;
}

export function buildRecipeAllocation(input: BuildInput): RecipeAllocation {
  const cfg: Config = { ...DEFAULT_CONFIG, ...(input.cfg || {}) };
  const topN = input.topN || 30;

  // Universe filter: actionable names with a composite score
  const universe = input.stocks.filter((s) => {
    const action = (s.action || "").toLowerCase();
    const actionable =
      action.startsWith("left-side") || action.startsWith("right-side");
    const score = Number(s.composite_score || 0);
    return actionable && score >= 50;
  });
  const meta = new Map(universe.map((s) => [s.symbol, s]));

  // Align returns
  const series: Record<string, number[]> = {};
  for (const s of universe) {
    const h = input.priceHistory[s.symbol];
    if (h && h.length >= cfg.minHistoryDays) series[s.symbol] = h;
  }
  const { tickers, returns } = alignedLogReturns(series, cfg.minHistoryDays);
  if (tickers.length < 5) {
    return emptyResult(input.market, universe.length, topN, cfg);
  }

  const scores = tickers.map((t) => Number(meta.get(t)?.composite_score || 50));
  const sectors = tickers.map((t) => normalizeSector(meta.get(t)?.sector || ""));

  // Polymarket overlay — per-ticker Δμ_prior = lambda * slope * z_live.
  // z_live is already per-mapping governance-weighted by the producer, so
  // `lambda` here is a simple global kill-switch in [0, 1]: 0 = shadow
  // (default, no nudge), 1 = trust governance fully. Missing tilts or a
  // zero-z_live (no promoted mapping for this symbol) produce no delta.
  const pmLambda = Math.max(
    0,
    Math.min(1, input.polymarketLambda ?? 0)
  );
  const pmTilts: PolymarketTiltMap = input.polymarketTilts || {};
  const polymarketDeltas = tickers.map((t) => {
    const tilt = pmTilts[t];
    if (!tilt) return 0;
    return pmLambda * POLYMARKET_PRIOR_SLOPE * tilt.z_live;
  });

  // Bayes blend μ (with Polymarket prior nudge folded in)
  const { mu, prior, obs } = blendedMu(
    returns,
    scores,
    cfg,
    polymarketDeltas
  );

  // Shrunk covariance
  const { cov, correl } = ledoitWolfCovariance(returns);

  // Full-Kelly w = Σ^-1 μ
  const invCov = invert(cov);
  const kellyFull = matVec(invCov, mu);

  // Bayes width discount and fractional Kelly
  const bayes = bayesWidthDiscount(returns);
  const raw = kellyFull.map((k, i) => k * bayes[i] * cfg.quarterKelly);

  // Caps
  const capped = applyCaps(raw, sectors, correl, cfg);
  const total = capped.reduce((a, b) => a + b, 0);
  const cashReserve = Math.max(0, 1 - total);

  // Transfer-Entropy leader scores
  const leaders = leaderScores(returns);

  // Anchor threshold: median TE among names that cleared the cap stack
  const held = tickers
    .map((_, i) => ({ i, w: capped[i], te: leaders[i] }))
    .filter((x) => x.w > 0);
  let threshold = 0.005;
  if (held.length >= 3) {
    const heldTEs = held.map((x) => x.te).sort((a, b) => a - b);
    threshold = heldTEs[Math.floor(heldTEs.length / 2)];
  }

  // Assemble positions with trailing returns
  const positions: RecipePosition[] = tickers.map((t, i) => {
    const ret = returns[i];
    const trailing60d = ret.slice(-60).reduce((a, b) => a + b, 0);
    const trailing1y = ret.slice(-252).reduce((a, b) => a + b, 0);
    const s = meta.get(t)!;
    const tilt = pmTilts[t];
    return {
      ticker: t,
      name: s.name,
      sector: sectors[i],
      market: s.market || input.market,
      score: Number(s.composite_score || 0),
      action: s.action || "",
      priorMu: prior[i],
      posteriorMu: mu[i],
      bayesDiscount: bayes[i],
      leaderScore: leaders[i],
      kellyFull: kellyFull[i],
      quarterKelly: raw[i],
      weight: capped[i],
      tier: assignTier(capped[i], leaders[i], threshold),
      trailing60d: Math.exp(trailing60d) - 1,
      trailing1y: Math.exp(trailing1y) - 1,
      polymarketZ: tilt ? tilt.z : undefined,
      polymarketZLive: tilt ? tilt.z_live : undefined,
      polymarketTopReason: tilt ? tilt.top_reason : undefined,
      polymarketDeltaMuPrior: tilt ? polymarketDeltas[i] : undefined,
    };
  });
  positions.sort((a, b) => b.weight - a.weight);
  const top = positions.slice(0, topN);

  // Sector summary (top-N)
  const secMap: Record<string, number> = {};
  for (const p of top) secMap[p.sector] = (secMap[p.sector] || 0) + p.weight;
  const sectorSummary = Object.entries(secMap)
    .map(([sector, weight]) => ({ sector, weight }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  // Tier summary
  const tierGroups: Record<Tier, RecipePosition[]> = {
    anchor: [],
    follower: [],
    tactical: [],
    trim: [],
  };
  for (const p of top) tierGroups[p.tier].push(p);
  const tierOrder: Tier[] = ["anchor", "follower", "tactical", "trim"];
  const tierSummary: { tier: Tier | "cash"; count: number; weight: number }[] =
    tierOrder.map((tier) => ({
      tier,
      count: tierGroups[tier].length,
      weight: tierGroups[tier].reduce((a, p) => a + p.weight, 0),
    }));
  tierSummary.push({ tier: "cash", count: 0, weight: cashReserve });

  // Rotation diff
  const rotation = computeRotation(positions, input.previousHoldings, cfg);

  const invested = top.reduce((a, p) => a + p.weight, 0);

  // Polymarket overlay summary — separates the shadow view (z, all mappings)
  // from the live view (z_live, only governance-promoted mappings).
  let symbolsWithTilt = 0;
  let symbolsLive = 0;
  let maxAbsZ = 0;
  let maxAbsZLive = 0;
  let sumAbsZWeighted = 0;
  let sumAbsZLiveWeighted = 0;
  for (const p of top) {
    if (p.polymarketZ !== undefined) {
      symbolsWithTilt += 1;
      const az = Math.abs(p.polymarketZ);
      if (az > maxAbsZ) maxAbsZ = az;
      sumAbsZWeighted += az * p.weight;
    }
    if (p.polymarketZLive !== undefined && Math.abs(p.polymarketZLive) > 1e-6) {
      symbolsLive += 1;
      const azl = Math.abs(p.polymarketZLive);
      if (azl > maxAbsZLive) maxAbsZLive = azl;
      sumAbsZLiveWeighted += azl * p.weight;
    }
  }
  const polymarketOverlay = {
    lambda: pmLambda,
    symbolsWithTilt,
    symbolsLive,
    maxAbsZ,
    maxAbsZLive,
    sumAbsZWeightedPct: sumAbsZWeighted,
    sumAbsZLiveWeightedPct: sumAbsZLiveWeighted,
  };

  return {
    asOf: new Date().toISOString().slice(0, 10),
    market: input.market,
    universeSize: universe.length,
    topN,
    invested,
    cashReserve: Math.max(0, 1 - invested),
    leaderThreshold: threshold,
    positions: top,
    sectorSummary,
    tierSummary,
    rotation,
    config: cfg,
    polymarketOverlay,
  };
}

function emptyResult(
  market: string,
  universeSize: number,
  topN: number,
  cfg: Config
): RecipeAllocation {
  return {
    asOf: new Date().toISOString().slice(0, 10),
    market,
    universeSize,
    topN,
    invested: 0,
    cashReserve: 1,
    leaderThreshold: 0,
    positions: [],
    sectorSummary: [],
    tierSummary: [
      { tier: "anchor", count: 0, weight: 0 },
      { tier: "follower", count: 0, weight: 0 },
      { tier: "tactical", count: 0, weight: 0 },
      { tier: "trim", count: 0, weight: 0 },
      { tier: "cash", count: 0, weight: 1 },
    ],
    rotation: null,
    config: cfg,
  };
}

// ---------------------------------------------------------------------------
// Sector normalization (yfinance GICS-ish → compact labels)
// ---------------------------------------------------------------------------

function normalizeSector(s: string): string {
  const m: Record<string, string> = {
    "Financial Services": "financials",
    Technology: "tech",
    Healthcare: "healthcare",
    "Consumer Cyclical": "consumer-discret",
    "Consumer Defensive": "consumer-staples",
    "Communication Services": "communications",
    Industrials: "industrials",
    Energy: "energy",
    "Basic Materials": "materials",
    "Real Estate": "realestate",
    Utilities: "utilities",
  };
  if (!s) return "other";
  return m[s] || s.toLowerCase().replace(/\s+/g, "-");
}

// ---------------------------------------------------------------------------
// Market partition helper
// ---------------------------------------------------------------------------

export function marketFilter(
  stocks: WatchlistStock[],
  market: "US" | "CHINA" | "HK" | "CN" | "ALL"
): WatchlistStock[] {
  return stocks.filter((s) => {
    const sym = s.symbol;
    if (market === "ALL") return true;
    if (market === "US")
      return !sym.includes(".HK") && !sym.includes(".SS") && !sym.includes(".SZ");
    if (market === "HK") return sym.includes(".HK");
    if (market === "CN") return sym.includes(".SS") || sym.includes(".SZ");
    if (market === "CHINA")
      return sym.includes(".HK") || sym.includes(".SS") || sym.includes(".SZ");
    return true;
  });
}
