/**
 * Shannon Entropy analysis for market return distributions.
 *
 * Computes rolling Shannon entropy of daily returns to detect:
 * - Narrative compression (low entropy = one dominant force)
 * - Regime fragility (falling entropy + high valuation spread)
 * - "Anchor failure" (low entropy + price far from fundamental value)
 *
 * Based on the information-theoretic framework:
 *   H = -Σ p(x) · log₂(p(x))
 * Normalized to [0, 1] via H / log₂(bins)
 */

export interface EntropyProfile {
  symbol: string;
  current60d: number;       // Normalized entropy of last 60 trading days
  current120d: number;      // Normalized entropy of last 120 trading days
  current252d: number;      // Normalized entropy of last 252 trading days
  volumeEntropy60d: number; // Volume distribution entropy (60d)
  percentile: number;       // Current 60d entropy vs full rolling history (0-100)
  percentile1y: number;     // Current 60d entropy vs 1-year rolling history (0-100)
  percentile3y: number;     // Current 60d entropy vs 3-year rolling history (0-100)
  trend: number;            // Entropy slope over last 60 days (negative = compressing)
  regime: "compressed" | "normal" | "diverse";
  regimeColor: string;
  anchorFailure: boolean;   // Low entropy + price far from valuation anchor
  anchorDetail: string;
  history: { date: string; entropy: number }[];
  cogGap: number;           // "Cognitive computation gap" score (0-10)
  cogGapLabel: string;
  volumeEntropyPctile: number | null;
  pvDivergence: number | null;
  pvDivergenceSignal: string;
  phase: number;            // 0=neutral, 1=compression, 2=fracture, 3=disorder, 4=re-compression
  phaseLabel: string;
  phaseConfidence: "HIGH" | "MEDIUM" | "LOW";
  phaseColor: string;
  phaseAction: string;
}

const NUM_BINS = 20;

function classifyPhase(
  pctile: number,
  derivative: number,
  pctile30dAgo: number | null,
): { phase: number; label: string; confidence: "HIGH" | "MEDIUM" | "LOW"; color: string; action: string } {
  const LOW = 20, LOW_SOFT = 30, HIGH = 80, HIGH_SOFT = 70;
  const FLAT = 0.0005, FAST = 0.001;

  if (pctile <= LOW && derivative <= FLAT)
    return { phase: 1, label: "COMPRESSION", confidence: pctile <= 10 ? "HIGH" : "MEDIUM",
      color: "#63b3ed", action: "Reduce size. Buy cheap hedges." };
  if (pctile <= LOW_SOFT && derivative <= FLAT)
    return { phase: 1, label: "COMPRESSION", confidence: "MEDIUM",
      color: "#63b3ed", action: "Approaching compression." };
  if (derivative > FAST && pctile < HIGH)
    return { phase: 2, label: "FRACTURE", confidence: derivative > 0.002 ? "HIGH" : "MEDIUM",
      color: "#f6ad55", action: "Do NOT buy dips." };
  if (derivative > FLAT && pctile <= 50 && pctile30dAgo !== null && pctile - pctile30dAgo > 15)
    return { phase: 2, label: "FRACTURE", confidence: "MEDIUM",
      color: "#f6ad55", action: "Early fracture signal." };
  if (pctile >= HIGH && Math.abs(derivative) <= FLAT)
    return { phase: 3, label: "DISORDER", confidence: "HIGH",
      color: "#fc8181", action: "Wait for PV Divergence." };
  if (pctile >= HIGH_SOFT && Math.abs(derivative) <= FAST)
    return { phase: 3, label: "DISORDER", confidence: "MEDIUM",
      color: "#fc8181", action: "Reduce directional bets." };
  if (derivative < -FLAT && pctile > LOW_SOFT) {
    const stage = pctile >= HIGH_SOFT ? "early" : pctile >= 40 ? "mid" : "late";
    return { phase: 4, label: "RE-COMPRESSION", confidence: derivative < -FAST ? "HIGH" : "MEDIUM",
      color: "#68d391", action: `Best entry (${stage}).` };
  }
  return { phase: 0, label: "NEUTRAL", confidence: "LOW",
    color: "#a0aec0", action: "Mid-cycle." };
}

function shannonEntropy(values: number[], bins: number = NUM_BINS): number {
  if (values.length < 10) return 1;

  let min = values[0], max = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  const range = max - min;
  if (range === 0) return 0;

  const counts = new Array(bins).fill(0);
  for (const v of values) {
    let idx = Math.floor(((v - min) / range) * bins);
    if (idx >= bins) idx = bins - 1;
    counts[idx]++;
  }

  const n = values.length;
  let h = 0;
  for (const c of counts) {
    if (c > 0) {
      const p = c / n;
      h -= p * Math.log2(p);
    }
  }

  return h / Math.log2(bins); // Normalize to [0, 1]
}

function logReturns(prices: number[]): number[] {
  const ret: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && prices[i] > 0) {
      ret.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  return ret;
}

function rollingEntropy(
  returns: number[],
  window: number,
  step: number = 5
): number[] {
  const result: number[] = [];
  for (let i = window; i <= returns.length; i += step) {
    const slice = returns.slice(i - window, i);
    result.push(shannonEntropy(slice));
  }
  return result;
}

function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += values[i];
    sxy += i * values[i];
    sxx += i * i;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  return (n * sxy - sx * sy) / denom;
}

function percentileOf(value: number, distribution: number[]): number {
  if (distribution.length === 0) return 50;
  const below = distribution.filter((v) => v < value).length;
  return (below / distribution.length) * 100;
}

export function computeEntropyProfile(
  prices: number[],
  volumes: number[],
  dates: string[],
  stock?: {
    pe_ratio?: number | null;
    price_to_book?: number | null;
    dcf_fair_value?: number | null;
    price?: number | null;
    distance_from_ath?: string | null;
    green_walls?: number | null;
    yellow_walls?: number | null;
    red_walls?: number | null;
    geometric_order?: number | null;
    hmm_regime?: string | null;
  }
): Omit<EntropyProfile, "symbol"> {
  const returns = logReturns(prices);

  const tail60 = returns.slice(-60);
  const tail120 = returns.slice(-120);
  const tail252 = returns.slice(-252);

  const current60d = shannonEntropy(tail60);
  const current120d = shannonEntropy(tail120);
  const current252d = returns.length >= 252 ? shannonEntropy(tail252) : current120d;

  // Volume entropy: bin normalized daily volumes
  const vol60 = volumes.slice(-60);
  const avgVol = vol60.reduce((a, b) => a + b, 0) / vol60.length || 1;
  const normVol = vol60.map((v) => v / avgVol);
  const volumeEntropy60d = shannonEntropy(normVol);

  // Rolling 60d entropy over full history for percentile
  const rolling = rollingEntropy(returns, 60, 1);
  const percentile = percentileOf(current60d, rolling);
  // 1-year and 3-year lookback percentiles
  const rolling1y = rolling.slice(-252);
  const rolling3y = rolling.slice(-756);
  const percentile1y = percentileOf(current60d, rolling1y.length > 0 ? rolling1y : rolling);
  const percentile3y = percentileOf(current60d, rolling3y.length > 0 ? rolling3y : rolling);

  // Rolling volume entropy percentile (same rolling method as price entropy)
  const volRolling: number[] = [];
  if (volumes.length >= 120) {
    for (let i = 60; i <= volumes.length; i++) {
      const seg = volumes.slice(i - 60, i);
      const avgS = seg.reduce((a, b) => a + b, 0) / seg.length || 1;
      volRolling.push(shannonEntropy(seg.map((v) => v / avgS)));
    }
  }
  const volumeEntropyPctile = volRolling.length > 0
    ? percentileOf(volumeEntropy60d, volRolling)
    : null;

  // Price-Volume Entropy Divergence
  let pvDivergence: number | null = null;
  let pvDivergenceSignal = "ALIGNED";
  if (volumeEntropyPctile !== null) {
    pvDivergence = Math.round((volumeEntropyPctile - percentile) * 10) / 10;
    if (percentile <= 30 && pvDivergence > 25) {
      pvDivergenceSignal = "ACCUMULATION";
    } else if (percentile <= 30 && pvDivergence < -20) {
      pvDivergenceSignal = "DISTRIBUTION";
    } else if (percentile >= 60 && pvDivergence < -25) {
      pvDivergenceSignal = "CAPITULATION";
    } else if (Math.abs(pvDivergence) <= 15) {
      pvDivergenceSignal = "ALIGNED";
    } else if (pvDivergence > 25) {
      pvDivergenceSignal = "QUIET_BUILDUP";
    } else if (pvDivergence < -25) {
      pvDivergenceSignal = "VOL_SPIKE";
    } else {
      pvDivergenceSignal = "MILD_DIVERGENCE";
    }
  }

  // Entropy trend: slope of last 12 rolling windows (60 days of daily rolling)
  const recentRolling = rolling.slice(-60);
  const trend = linearSlope(recentRolling);

  // Regime classification
  let regime: "compressed" | "normal" | "diverse";
  let regimeColor: string;
  if (percentile <= 20) {
    regime = "compressed";
    regimeColor = "#ef4444"; // Red - danger
  } else if (percentile >= 80) {
    regime = "diverse";
    regimeColor = "#10b981"; // Green - healthy
  } else {
    regime = "normal";
    regimeColor = "#f59e0b"; // Yellow - neutral
  }

  // Anchor failure detection
  let anchorFailure = false;
  let anchorDetail = "";
  if (stock && percentile <= 30) {
    const failures: string[] = [];

    const ath = parseFloat(stock.distance_from_ath ?? "");
    if (!isNaN(ath) && ath <= -40) {
      failures.push(`ATH ${ath.toFixed(0)}%`);
    }

    if (stock.pe_ratio && stock.pe_ratio > 50) {
      failures.push(`PE ${stock.pe_ratio.toFixed(0)}x`);
    }

    if (stock.dcf_fair_value && stock.price) {
      const upside = ((stock.dcf_fair_value - stock.price) / stock.price) * 100;
      if (Math.abs(upside) > 30) {
        failures.push(`DCF ${upside > 0 ? "+" : ""}${upside.toFixed(0)}%`);
      }
    }

    const totalWalls = (stock.green_walls ?? 0) + (stock.yellow_walls ?? 0) + (stock.red_walls ?? 0);
    if (totalWalls > 0 && (stock.red_walls ?? 0) >= 2) {
      failures.push(`${stock.red_walls}R walls`);
    }

    if (failures.length > 0) {
      anchorFailure = true;
      anchorDetail = `Low entropy + ${failures.join(", ")}`;
    }
  }
  if (!anchorDetail) {
    anchorDetail = regime === "compressed"
      ? "Compressed regime — monitor for anchor divergence"
      : regime === "diverse"
        ? "Healthy informational diversity"
        : "Normal entropy regime";
  }

  // Cognitive computation gap: how much "processing" the market is leaving on the table.
  // Volume contribution via DIVERGENCE (not just absolute level) — accumulation/distribution
  // signals reveal smart money positioning before the crowd.
  let cogGap = 0;
  if (percentile <= 15) cogGap += 3;
  else if (percentile <= 30) cogGap += 2;
  else if (percentile <= 45) cogGap += 1;

  if (trend < -0.001) cogGap += 2;
  else if (trend < -0.0005) cogGap += 1;

  if (["ACCUMULATION", "QUIET_BUILDUP"].includes(pvDivergenceSignal)) {
    cogGap += 2;
  } else if (pvDivergenceSignal === "DISTRIBUTION") {
    cogGap += 2;
  } else if (["CAPITULATION", "VOL_SPIKE"].includes(pvDivergenceSignal)) {
    cogGap += 1;
  } else if (volumeEntropy60d < 0.5) {
    cogGap += 1;
  }

  if (stock?.geometric_order != null && stock.geometric_order >= 2) cogGap += 1;
  if (stock?.hmm_regime?.toLowerCase().includes("bear")) cogGap += 1;

  cogGap = Math.min(cogGap, 10);

  const cogGapLabels: Record<number, string> = {
    0: "Efficient",
    1: "Minimal gap",
    2: "Slight gap",
    3: "Moderate gap",
    4: "Notable gap",
    5: "Significant gap",
    6: "Large gap",
    7: "Severe gap",
    8: "Critical gap",
    9: "Extreme gap",
    10: "Maximum gap",
  };

  // Build history for charting (daily rolling 60d entropy, sampled)
  const history: { date: string; entropy: number }[] = [];
  const histDates = dates.slice(60);
  for (let i = 60; i < returns.length; i += 1) {
    const slice = returns.slice(i - 60, i);
    if (i % 5 === 0 || i === returns.length - 1) {
      history.push({
        date: histDates[i - 60] ?? dates[dates.length - 1],
        entropy: shannonEntropy(slice),
      });
    }
  }

  // Phase classification
  let pctile30dAgo: number | null = null;
  if (rolling.length > 30) {
    const h30ago = rolling[rolling.length - 31];
    if (h30ago !== undefined) {
      const sub = rolling.slice(0, -30);
      if (sub.length > 0) {
        pctile30dAgo = percentileOf(h30ago, sub);
      }
    }
  }
  const phaseResult = classifyPhase(percentile, trend, pctile30dAgo);

  return {
    current60d,
    current120d,
    current252d,
    volumeEntropy60d,
    percentile,
    percentile1y,
    percentile3y,
    trend,
    regime,
    regimeColor,
    anchorFailure,
    anchorDetail,
    history,
    cogGap,
    cogGapLabel: cogGapLabels[cogGap] ?? "Unknown",
    volumeEntropyPctile: volumeEntropyPctile !== null ? Math.round(volumeEntropyPctile * 10) / 10 : null,
    pvDivergence,
    pvDivergenceSignal,
    phase: phaseResult.phase,
    phaseLabel: phaseResult.label,
    phaseConfidence: phaseResult.confidence,
    phaseColor: phaseResult.color,
    phaseAction: phaseResult.action,
  };
}

/** Cross-portfolio entropy: how concentrated are watchlist returns */
export function portfolioEntropy(
  stockReturns: { symbol: string; returns60d: number[] }[]
): {
  crossEntropy: number;
  correlationEntropy: number;
  concentrated: boolean;
  detail: string;
} {
  if (stockReturns.length < 2) {
    return { crossEntropy: 1, correlationEntropy: 1, concentrated: false, detail: "Need 2+ stocks" };
  }

  // Compute pairwise correlations
  const corrs: number[] = [];
  for (let i = 0; i < stockReturns.length; i++) {
    for (let j = i + 1; j < stockReturns.length; j++) {
      const a = stockReturns[i].returns60d;
      const b = stockReturns[j].returns60d;
      const len = Math.min(a.length, b.length);
      if (len < 10) continue;
      const aSlice = a.slice(-len);
      const bSlice = b.slice(-len);
      const ma = aSlice.reduce((s, v) => s + v, 0) / len;
      const mb = bSlice.reduce((s, v) => s + v, 0) / len;
      let cov = 0, va = 0, vb = 0;
      for (let k = 0; k < len; k++) {
        const da = aSlice[k] - ma;
        const db = bSlice[k] - mb;
        cov += da * db;
        va += da * da;
        vb += db * db;
      }
      const denom = Math.sqrt(va * vb);
      if (denom > 0) corrs.push(cov / denom);
    }
  }

  if (corrs.length === 0) {
    return { crossEntropy: 1, correlationEntropy: 1, concentrated: false, detail: "Insufficient data" };
  }

  // Entropy of correlation distribution
  const correlationEntropy = shannonEntropy(corrs, 10);

  // Cross-entropy: bin the mean daily returns across all stocks
  const meanReturns = stockReturns
    .filter((s) => s.returns60d.length >= 10)
    .map((s) => {
      const r = s.returns60d;
      return r.reduce((a, b) => a + b, 0) / r.length;
    });
  const crossEntropy = shannonEntropy(meanReturns, Math.min(10, meanReturns.length));

  const avgCorr = corrs.reduce((a, b) => a + b, 0) / corrs.length;
  const concentrated = avgCorr > 0.7 || crossEntropy < 0.4;

  return {
    crossEntropy,
    correlationEntropy,
    concentrated,
    detail: concentrated
      ? `High avg correlation (${(avgCorr * 100).toFixed(0)}%) — portfolio behaving as single trade`
      : `Avg correlation ${(avgCorr * 100).toFixed(0)}% — reasonable diversification`,
  };
}
