/**
 * Weighted Shannon Entropy (WSE) Portfolio Optimizer
 *
 * Implements Șerban & Dedu (2025): maximize portfolio diversification via
 * weighted Shannon entropy, using HMM × Entropy signal-layer outputs as
 * informational weights u_i.
 *
 * Objective: max H_u(p) = -Σ u_i p_i ln(p_i)
 * Subject to: Σ p_i = 1, p_min ≤ p_i ≤ p_max, sector caps
 *
 * Ref: Preprints 2025, 202509.0079
 */

import type { WatchlistStock } from "./db";

export interface WSEHolding {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  weight_pct: number;
  amount: number;
  shares: number;
  conviction_u: number;
  score: number;
  green_walls: number;
  hmm_regime: string;
  hmm_persistence: number;
  entropy_regime: string;
  cog_gap: number;
  anchor_failure: boolean;
  trend_signal: string;
  momentum_type: string;
}

export interface WSEResult {
  holdings: WSEHolding[];
  summary: {
    count: number;
    capital: number;
    invested: number;
    cash: number;
    cash_pct: number;
    avg_score: number;
    avg_conviction_u: number;
    portfolio_entropy: number;
    equal_weight_entropy: number;
    entropy_ratio: number;
    sectors: Record<string, number>;
    excluded_count: number;
  };
}

/**
 * Convert signal-layer outputs to a numeric conviction weight u_i ∈ [0.3, 2.0].
 * Higher = more informational weight = optimizer allocates more to this asset.
 */
export function convictionNumeric(s: WatchlistStock): number {
  let base = 1.0;

  const hmm = (s.hmm_regime || "").toLowerCase();
  const hmmP = s.hmm_persistence || 0;
  if (hmm.includes("bull")) {
    base *= 1.0 + Math.min(hmmP, 0.99) * 0.3;
  } else if (hmm.includes("bear")) {
    base *= hmmP > 0.90 ? 0.5 : 0.7;
  }

  const er = (s.entropy_regime || "").toLowerCase();
  if (er.includes("compressed")) {
    const es = (s.emotion_signal || "").toLowerCase();
    base *= es === "high" ? 1.3 : 1.15;
  } else if (er.includes("diverse")) {
    base *= 0.85;
  }

  const cog = s.cog_gap || 0;
  if (cog >= 7) base *= 1.2;
  else if (cog >= 5) base *= 1.1;

  if (s.anchor_failure) base *= 1.25;

  const cs = s.composite_score || 50;
  base *= 0.8 + (Math.min(Math.max(cs, 0), 100) / 100) * 0.4;

  const mt = (s.momentum_type || "").toLowerCase();
  if (mt === "structural") base *= 1.1;
  else if (mt === "factor-only") base *= 0.8;

  const ts = (s.trend_signal || "").toLowerCase();
  if (ts.includes("open")) base *= 1.1;
  else if (ts.includes("closed") || ts.includes("no signal")) base *= 0.9;

  const gw = s.green_walls || 0;
  const rw = s.red_walls || 0;
  base *= 1.0 + (gw - rw) * 0.05;

  return Math.max(0.3, Math.min(2.0, Math.round(base * 10000) / 10000));
}

/**
 * SLSQP-like iterative optimization for max WSE.
 * Uses projected gradient ascent on the entropy objective with box + simplex constraints.
 */
function optimizeWSE(
  u: number[],
  n: number,
  minW: number,
  maxW: number,
  sectorIndices: Record<string, number[]>,
  sectorCap: number,
): number[] {
  // Initialize: conviction-proportional
  const uSum = u.reduce((a, b) => a + b, 0);
  let p = u.map((v) => v / uSum);
  p = p.map((v) => Math.max(minW, Math.min(maxW, v)));
  const pSum = p.reduce((a, b) => a + b, 0);
  p = p.map((v) => v / pSum);

  const lr = 0.01;
  const iterations = 2000;

  for (let iter = 0; iter < iterations; iter++) {
    // Gradient of H_u(p) = -Σ u_i p_i ln(p_i)
    // ∂H/∂p_i = -u_i (ln(p_i) + 1)
    const grad = p.map((pi, i) => -u[i] * (Math.log(Math.max(pi, 1e-12)) + 1));

    // Gradient ascent step
    let pNew = p.map((pi, i) => pi + lr * grad[i]);

    // Project onto bounds
    pNew = pNew.map((v) => Math.max(minW, Math.min(maxW, v)));

    // Project onto simplex (normalize to sum=1)
    const s = pNew.reduce((a, b) => a + b, 0);
    if (s > 0) pNew = pNew.map((v) => v / s);

    // Re-clip after normalization
    pNew = pNew.map((v) => Math.max(minW, Math.min(maxW, v)));
    const s2 = pNew.reduce((a, b) => a + b, 0);
    if (s2 > 0) pNew = pNew.map((v) => v / s2);

    // Sector cap enforcement
    for (const [, indices] of Object.entries(sectorIndices)) {
      const sectorTotal = indices.reduce((sum, i) => sum + pNew[i], 0);
      if (sectorTotal > sectorCap && indices.length > 1) {
        const scale = sectorCap / sectorTotal;
        for (const i of indices) pNew[i] *= scale;
        // Redistribute to other assets
        const deficit = sectorTotal - sectorCap;
        const otherIndices = Array.from({ length: n }, (_, i) => i).filter(
          (i) => !indices.includes(i),
        );
        if (otherIndices.length > 0) {
          const perOther = deficit / otherIndices.length;
          for (const i of otherIndices) {
            pNew[i] = Math.min(maxW, pNew[i] + perOther);
          }
        }
        // Renormalize
        const s3 = pNew.reduce((a, b) => a + b, 0);
        if (s3 > 0) pNew = pNew.map((v) => v / s3);
      }
    }

    p = pNew;
  }

  return p;
}

function passesHardGates(s: WatchlistStock): [boolean, string] {
  const gw = s.green_walls || 0;
  if (gw < 3) return [false, `Only ${gw} green walls (need 3+)`];
  const stage = s.corporate_stage || "";
  if (stage.includes("Stage 6") || stage.includes("Decline"))
    return [false, "Stage 6 Decline"];
  const wc = s.wall_combo || "";
  if (wc === "Worst Quadrant") return [false, "Worst Quadrant"];
  const crf = s.capex_risk_flag || "";
  if (crf.includes("EmpireBuilding") && crf.includes("PoorAccruals"))
    return [false, "Empire building + poor accruals"];
  if ((s.accrual_flag || "") === "Poor" && crf.includes("HighCapexBurn"))
    return [false, "Poor accruals + high CAPEX burn"];
  if (!s.price || s.price <= 0) return [false, "No price data"];
  return [true, "Passed"];
}

export function buildWSEPortfolio(
  stocks: WatchlistStock[],
  capital: number,
  maxHoldings: number = 25,
  sectorCapPct: number = 30,
): WSEResult {
  const excluded: { symbol: string; reason: string }[] = [];
  const candidates: WatchlistStock[] = [];

  for (const s of stocks) {
    const [passed, reason] = passesHardGates(s);
    if (passed) {
      candidates.push(s);
    } else {
      excluded.push({ symbol: s.symbol, reason });
    }
  }

  candidates.sort(
    (a, b) =>
      (b.composite_score || 0) - (a.composite_score || 0) ||
      (a.pe_ratio || 999) - (b.pe_ratio || 999),
  );
  const selected = candidates.slice(0, maxHoldings);
  const n = selected.length;

  if (n === 0) {
    return {
      holdings: [],
      summary: {
        count: 0, capital, invested: 0, cash: capital, cash_pct: 100,
        avg_score: 0, avg_conviction_u: 0, portfolio_entropy: 0,
        equal_weight_entropy: 0, entropy_ratio: 0, sectors: {},
        excluded_count: excluded.length,
      },
    };
  }

  const uRaw = selected.map(convictionNumeric);
  const uSum = uRaw.reduce((a, b) => a + b, 0);
  const uNorm = uRaw.map((v) => v / uSum);

  // Build sector index map
  const sectorIndices: Record<string, number[]> = {};
  for (let i = 0; i < n; i++) {
    const sec = (selected[i].sector || "Other").trim();
    if (!sectorIndices[sec]) sectorIndices[sec] = [];
    sectorIndices[sec].push(i);
  }

  // Bounds
  let minW = 0.02;
  let maxW = 0.08;
  if (n * minW > 1.0) minW = 0.5 / n;
  if (n * maxW < 1.0) maxW = Math.min(1.5 / n, 1.0);

  const weights = optimizeWSE(
    uNorm, n, minW, maxW, sectorIndices, sectorCapPct / 100,
  );

  // Compute entropies
  const pSafe = weights.map((w) => Math.max(w, 1e-12));
  const portfolioEntropy = -pSafe.reduce(
    (sum, pi, i) => sum + uNorm[i] * pi * Math.log(pi), 0,
  );
  const eqW = 1 / n;
  const eqEntropy = -uNorm.reduce(
    (sum, ui) => sum + ui * eqW * Math.log(eqW), 0,
  );
  const entropyRatio = eqEntropy > 0 ? portfolioEntropy / eqEntropy : 0;

  const holdings: WSEHolding[] = [];
  let totalInvested = 0;

  for (let i = 0; i < n; i++) {
    const s = selected[i];
    const wt = weights[i];
    const price = s.price || 1;
    const amount = capital * wt;
    const shares = Math.floor(amount / price);
    const actual = shares * price;
    totalInvested += actual;

    holdings.push({
      symbol: s.symbol,
      name: s.name,
      sector: (s.sector || "Other").trim(),
      price: Math.round(price * 100) / 100,
      weight_pct: Math.round(wt * 10000) / 100,
      amount: Math.round(actual),
      shares,
      conviction_u: uRaw[i],
      score: s.composite_score || 0,
      green_walls: s.green_walls || 0,
      hmm_regime: s.hmm_regime || "N/A",
      hmm_persistence: s.hmm_persistence || 0,
      entropy_regime: s.entropy_regime || "normal",
      cog_gap: s.cog_gap || 0,
      anchor_failure: s.anchor_failure || false,
      trend_signal: s.trend_signal || "",
      momentum_type: s.momentum_type || "",
    });
  }

  holdings.sort((a, b) => b.weight_pct - a.weight_pct);

  const cash = capital - totalInvested;
  const sectors: Record<string, number> = {};
  for (const h of holdings)
    sectors[h.sector] = (sectors[h.sector] || 0) + h.weight_pct;

  return {
    holdings,
    summary: {
      count: holdings.length,
      capital,
      invested: Math.round(totalInvested),
      cash: Math.round(cash),
      cash_pct: Math.round((cash / capital) * 1000) / 10,
      avg_score: holdings.length
        ? Math.round(
            (holdings.reduce((s, h) => s + h.score, 0) / holdings.length) * 10,
          ) / 10
        : 0,
      avg_conviction_u: holdings.length
        ? Math.round(
            (holdings.reduce((s, h) => s + h.conviction_u, 0) /
              holdings.length) *
              1000,
          ) / 1000
        : 0,
      portfolio_entropy: Math.round(portfolioEntropy * 1000000) / 1000000,
      equal_weight_entropy: Math.round(eqEntropy * 1000000) / 1000000,
      entropy_ratio: Math.round(entropyRatio * 10000) / 10000,
      sectors: Object.fromEntries(
        Object.entries(sectors).sort((a, b) => b[1] - a[1]),
      ),
      excluded_count: excluded.length,
    },
  };
}
