/**
 * Topological Data Analysis (TDA) for financial market structure.
 *
 * Pure TypeScript implementation — no native dependencies.
 * Uses Vietoris-Rips filtration approximation via distance matrix
 * to extract Betti numbers, persistence landscapes, and crisis probability.
 *
 * Based on Gidea & Katz (2017) framework.
 */

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export interface TdaPreset {
  label: string;
  assets: string[];
  descriptions: string[];
}

export const TDA_PRESETS: Record<string, TdaPreset> = {
  "broad-market": {
    label: "Broad Market Structural Monitor",
    assets: ["^GSPC", "^VIX", "^TNX", "DX-Y.NYB", "GLD", "HYG"],
    descriptions: ["S&P 500", "VIX", "10Y Yield", "USD Index", "Gold", "High Yield"],
  },
  "oil-crisis": {
    label: "Oil / Geopolitical Crisis",
    assets: ["BZ=F", "CL=F", "^VIX", "DX-Y.NYB", "^TNX", "GLD"],
    descriptions: ["Brent Crude", "WTI Crude", "VIX", "USD Index", "10Y Yield", "Gold"],
  },
  "tech-bubble": {
    label: "Tech / AI Bubble Monitor",
    assets: ["^IXIC", "^VIX", "^TNX", "SMH", "ARKK", "DX-Y.NYB"],
    descriptions: ["NASDAQ", "VIX", "10Y Yield", "Semis ETF", "ARKK", "USD Index"],
  },
  china: {
    label: "China / HK Market Monitor",
    assets: ["^HSI", "FXI", "^TNX", "DX-Y.NYB", "GLD", "CL=F"],
    descriptions: ["Hang Seng", "China ETF", "10Y Yield", "USD Index", "Gold", "WTI Crude"],
  },
};

// ---------------------------------------------------------------------------
// Thresholds (Gidea & Katz 2017 + MDPI 2025)
// ---------------------------------------------------------------------------

const L2_WARNING = 0.35;
const L2_CRISIS = 0.45;
const L2_2008_PEAK = 1.1;

// ---------------------------------------------------------------------------
// Math utilities
// ---------------------------------------------------------------------------

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function std(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function zscore(matrix: number[][]): number[][] {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const result: number[][] = [];

  for (let c = 0; c < cols; c++) {
    const col = matrix.map((r) => r[c]);
    const m = mean(col);
    const s = std(col) || 1;
    for (let r = 0; r < rows; r++) {
      if (!result[r]) result[r] = [];
      result[r][c] = (matrix[r][c] - m) / s;
    }
  }
  return result;
}

function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

// ---------------------------------------------------------------------------
// Takens embedding
// ---------------------------------------------------------------------------

function takensEmbed(data: number[][], dim: number, tau: number): number[][] {
  const N = data.length;
  const D = data[0].length;
  const cloud: number[][] = [];
  for (let i = (dim - 1) * tau; i < N; i++) {
    const row: number[] = [];
    for (let j = 0; j < dim; j++) {
      for (let d = 0; d < D; d++) {
        row.push(data[i - j * tau][d]);
      }
    }
    cloud.push(row);
  }
  return cloud;
}

// ---------------------------------------------------------------------------
// Distance matrix
// ---------------------------------------------------------------------------

function distanceMatrix(cloud: number[][]): number[][] {
  const n = cloud.length;
  const dm: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = euclidean(cloud[i], cloud[j]);
      dm[i][j] = d;
      dm[j][i] = d;
    }
  }
  return dm;
}

// ---------------------------------------------------------------------------
// Union-Find for connected components
// ---------------------------------------------------------------------------

class UnionFind {
  parent: number[];
  rank: number[];
  count: number;

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
    this.count = n;
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }

  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank[ra] < this.rank[rb]) this.parent[ra] = rb;
    else if (this.rank[ra] > this.rank[rb]) this.parent[rb] = ra;
    else { this.parent[rb] = ra; this.rank[ra]++; }
    this.count--;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Persistence computation (H0 via filtration)
// ---------------------------------------------------------------------------

interface PersistencePair {
  birth: number;
  death: number;
  dim: number;
}

function computeH0Persistence(dm: number[][]): PersistencePair[] {
  const n = dm.length;
  const edges: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      edges.push({ i, j, d: dm[i][j] });
  edges.sort((a, b) => a.d - b.d);

  const uf = new UnionFind(n);
  const pairs: PersistencePair[] = [];
  const birth = new Array(n).fill(0);

  for (const edge of edges) {
    const ra = uf.find(edge.i);
    const rb = uf.find(edge.j);
    if (ra !== rb) {
      const younger = birth[ra] > birth[rb] ? ra : rb;
      pairs.push({ birth: birth[younger], death: edge.d, dim: 0 });
      uf.union(edge.i, edge.j);
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Approximate H1 persistence via Rips complex on sampled edges
// ---------------------------------------------------------------------------

function computeH1Approximate(dm: number[][], maxEdges = 3000): PersistencePair[] {
  const n = dm.length;
  const edges: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      edges.push({ i, j, d: dm[i][j] });
  edges.sort((a, b) => a.d - b.d);

  const subset = edges.slice(0, maxEdges);
  if (subset.length === 0) return [];

  const adj = new Map<number, Set<number>>();
  const edgeWeight = new Map<string, number>();
  const pairs: PersistencePair[] = [];

  for (const e of subset) {
    const key = `${e.i}-${e.j}`;
    edgeWeight.set(key, e.d);
    if (!adj.has(e.i)) adj.set(e.i, new Set());
    if (!adj.has(e.j)) adj.set(e.j, new Set());
    adj.get(e.i)!.add(e.j);
    adj.get(e.j)!.add(e.i);

    // Check for triangles (H1 birth/death via filling)
    const ni = adj.get(e.i)!;
    const nj = adj.get(e.j)!;
    for (const k of ni) {
      if (nj.has(k)) {
        const d_ik = edgeWeight.get(e.i < k ? `${e.i}-${k}` : `${k}-${e.i}`) || 0;
        const d_jk = edgeWeight.get(e.j < k ? `${e.j}-${k}` : `${k}-${e.j}`) || 0;
        const birth = Math.max(d_ik, d_jk);
        const death = e.d;
        if (death > birth * 1.05) {
          pairs.push({ birth, death, dim: 1 });
        }
      }
    }
  }

  // Deduplicate by keeping only significant pairs
  pairs.sort((a, b) => (b.death - b.birth) - (a.death - a.birth));
  return pairs.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Persistence Landscape L2 norm
// ---------------------------------------------------------------------------

function landscapeL2(pairs: PersistencePair[], numLandscapes = 5, resolution = 300): number {
  if (pairs.length === 0) return 0;

  const births = pairs.map((p) => p.birth);
  const deaths = pairs.map((p) => p.death);
  const tMin = Math.min(...births);
  const tMax = Math.max(...deaths);
  if (tMax <= tMin) return 0;

  const grid = Array.from({ length: resolution }, (_, i) => tMin + (i / (resolution - 1)) * (tMax - tMin));
  const tents: number[][] = pairs.map((p) => {
    const mid = (p.birth + p.death) / 2;
    return grid.map((t) => {
      if (t >= p.birth && t <= mid) return t - p.birth;
      if (t > mid && t <= p.death) return p.death - t;
      return 0;
    });
  });

  // Sort at each grid point (descending) to get k-th landscape
  const dt = (tMax - tMin) / resolution;
  let totalL2 = 0;
  const k = Math.min(numLandscapes, pairs.length);

  for (let g = 0; g < resolution; g++) {
    const vals = tents.map((t) => t[g]).sort((a, b) => b - a);
    for (let l = 0; l < k; l++) {
      totalL2 += vals[l] ** 2 * dt;
    }
  }

  return Math.sqrt(totalL2);
}

// ---------------------------------------------------------------------------
// β₀ regime count from H0 persistence
// ---------------------------------------------------------------------------

function beta0Regimes(h0Pairs: PersistencePair[]): number {
  if (h0Pairs.length < 2) return 1;
  const lifetimes = h0Pairs.map((p) => p.death - p.birth).sort((a, b) => b - a);

  // Persistence gap heuristic
  let maxGapIdx = 0;
  let maxGap = 0;
  for (let i = 0; i < lifetimes.length - 1; i++) {
    const gap = lifetimes[i] - lifetimes[i + 1];
    if (gap > maxGap) { maxGap = gap; maxGapIdx = i; }
  }

  const regimes = maxGapIdx + 1 + 1; // +1 for the infinite component
  return Math.max(1, Math.min(regimes, 6));
}

// ---------------------------------------------------------------------------
// Correlation collapse
// ---------------------------------------------------------------------------

function correlationCollapse(returns: number[][], window = 20): {
  meanCorrRecent: number;
  meanCorrBaseline: number;
  maxCorrRecent: number;
  collapse: boolean;
  corrDelta: number;
} {
  const cols = returns[0]?.length || 0;
  if (cols < 2) return { meanCorrRecent: 0, meanCorrBaseline: 0, maxCorrRecent: 0, collapse: false, corrDelta: 0 };

  const corrMatrix = (data: number[][]) => {
    const n = data.length;
    const c = data[0].length;
    const pairs: number[] = [];
    for (let a = 0; a < c; a++) {
      for (let b = a + 1; b < c; b++) {
        const colA = data.map((r) => r[a]);
        const colB = data.map((r) => r[b]);
        const mA = mean(colA), mB = mean(colB);
        let num = 0, dA = 0, dB = 0;
        for (let i = 0; i < n; i++) {
          num += (colA[i] - mA) * (colB[i] - mB);
          dA += (colA[i] - mA) ** 2;
          dB += (colB[i] - mB) ** 2;
        }
        const denom = Math.sqrt(dA * dB) || 1;
        pairs.push(num / denom);
      }
    }
    return pairs;
  };

  const recent = returns.slice(-window);
  const recentCorr = corrMatrix(recent);
  const fullCorr = corrMatrix(returns);

  const meanRecent = mean(recentCorr);
  const meanFull = mean(fullCorr);
  const maxRecent = Math.max(...recentCorr);
  const collapse = meanRecent > meanFull + 0.25 && meanRecent > 0.6;

  return {
    meanCorrRecent: meanRecent,
    meanCorrBaseline: meanFull,
    maxCorrRecent: maxRecent,
    collapse,
    corrDelta: meanRecent - meanFull,
  };
}

// ---------------------------------------------------------------------------
// Crisis probability mapping
// ---------------------------------------------------------------------------

export type CrisisZone = "NORMAL" | "ELEVATED" | "WARNING" | "CRISIS";

function crisisProbability(
  l2: number, beta0: number, collapse: boolean, beta1: number
): { probability: number; zone: CrisisZone } {
  let p = 0.05;

  if (l2 > L2_CRISIS) p += 0.30 * Math.min(l2 / L2_2008_PEAK, 1);
  else if (l2 > L2_WARNING) p += 0.15 * (l2 - L2_WARNING) / (L2_CRISIS - L2_WARNING);

  if (beta0 >= 3) p += 0.15;
  else if (beta0 >= 2) p += 0.08;

  if (collapse) p += 0.12;

  if (beta1 >= 3) p += 0.10;
  else if (beta1 >= 1) p += 0.05;

  p = Math.min(p, 0.95);

  const zone: CrisisZone = p < 0.15 ? "NORMAL" : p < 0.30 ? "ELEVATED" : p < 0.50 ? "WARNING" : "CRISIS";
  return { probability: Math.round(p * 1000) / 1000, zone };
}

// ---------------------------------------------------------------------------
// Rolling L2 for trend detection
// ---------------------------------------------------------------------------

function rollingL2(data: number[][], window: number, step: number, embedDim: number, tau: number): { idx: number; l2: number }[] {
  const results: { idx: number; l2: number }[] = [];
  const N = data.length;
  for (let start = 0; start < N - window; start += step) {
    const chunk = data.slice(start, start + window);
    const pc = takensEmbed(chunk, Math.min(embedDim, 3), tau);
    if (pc.length < 10) continue;
    const dm = distanceMatrix(pc);
    const h1 = computeH1Approximate(dm, 1500);
    const rawL2 = landscapeL2(h1);

    let diam = 0;
    const sample = Math.min(pc.length, 60);
    for (let i = 0; i < sample; i++)
      for (let j = i + 1; j < sample; j++) {
        const d = euclidean(pc[i], pc[j]);
        if (d > diam) diam = d;
      }
    results.push({ idx: start + window, l2: diam > 0 ? rawL2 / diam : rawL2 });
  }
  return results;
}

function l2Trend(rolling: { idx: number; l2: number }[]): { trend: string; slope: number; current: number } {
  if (rolling.length < 4) return { trend: "INSUFFICIENT_DATA", slope: 0, current: 0 };
  const vals = rolling.map((r) => r.l2);
  const current = vals[vals.length - 1];
  const recent = vals.slice(-Math.min(4, vals.length));
  const earlier = vals.slice(0, Math.max(1, Math.floor(vals.length / 2)));
  const slope = (mean(recent) - mean(earlier)) / (mean(earlier) || 0.001);

  let trend: string;
  if (slope > 0.20) trend = "RISING_FAST";
  else if (slope > 0.05) trend = "RISING";
  else if (slope < -0.20) trend = "FALLING_FAST";
  else if (slope < -0.05) trend = "FALLING";
  else trend = "STABLE";

  return { trend, slope: Math.round(slope * 1000) / 1000, current: Math.round(current * 10000) / 10000 };
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

export interface TdaResult {
  preset: string;
  label: string;
  assets: string[];
  descriptions: string[];
  observations: number;
  cloudShape: [number, number];
  beta0: number;
  beta1: number;
  l2Norm: number;
  l2Trend: { trend: string; slope: number; current: number };
  correlation: {
    meanCorrRecent: number;
    meanCorrBaseline: number;
    maxCorrRecent: number;
    collapse: boolean;
    corrDelta: number;
  };
  crisis: { probability: number; zone: CrisisZone };
  rollingL2: { idx: number; l2: number }[];
  h0MaxLifetime: number;
  h1MaxLifetime: number;
  mismatch: boolean;
  mismatchReasons: string[];
  computedAt: string;
}

export function analyzeTda(
  returns: number[][],
  assets: string[],
  descriptions: string[],
  preset: string,
  label: string,
  embedDim = 5,
  tau = 1
): TdaResult {
  const data = zscore(returns);
  const N = data.length;

  // Takens embedding
  const pc = takensEmbed(data, embedDim, tau);
  const dm = distanceMatrix(pc);

  // Persistent homology
  const h0 = computeH0Persistence(dm);
  const h1 = computeH1Approximate(dm);

  const beta0 = beta0Regimes(h0);

  // Significant β₁ (lifetime > 30% of max)
  const h1Lifetimes = h1.map((p) => p.death - p.birth);
  const maxLt1 = Math.max(...h1Lifetimes, 0);
  const beta1 = h1Lifetimes.filter((lt) => lt > maxLt1 * 0.30).length;

  // L2 norm (normalized by point cloud diameter for scale-invariance)
  const rawL2 = landscapeL2(h1);
  let diameter = 0;
  for (let i = 0; i < Math.min(pc.length, 100); i++) {
    for (let j = i + 1; j < Math.min(pc.length, 100); j++) {
      const d = euclidean(pc[i], pc[j]);
      if (d > diameter) diameter = d;
    }
  }
  const l2 = diameter > 0 ? rawL2 / diameter : rawL2;

  // Rolling L2
  const windowSize = Math.min(60, Math.floor(N / 3));
  const rolling = rollingL2(data, windowSize, 5, embedDim, tau);
  const trend = l2Trend(rolling);

  // Correlation
  const corr = correlationCollapse(returns);

  // Crisis
  const crisis = crisisProbability(l2, beta0, corr.collapse, beta1);

  // Mismatch detection
  const mismatchReasons: string[] = [];
  if (beta0 >= 2) mismatchReasons.push(`β₀=${beta0}: multiple pricing regimes coexist`);
  if (l2 > L2_WARNING && crisis.zone !== "CRISIS") mismatchReasons.push(`L2 (${l2.toFixed(4)}) shows stress but zone is ${crisis.zone}`);

  const h0Max = h0.length > 0 ? Math.max(...h0.map((p) => p.death - p.birth)) : 0;
  const h1Max = h1.length > 0 ? Math.max(...h1.map((p) => p.death - p.birth)) : 0;

  return {
    preset,
    label,
    assets,
    descriptions,
    observations: N,
    cloudShape: [pc.length, pc[0]?.length || 0],
    beta0,
    beta1,
    l2Norm: Math.round(l2 * 10000) / 10000,
    l2Trend: trend,
    correlation: {
      meanCorrRecent: Math.round(corr.meanCorrRecent * 1000) / 1000,
      meanCorrBaseline: Math.round(corr.meanCorrBaseline * 1000) / 1000,
      maxCorrRecent: Math.round(corr.maxCorrRecent * 1000) / 1000,
      collapse: corr.collapse,
      corrDelta: Math.round(corr.corrDelta * 1000) / 1000,
    },
    crisis,
    rollingL2: rolling.map((r) => ({ idx: r.idx, l2: Math.round(r.l2 * 10000) / 10000 })),
    h0MaxLifetime: Math.round(h0Max * 10000) / 10000,
    h1MaxLifetime: Math.round(h1Max * 10000) / 10000,
    mismatch: mismatchReasons.length > 0,
    mismatchReasons,
    computedAt: new Date().toISOString(),
  };
}
