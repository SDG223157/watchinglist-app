/**
 * Gaussian Hidden Markov Model with Baum-Welch (EM) estimation.
 * Pure TypeScript — no external dependencies.
 *
 * Fits a K-state HMM to univariate return series, producing:
 *   - Transition matrix with persistence (diagonal) probabilities
 *   - Regime-specific return distributions (mu, sigma)
 *   - Viterbi-decoded regime sequence
 *   - Strategy backtest: momentum vs mean-reversion vs buy-and-hold
 */

export interface HmmParams {
  nStates: number;
  means: number[];
  variances: number[];
  transmat: number[][];
  startprob: number[];
}

export interface HmmResult {
  params: HmmParams;
  states: number[];           // Viterbi-decoded regime per day
  stateLabels: string[];      // e.g. ["Bull", "Bear", "Flat"]
  stateColors: string[];
  persistence: number[];      // diagonal of transmat
  avgPersistence: number;
  stationaryDist: number[];
  expectedDurations: number[];
  regimeStats: {
    label: string;
    color: string;
    muAnn: number;
    sigmaAnn: number;
    duration: number;
    pctTime: number;
  }[];
  backtest: {
    momentum: StrategyResult;
    meanrev: StrategyResult;
    buyhold: StrategyResult;
  };
  prices: number[];
  dates: string[];
  signal: "MOMENTUM" | "MEAN_REVERSION" | "MIXED";
}

export interface StrategyResult {
  label: string;
  cagr: number;
  sharpe: number;
  maxDrawdown: number;
  totalReturn: number;
  equity: number[];
}

function logSumExp(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const mx = Math.max(a, b);
  return mx + Math.log(Math.exp(a - mx) + Math.exp(b - mx));
}

function gaussianLogPdf(x: number, mu: number, variance: number): number {
  return -0.5 * Math.log(2 * Math.PI * variance) - ((x - mu) ** 2) / (2 * variance);
}

function initializeParams(returns: number[], nStates: number): HmmParams {
  const sorted = [...returns].sort((a, b) => a - b);
  const globalMean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const totalVar = returns.reduce((s, r) => s + (r - globalMean) ** 2, 0) / returns.length;

  const means: number[] = [];
  const variances: number[] = [];

  for (let i = 0; i < nStates; i++) {
    const frac = (i + 0.5) / nStates;
    const idx = Math.floor(frac * (sorted.length - 1));
    means.push(sorted[idx]);
    const center = (nStates - 1) / 2;
    const distFromCenter = center > 0 ? Math.abs(i - center) / center : 0;
    variances.push(totalVar * (0.5 + distFromCenter * 1.5));
  }

  const transmat = Array.from({ length: nStates }, (_, i) =>
    Array.from({ length: nStates }, (_, j) => (i === j ? 0.9 : 0.1 / (nStates - 1)))
  );

  const startprob = Array(nStates).fill(1 / nStates);

  return { nStates, means, variances, transmat, startprob };
}

function forward(obs: number[], params: HmmParams): { alpha: number[][]; logLikelihood: number } {
  const { nStates, means, variances, transmat, startprob } = params;
  const T = obs.length;
  const alpha: number[][] = Array.from({ length: T }, () => Array(nStates).fill(-Infinity));

  for (let j = 0; j < nStates; j++) {
    alpha[0][j] = Math.log(startprob[j]) + gaussianLogPdf(obs[0], means[j], variances[j]);
  }

  for (let t = 1; t < T; t++) {
    for (let j = 0; j < nStates; j++) {
      let sum = -Infinity;
      for (let i = 0; i < nStates; i++) {
        sum = logSumExp(sum, alpha[t - 1][i] + Math.log(transmat[i][j]));
      }
      alpha[t][j] = sum + gaussianLogPdf(obs[t], means[j], variances[j]);
    }
  }

  let ll = -Infinity;
  for (let j = 0; j < nStates; j++) ll = logSumExp(ll, alpha[T - 1][j]);
  return { alpha, logLikelihood: ll };
}

function backward(obs: number[], params: HmmParams): number[][] {
  const { nStates, means, variances, transmat } = params;
  const T = obs.length;
  const beta: number[][] = Array.from({ length: T }, () => Array(nStates).fill(-Infinity));

  for (let j = 0; j < nStates; j++) beta[T - 1][j] = 0;

  for (let t = T - 2; t >= 0; t--) {
    for (let i = 0; i < nStates; i++) {
      let sum = -Infinity;
      for (let j = 0; j < nStates; j++) {
        sum = logSumExp(
          sum,
          Math.log(transmat[i][j]) + gaussianLogPdf(obs[t + 1], means[j], variances[j]) + beta[t + 1][j]
        );
      }
      beta[t][i] = sum;
    }
  }
  return beta;
}

function baumWelch(obs: number[], params: HmmParams, maxIter = 100, tol = 1e-4): HmmParams {
  const { nStates } = params;
  const T = obs.length;
  let currentParams = { ...params, means: [...params.means], variances: [...params.variances], transmat: params.transmat.map(r => [...r]), startprob: [...params.startprob] };
  let prevLL = -Infinity;

  for (let iter = 0; iter < maxIter; iter++) {
    const { alpha, logLikelihood } = forward(obs, currentParams);
    const beta = backward(obs, currentParams);

    if (Math.abs(logLikelihood - prevLL) < tol && iter > 5) break;
    prevLL = logLikelihood;

    // E-step: compute gamma and xi
    const gamma: number[][] = Array.from({ length: T }, () => Array(nStates).fill(0));
    for (let t = 0; t < T; t++) {
      let norm = -Infinity;
      for (let j = 0; j < nStates; j++) {
        gamma[t][j] = alpha[t][j] + beta[t][j];
        norm = logSumExp(norm, gamma[t][j]);
      }
      for (let j = 0; j < nStates; j++) gamma[t][j] = Math.exp(gamma[t][j] - norm);
    }

    // M-step
    const newStartprob = gamma[0].slice();
    const newMeans = Array(nStates).fill(0);
    const newVariances = Array(nStates).fill(0);
    const newTransmat = Array.from({ length: nStates }, () => Array(nStates).fill(0));

    const gammaSum = Array(nStates).fill(0);
    for (let t = 0; t < T; t++) {
      for (let j = 0; j < nStates; j++) {
        gammaSum[j] += gamma[t][j];
        newMeans[j] += gamma[t][j] * obs[t];
      }
    }
    for (let j = 0; j < nStates; j++) {
      newMeans[j] /= gammaSum[j] || 1;
    }
    for (let t = 0; t < T; t++) {
      for (let j = 0; j < nStates; j++) {
        newVariances[j] += gamma[t][j] * (obs[t] - newMeans[j]) ** 2;
      }
    }
    for (let j = 0; j < nStates; j++) {
      newVariances[j] = Math.max(newVariances[j] / (gammaSum[j] || 1), 1e-10);
    }

    // Transition matrix
    for (let t = 0; t < T - 1; t++) {
      for (let i = 0; i < nStates; i++) {
        for (let j = 0; j < nStates; j++) {
          const logXi =
            alpha[t][i] +
            Math.log(currentParams.transmat[i][j]) +
            gaussianLogPdf(obs[t + 1], currentParams.means[j], currentParams.variances[j]) +
            beta[t + 1][j] -
            logLikelihood;
          newTransmat[i][j] += Math.exp(logXi);
        }
      }
    }
    for (let i = 0; i < nStates; i++) {
      const rowSum = newTransmat[i].reduce((a, b) => a + b, 0) || 1;
      for (let j = 0; j < nStates; j++) newTransmat[i][j] /= rowSum;
    }

    currentParams = {
      nStates,
      means: newMeans,
      variances: newVariances,
      transmat: newTransmat,
      startprob: newStartprob,
    };
  }

  return currentParams;
}

function viterbi(obs: number[], params: HmmParams): number[] {
  const { nStates, means, variances, transmat, startprob } = params;
  const T = obs.length;
  const delta: number[][] = Array.from({ length: T }, () => Array(nStates).fill(-Infinity));
  const psi: number[][] = Array.from({ length: T }, () => Array(nStates).fill(0));

  for (let j = 0; j < nStates; j++) {
    delta[0][j] = Math.log(startprob[j]) + gaussianLogPdf(obs[0], means[j], variances[j]);
  }

  for (let t = 1; t < T; t++) {
    for (let j = 0; j < nStates; j++) {
      let best = -Infinity, bestI = 0;
      for (let i = 0; i < nStates; i++) {
        const v = delta[t - 1][i] + Math.log(transmat[i][j]);
        if (v > best) { best = v; bestI = i; }
      }
      delta[t][j] = best + gaussianLogPdf(obs[t], means[j], variances[j]);
      psi[t][j] = bestI;
    }
  }

  const states = Array(T).fill(0);
  let best = -Infinity;
  for (let j = 0; j < nStates; j++) {
    if (delta[T - 1][j] > best) { best = delta[T - 1][j]; states[T - 1] = j; }
  }
  for (let t = T - 2; t >= 0; t--) states[t] = psi[t + 1][states[t + 1]];

  return states;
}

function getStateLabels(n: number): string[] {
  if (n === 2) return ["Bull", "Bear"];
  if (n === 3) return ["Bull", "Flat", "Bear"];
  if (n === 4) return ["Strong Bull", "Mild Bull", "Mild Bear", "Strong Bear"];
  if (n === 5) return ["Strong Bull", "Bull", "Flat", "Bear", "Strong Bear"];
  const labels: string[] = [];
  for (let i = 0; i < n; i++) {
    const pos = i / (n - 1);
    if (pos < 0.2) labels.push("Strong Bull");
    else if (pos < 0.4) labels.push("Bull");
    else if (pos < 0.6) labels.push("Flat");
    else if (pos < 0.8) labels.push("Bear");
    else labels.push("Strong Bear");
  }
  return labels;
}

function getStateColors(n: number): string[] {
  if (n === 2) return ["#10b981", "#ef4444"];
  if (n === 3) return ["#10b981", "#f59e0b", "#ef4444"];
  if (n === 4) return ["#10b981", "#84cc16", "#f97316", "#ef4444"];
  if (n === 5) return ["#10b981", "#84cc16", "#f59e0b", "#f97316", "#ef4444"];
  const palette = ["#10b981", "#34d399", "#84cc16", "#f59e0b", "#f97316", "#ef4444", "#dc2626"];
  const colors: string[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i / (n - 1)) * (palette.length - 1));
    colors.push(palette[idx]);
  }
  return colors;
}

function orderStates(params: HmmParams): { mapping: Map<number, number>; labels: string[]; colors: string[] } {
  const { nStates, means } = params;
  const indices = means.map((_, i) => i).sort((a, b) => means[b] - means[a]);

  const mapping = new Map<number, number>();
  for (let newIdx = 0; newIdx < nStates; newIdx++) {
    mapping.set(indices[newIdx], newIdx);
  }

  return { mapping, labels: getStateLabels(nStates), colors: getStateColors(nStates) };
}

function reorderParams(params: HmmParams, mapping: Map<number, number>): HmmParams {
  const { nStates } = params;
  const inv = new Map<number, number>();
  mapping.forEach((v, k) => inv.set(v, k));

  const newMeans = Array(nStates).fill(0);
  const newVariances = Array(nStates).fill(0);
  const newTransmat = Array.from({ length: nStates }, () => Array(nStates).fill(0));
  const newStartprob = Array(nStates).fill(0);

  for (let i = 0; i < nStates; i++) {
    const oldI = inv.get(i)!;
    newMeans[i] = params.means[oldI];
    newVariances[i] = params.variances[oldI];
    newStartprob[i] = params.startprob[oldI];
    for (let j = 0; j < nStates; j++) {
      const oldJ = inv.get(j)!;
      newTransmat[i][j] = params.transmat[oldI][oldJ];
    }
  }

  return { nStates, means: newMeans, variances: newVariances, transmat: newTransmat, startprob: newStartprob };
}

function computeStationary(transmat: number[][]): number[] {
  const n = transmat.length;
  let pi = Array(n).fill(1 / n);
  for (let iter = 0; iter < 2000; iter++) {
    const next = Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) next[j] += pi[i] * transmat[i][j];
    }
    pi = next;
  }
  return pi;
}

function backtestStrategies(
  prices: number[],
  states: number[],
  nStates: number,
  nDays: number
): { momentum: StrategyResult; meanrev: StrategyResult; buyhold: StrategyResult } {
  const returns = prices.slice(1).map((p, i) => p / prices[i] - 1);
  const statesAligned = states.slice(1);

  const eqMom = [1], eqMR = [1], eqBH = [1];

  for (let i = 0; i < returns.length; i++) {
    const r = returns[i];
    const s = statesAligned[i];

    eqBH.push(eqBH[i] * (1 + r));

    let momR = 0, mrR = 0;
    if (s === 0) { momR = r; mrR = -r; }
    else if (s === nStates - 1) { momR = -r; mrR = r; }

    eqMom.push(eqMom[i] * (1 + momR));
    eqMR.push(eqMR[i] * (1 + mrR));
  }

  function calcStats(eq: number[], label: string): StrategyResult {
    const years = nDays / 252;
    const final = eq[eq.length - 1];
    const totalReturn = (final - 1) * 100;
    const cagr = years > 0 ? (Math.pow(Math.max(final, 0.001), 1 / years) - 1) * 100 : 0;

    const dailyR = eq.slice(1).map((v, i) => Math.log(v / eq[i]));
    const mean = dailyR.reduce((s, v) => s + v, 0) / dailyR.length;
    const std = Math.sqrt(dailyR.reduce((s, v) => s + (v - mean) ** 2, 0) / dailyR.length);
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

    let peak = eq[0], maxDD = 0;
    for (const v of eq) {
      peak = Math.max(peak, v);
      maxDD = Math.min(maxDD, (v - peak) / peak);
    }

    return { label, cagr, sharpe, maxDrawdown: maxDD * 100, totalReturn, equity: eq };
  }

  return {
    momentum: calcStats(eqMom, "Momentum"),
    meanrev: calcStats(eqMR, "Mean Reversion"),
    buyhold: calcStats(eqBH, "Buy & Hold"),
  };
}

export function fitHmm(
  prices: number[],
  dates: string[],
  nStates: number = 3,
  nFits?: number
): HmmResult {
  const actualFits = nFits ?? Math.max(10, nStates * 4);
  const logReturns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));

  let bestParams: HmmParams | null = null;
  let bestLL = -Infinity;

  for (let seed = 0; seed < actualFits; seed++) {
    try {
      const init = initializeParams(logReturns, nStates);
      // Add small random perturbation per seed
      for (let i = 0; i < nStates; i++) {
        init.means[i] += (seed * 0.0001 - actualFits * 0.00005);
        init.variances[i] *= (0.8 + seed * (0.4 / actualFits));
      }
      const fitted = baumWelch(logReturns, init);
      const { logLikelihood } = forward(logReturns, fitted);
      if (logLikelihood > bestLL) {
        bestLL = logLikelihood;
        bestParams = fitted;
      }
    } catch {
      continue;
    }
  }

  if (!bestParams) throw new Error("HMM fitting failed");

  const { mapping, labels, colors } = orderStates(bestParams);
  const ordered = reorderParams(bestParams, mapping);
  const rawStates = viterbi(logReturns, bestParams);
  const states = rawStates.map(s => mapping.get(s)!);
  // Prepend state for first day (same as second day's state)
  const fullStates = [states[0], ...states];

  const persistence = ordered.transmat.map((row, i) => row[i]);
  const avgPersistence = persistence.reduce((s, v) => s + v, 0) / nStates;
  const stationaryDist = computeStationary(ordered.transmat);
  const expectedDurations = persistence.map(p => p < 1 ? 1 / (1 - p) : Infinity);

  const regimeStats = labels.map((label, i) => {
    const count = fullStates.filter(s => s === i).length;
    return {
      label,
      color: colors[i],
      muAnn: ordered.means[i] * 252 * 100,
      sigmaAnn: Math.sqrt(ordered.variances[i]) * Math.sqrt(252) * 100,
      duration: expectedDurations[i],
      pctTime: (count / fullStates.length) * 100,
    };
  });

  const backtest = backtestStrategies(prices, fullStates, nStates, prices.length);

  const signal: "MOMENTUM" | "MEAN_REVERSION" | "MIXED" =
    avgPersistence > 0.6 ? "MOMENTUM" :
    avgPersistence < 0.4 ? "MEAN_REVERSION" : "MIXED";

  return {
    params: ordered,
    states: fullStates,
    stateLabels: labels,
    stateColors: colors,
    persistence,
    avgPersistence,
    stationaryDist,
    expectedDurations,
    regimeStats,
    backtest,
    prices,
    dates,
    signal,
  };
}
