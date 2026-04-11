/**
 * Copula-based tail-dependence analysis.
 *
 * Measures how a stock co-moves with its benchmark in the tails
 * (crash/rally extremes) — not captured by linear correlation.
 *
 * Lower tail dependence (λ_L): probability of co-crash
 * Upper tail dependence (λ_U): probability of co-rally
 * Asymmetry = λ_L - λ_U (positive = crashes more correlated than rallies)
 *
 * Uses:
 * - Empirical CDF to convert returns → uniform margins [0, 1]
 * - Clayton copula for lower tail: λ_L = 2^(-1/θ)
 * - Gumbel copula for upper tail: λ_U = 2 - 2^(1/θ)
 * - Maximum pseudo-likelihood estimation for θ
 */

export interface TailDependence {
  lowerTail: number;        // λ_L: co-crash probability (Clayton)
  upperTail: number;        // λ_U: co-rally probability (Gumbel)
  asymmetry: number;        // λ_L - λ_U (positive = crash-prone)
  claytonTheta: number;     // Clayton parameter (>0 = lower tail dependence)
  gumbelTheta: number;      // Gumbel parameter (≥1, higher = upper tail dep.)
  pearsonRho: number;       // Linear correlation for reference
  tailRatio: number;        // λ_L / max(λ_U, 0.01) — crash amplification factor
  regime: string;           // "crash-coupled" | "symmetric" | "rally-coupled" | "independent"
  riskLabel: string;        // Human-readable interpretation
}

function empiricalCdf(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  return values.map((v) => {
    let rank = 0;
    for (let i = 0; i < n; i++) {
      if (sorted[i] <= v) rank = i + 1;
      else break;
    }
    return rank / (n + 1);
  });
}

function fitClayton(u: number[], v: number[]): number {
  const n = u.length;
  if (n < 30) return 0;

  let best = 0.1;
  let bestLL = -Infinity;

  for (let theta = 0.1; theta <= 20; theta += 0.1) {
    let ll = 0;
    for (let i = 0; i < n; i++) {
      const ui = Math.max(u[i], 1e-6);
      const vi = Math.max(v[i], 1e-6);
      const a = Math.pow(ui, -theta) + Math.pow(vi, -theta) - 1;
      if (a <= 0) { ll = -Infinity; break; }
      const c12 = (1 + theta) * Math.pow(ui * vi, -theta - 1) * Math.pow(a, -1 / theta - 2);
      if (c12 > 0 && isFinite(c12)) {
        ll += Math.log(c12);
      } else {
        ll -= 10;
      }
    }
    if (ll > bestLL) {
      bestLL = ll;
      best = theta;
    }
  }
  return best;
}

function fitGumbel(u: number[], v: number[]): number {
  const n = u.length;
  if (n < 30) return 1;

  let best = 1;
  let bestLL = -Infinity;

  for (let theta = 1; theta <= 15; theta += 0.1) {
    let ll = 0;
    for (let i = 0; i < n; i++) {
      const ui = Math.max(u[i], 1e-6);
      const vi = Math.max(v[i], 1e-6);
      const lu = -Math.log(ui);
      const lv = -Math.log(vi);
      const A = Math.pow(Math.pow(lu, theta) + Math.pow(lv, theta), 1 / theta);
      const C = Math.exp(-A);
      if (C <= 0 || !isFinite(C)) { ll -= 10; continue; }
      const t1 = Math.pow(lu, theta - 1) / ui;
      const t2 = Math.pow(lv, theta - 1) / vi;
      const dA = Math.pow(Math.pow(lu, theta) + Math.pow(lv, theta), 1 / theta - 1);
      const c12 = C * dA * t1 * dA * t2 * (A + theta - 1) / (A * A);
      if (c12 > 0 && isFinite(c12)) {
        ll += Math.log(c12);
      } else {
        ll -= 10;
      }
    }
    if (ll > bestLL) {
      bestLL = ll;
      best = theta;
    }
  }
  return best;
}

export function computeTailDependence(
  stockReturns: number[],
  benchReturns: number[],
): TailDependence {
  const n = Math.min(stockReturns.length, benchReturns.length);
  const sr = stockReturns.slice(-n);
  const br = benchReturns.slice(-n);

  if (n < 60) {
    return {
      lowerTail: 0, upperTail: 0, asymmetry: 0,
      claytonTheta: 0, gumbelTheta: 1, pearsonRho: 0,
      tailRatio: 1, regime: "independent",
      riskLabel: "Insufficient data for tail analysis",
    };
  }

  const u = empiricalCdf(sr);
  const v = empiricalCdf(br);

  const claytonTheta = fitClayton(u, v);
  const gumbelTheta = fitGumbel(u, v);

  const lowerTail = claytonTheta > 0 ? Math.pow(2, -1 / claytonTheta) : 0;
  const upperTail = gumbelTheta > 1 ? 2 - Math.pow(2, 1 / gumbelTheta) : 0;
  const asymmetry = lowerTail - upperTail;
  const tailRatio = lowerTail / Math.max(upperTail, 0.01);

  const meanS = sr.reduce((a, b) => a + b, 0) / n;
  const meanB = br.reduce((a, b) => a + b, 0) / n;
  let cov = 0, varS = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const ds = sr[i] - meanS;
    const db = br[i] - meanB;
    cov += ds * db;
    varS += ds * ds;
    varB += db * db;
  }
  const pearsonRho = varS > 0 && varB > 0 ? cov / Math.sqrt(varS * varB) : 0;

  let regime: string;
  let riskLabel: string;

  if (lowerTail > 0.4 && asymmetry > 0.15) {
    regime = "crash-coupled";
    riskLabel = `High co-crash risk (λL=${lowerTail.toFixed(2)}). Crashes amplified ${tailRatio.toFixed(1)}x vs rallies. Reduce position near ATH.`;
  } else if (lowerTail > 0.3 && asymmetry > 0.05) {
    regime = "crash-coupled";
    riskLabel = `Moderate co-crash coupling (λL=${lowerTail.toFixed(2)}). Diversification weakens in drawdowns.`;
  } else if (upperTail > lowerTail + 0.1) {
    regime = "rally-coupled";
    riskLabel = `Rally-coupled (λU=${upperTail.toFixed(2)} > λL=${lowerTail.toFixed(2)}). Upside participation stronger than downside.`;
  } else if (lowerTail < 0.15 && upperTail < 0.15) {
    regime = "independent";
    riskLabel = "Low tail dependence — genuine diversifier in both tails.";
  } else {
    regime = "symmetric";
    riskLabel = `Symmetric tail dependence (λL=${lowerTail.toFixed(2)}, λU=${upperTail.toFixed(2)}). Normal co-movement profile.`;
  }

  return {
    lowerTail,
    upperTail,
    asymmetry,
    claytonTheta,
    gumbelTheta,
    pearsonRho,
    tailRatio,
    regime,
    riskLabel,
  };
}
