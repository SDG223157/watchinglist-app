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

// ═══════════════════════════════════════════════════════════════
// TYPES — Macro + Sector
// ═══════════════════════════════════════════════════════════════

export interface MacroAsset {
  key: string;
  name: string;
  ticker: string;
  category: string;
  price: number;
  hedge_score: number;
  arb_score: number;
  combined_score: number;
  m2_floor: number;
  arb_fair_value: number;
  net_signal: string;
  weight?: string;
}

export interface MacroAllocation {
  equities: { range: string; score: number };
  hard_assets: { range: string; score: number };
  cash_usd: { range: string; score: number };
  crypto: { range: string; score: number };
}

export interface Sector {
  key: string;
  name: string;
  etf: string;
  beta_type: string;
  peak_phase: string;
  ret_3m?: number;
  ret_12m?: number;
  alpha_3m: number;
  hedge_demand: number;
  arb_score: number;
  pe?: number | null;
  div_yield?: number | null;
}

export interface MacroWSEHolding {
  name: string;
  etf: string;
  category: string;
  weight_pct: number;
  amount: number;
  conviction_u: number;
  score: number;
  signal: string;
  m2_floor: number;
  arb_fair_value: number;
}

export interface MacroWSEResult {
  holdings: MacroWSEHolding[];
  summary: {
    count: number;
    capital: number;
    invested: number;
    cash: number;
    cash_pct: number;
    portfolio_entropy: number;
    equal_weight_entropy: number;
    entropy_ratio: number;
    regime: string;
    categories: Record<string, number>;
  };
}

export interface SectorWSEHolding {
  name: string;
  etf: string;
  beta_type: string;
  weight_pct: number;
  amount: number;
  conviction_u: number;
  alpha_3m: number;
  arb_score: number;
  hedge_demand: number;
  quadrant: string;
  peak_phase: string;
}

export interface SectorWSEResult {
  holdings: SectorWSEHolding[];
  summary: {
    count: number;
    capital: number;
    invested: number;
    cash: number;
    cash_pct: number;
    portfolio_entropy: number;
    equal_weight_entropy: number;
    entropy_ratio: number;
    regime: string;
    spread: number;
    defensive_pct: number;
    cyclical_pct: number;
  };
}

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

  const pvSig = (s.pv_divergence_signal || "").toUpperCase();
  if (pvSig === "ACCUMULATION") base *= 1.15;
  else if (pvSig === "QUIET_BUILDUP") base *= 1.08;
  else if (pvSig === "DISTRIBUTION") base *= 0.8;
  else if (pvSig === "CAPITULATION") base *= 0.9;

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


// ═══════════════════════════════════════════════════════════════
// LAYER 1: MACRO WSE — Cross-Asset Allocation
// ═══════════════════════════════════════════════════════════════

const REGIME_BOUNDS: Record<string, Record<string, [number, number]>> = {
  EXPANSION: { equities: [0.50, 0.70], hard_assets: [0.05, 0.15], cash_usd: [0.05, 0.15], crypto: [0.03, 0.10] },
  BOOM:      { equities: [0.55, 0.70], hard_assets: [0.05, 0.10], cash_usd: [0.05, 0.10], crypto: [0.05, 0.10] },
  TRANSITION:{ equities: [0.35, 0.55], hard_assets: [0.10, 0.20], cash_usd: [0.10, 0.25], crypto: [0.02, 0.08] },
  COOLING:   { equities: [0.25, 0.40], hard_assets: [0.10, 0.25], cash_usd: [0.15, 0.30], crypto: [0.00, 0.05] },
  "LATE-CYCLE": { equities: [0.20, 0.35], hard_assets: [0.15, 0.25], cash_usd: [0.20, 0.30], crypto: [0.00, 0.05] },
};

const CATEGORY_ETFS: Record<string, { etf: string; assetKey: string }[]> = {
  equities:    [{ etf: "SPY", assetKey: "spy" }, { etf: "QQQ", assetKey: "spy" }, { etf: "VWO", assetKey: "spy" }],
  hard_assets: [{ etf: "GLD", assetKey: "gold" }, { etf: "SLV", assetKey: "silver" }, { etf: "USO", assetKey: "oil" }],
  cash_usd:    [{ etf: "SHV", assetKey: "usd" }, { etf: "TLT", assetKey: "usd" }],
  crypto:      [{ etf: "IBIT", assetKey: "btc" }],
};

/**
 * Macro-level informational weight for a cross-asset class.
 * Inverts combined_score: low combined = strong buy signal = high u_i.
 */
function macroConvictionU(asset: MacroAsset, regime: string): number {
  let base = 1.0;

  // Combined score → conviction (inverted: low score = buy signal = high conviction)
  const cs = asset.combined_score ?? 50;
  base *= 2.0 - (cs / 100) * 1.5; // cs=0 → 2.0x, cs=50 → 1.25x, cs=100 → 0.5x

  // M2 floor proximity: near floor = anchored = high conviction
  if (asset.m2_floor > 0 && asset.price > 0) {
    const floorDist = (asset.price / asset.m2_floor - 1);
    if (floorDist < 0.05) base *= 1.3;       // within 5% of floor
    else if (floorDist < 0.15) base *= 1.15;  // within 15%
    else if (floorDist > 0.50) base *= 0.8;   // 50%+ above floor
  }

  // Arb fair value proximity
  if (asset.arb_fair_value > 0 && asset.price > 0) {
    const arbDist = (asset.price / asset.arb_fair_value - 1);
    if (arbDist < -0.10) base *= 1.2;   // 10%+ below fair = cheap
    else if (arbDist > 0.20) base *= 0.8; // 20%+ above = expensive
  }

  // Regime fit: gold/silver in risk-off, equities in expansion
  const cat = asset.category?.toLowerCase() || "";
  if ((regime === "COOLING" || regime === "LATE-CYCLE") && (cat.includes("commodity") || cat.includes("currency"))) {
    base *= 1.15;
  }
  if ((regime === "EXPANSION" || regime === "BOOM") && cat.includes("equity")) {
    base *= 1.15;
  }

  // Net signal boost
  const sig = (asset.net_signal || "").toUpperCase();
  if (sig.includes("STRONG BUY")) base *= 1.3;
  else if (sig.includes("ACCUMULATE")) base *= 1.15;
  else if (sig.includes("TRIM")) base *= 0.6;

  return Math.max(0.3, Math.min(2.5, base));
}

export function buildMacroWSEPortfolio(
  assets: MacroAsset[],
  alloc: MacroAllocation,
  regime: string,
  capital: number,
): MacroWSEResult {
  const bounds = REGIME_BOUNDS[regime] || REGIME_BOUNDS["TRANSITION"];
  const assetMap = new Map(assets.map((a) => [a.key?.toLowerCase() || a.name?.toLowerCase(), a]));

  // Build category-level WSE first
  const categories = Object.keys(CATEGORY_ETFS) as (keyof typeof CATEGORY_ETFS)[];
  const n = categories.length;

  // u_i per category: average conviction of underlying assets
  const catU: number[] = categories.map((cat) => {
    const etfs = CATEGORY_ETFS[cat];
    const uValues = etfs.map((e) => {
      const a = assetMap.get(e.assetKey);
      return a ? macroConvictionU(a, regime) : 1.0;
    });
    return uValues.reduce((s, v) => s + v, 0) / uValues.length;
  });

  const uSum = catU.reduce((a, b) => a + b, 0);
  const uNorm = catU.map((v) => v / uSum);

  // Category bounds from regime
  const catBounds: [number, number][] = categories.map((cat) => bounds[cat] || [0.05, 0.30]);

  // WSE optimization with category bounds
  let p = uNorm.map((v, i) => Math.max(catBounds[i][0], Math.min(catBounds[i][1], v)));
  const pSum = p.reduce((a, b) => a + b, 0);
  p = p.map((v) => v / pSum);

  // Projected gradient ascent
  for (let iter = 0; iter < 1000; iter++) {
    const grad = p.map((pi, i) => -uNorm[i] * (Math.log(Math.max(pi, 1e-12)) + 1));
    let pNew = p.map((pi, i) => pi + 0.005 * grad[i]);
    pNew = pNew.map((v, i) => Math.max(catBounds[i][0], Math.min(catBounds[i][1], v)));
    const s = pNew.reduce((a, b) => a + b, 0);
    if (s > 0) pNew = pNew.map((v) => v / s);
    pNew = pNew.map((v, i) => Math.max(catBounds[i][0], Math.min(catBounds[i][1], v)));
    const s2 = pNew.reduce((a, b) => a + b, 0);
    if (s2 > 0) pNew = pNew.map((v) => v / s2);
    p = pNew;
  }

  // Compute entropy
  const pSafe = p.map((v) => Math.max(v, 1e-12));
  const portfolioH = -pSafe.reduce((sum, pi, i) => sum + uNorm[i] * pi * Math.log(pi), 0);
  const eqW = 1 / n;
  const eqH = -uNorm.reduce((sum, ui) => sum + ui * eqW * Math.log(eqW), 0);
  const ratio = eqH > 0 ? portfolioH / eqH : 0;

  // Expand categories to individual ETF holdings
  const holdings: MacroWSEHolding[] = [];
  let totalInvested = 0;
  const catWeights: Record<string, number> = {};

  for (let ci = 0; ci < n; ci++) {
    const cat = categories[ci];
    const catWeight = p[ci];
    const etfs = CATEGORY_ETFS[cat];
    const perEtf = catWeight / etfs.length;
    catWeights[cat] = Math.round(catWeight * 10000) / 100;

    for (const e of etfs) {
      const asset = assetMap.get(e.assetKey);
      const amount = capital * perEtf;
      totalInvested += amount;

      holdings.push({
        name: e.etf,
        etf: e.etf,
        category: cat.replace(/_/g, " "),
        weight_pct: Math.round(perEtf * 10000) / 100,
        amount: Math.round(amount),
        conviction_u: catU[ci],
        score: asset?.combined_score ?? 50,
        signal: asset?.net_signal ?? "HOLD",
        m2_floor: asset?.m2_floor ?? 0,
        arb_fair_value: asset?.arb_fair_value ?? 0,
      });
    }
  }

  holdings.sort((a, b) => b.weight_pct - a.weight_pct);
  const cash = capital - totalInvested;

  return {
    holdings,
    summary: {
      count: holdings.length,
      capital,
      invested: Math.round(totalInvested),
      cash: Math.round(cash),
      cash_pct: Math.round((cash / capital) * 1000) / 10,
      portfolio_entropy: Math.round(portfolioH * 1000000) / 1000000,
      equal_weight_entropy: Math.round(eqH * 1000000) / 1000000,
      entropy_ratio: Math.round(ratio * 10000) / 10000,
      regime,
      categories: catWeights,
    },
  };
}


// ═══════════════════════════════════════════════════════════════
// LAYER 2: SECTOR WSE — Rotation Within Equities
// ═══════════════════════════════════════════════════════════════

const SECTOR_ETF_MAP: Record<string, string> = {
  staples: "XLP", utilities: "XLU", healthcare: "XLV", real_estate: "XLRE",
  tech: "XLK", consumer_disc: "XLY", financials: "XLF", industrials: "XLI",
  energy: "XLE", materials: "XLB", comm_services: "XLC",
  consumer_staples: "XLP", technology: "XLK", consumer_discretionary: "XLY",
  communication_services: "XLC",
};

/**
 * Sector-level informational weight from sector signals.
 */
function sectorConvictionU(s: Sector, regime: string): number {
  let base = 1.0;

  // Alpha momentum: positive alpha = information advantage
  const alpha = s.alpha_3m ?? 0;
  if (alpha > 8) base *= 1.3;
  else if (alpha > 3) base *= 1.15;
  else if (alpha < -5) base *= 0.7;
  else if (alpha < -2) base *= 0.85;

  // Arb score: low = cheap = high conviction
  const arb = s.arb_score ?? 50;
  base *= 1.5 - (arb / 100);  // arb=0 → 1.5x, arb=50 → 1.0x, arb=100 → 0.5x

  // Hedge demand in risk-off regime = valuable
  const hd = s.hedge_demand ?? 50;
  if ((regime === "COOLING" || regime === "LATE-CYCLE") && hd > 60) {
    base *= 1.2;
  }

  // Regime fit: defensive in risk-off, cyclical in expansion
  const isDefensive = s.beta_type === "defensive";
  if ((regime === "COOLING" || regime === "LATE-CYCLE") && isDefensive) {
    base *= 1.2;
  } else if ((regime === "EXPANSION" || regime === "BOOM") && !isDefensive) {
    base *= 1.2;
  } else if ((regime === "EXPANSION" || regime === "BOOM") && isDefensive) {
    base *= 0.8;
  }

  // Peak phase: "current" sectors get a tilt
  const phase = (s.peak_phase || "").toLowerCase();
  if (phase === "current" || phase === "peak") base *= 1.1;
  if (phase === "trough" || phase === "past") base *= 0.9;

  return Math.max(0.3, Math.min(2.5, base));
}

function sectorQuadrant(s: Sector): string {
  const highHedge = (s.hedge_demand ?? 0) > 60;
  const cheap = (s.arb_score ?? 50) < 30;
  const rich = (s.arb_score ?? 50) > 70;
  if (highHedge && cheap) return "Cheap Hedge";
  if (highHedge && rich) return "Expensive Hedge";
  if (!highHedge && cheap) return "Cheap Growth";
  if (!highHedge && rich) return "Expensive Growth";
  return "Neutral";
}

export function buildSectorWSEPortfolio(
  sectors: Sector[],
  regime: string,
  spread: number,
  capital: number,
): SectorWSEResult {
  const n = sectors.length;
  if (n === 0) {
    return {
      holdings: [],
      summary: {
        count: 0, capital, invested: 0, cash: capital, cash_pct: 100,
        portfolio_entropy: 0, equal_weight_entropy: 0, entropy_ratio: 0,
        regime, spread, defensive_pct: 0, cyclical_pct: 0,
      },
    };
  }

  const uRaw = sectors.map((s) => sectorConvictionU(s, regime));
  const uSum = uRaw.reduce((a, b) => a + b, 0);
  const uNorm = uRaw.map((v) => v / uSum);

  // Bounds: 3-15% per sector, slightly tighter
  const minW = 0.03;
  const maxW = 0.15;

  const weights = optimizeWSE(uNorm, n, minW, maxW, {}, 1.0);

  // Compute entropy
  const pSafe = weights.map((w) => Math.max(w, 1e-12));
  const portfolioH = -pSafe.reduce((sum, pi, i) => sum + uNorm[i] * pi * Math.log(pi), 0);
  const eqW = 1 / n;
  const eqH = -uNorm.reduce((sum, ui) => sum + ui * eqW * Math.log(eqW), 0);
  const ratio = eqH > 0 ? portfolioH / eqH : 0;

  const holdings: SectorWSEHolding[] = [];
  let totalInvested = 0;
  let defensivePct = 0;
  let cyclicalPct = 0;

  for (let i = 0; i < n; i++) {
    const s = sectors[i];
    const wt = weights[i];
    const amount = capital * wt;
    totalInvested += amount;

    const etf = SECTOR_ETF_MAP[s.key] || s.etf || s.key.toUpperCase();
    const quadrant = sectorQuadrant(s);
    const isDefensive = s.beta_type === "defensive";

    if (isDefensive) defensivePct += wt * 100;
    else cyclicalPct += wt * 100;

    holdings.push({
      name: s.name,
      etf,
      beta_type: s.beta_type || "cyclical",
      weight_pct: Math.round(wt * 10000) / 100,
      amount: Math.round(amount),
      conviction_u: uRaw[i],
      alpha_3m: s.alpha_3m ?? 0,
      arb_score: s.arb_score ?? 50,
      hedge_demand: s.hedge_demand ?? 50,
      quadrant,
      peak_phase: s.peak_phase || "",
    });
  }

  holdings.sort((a, b) => b.weight_pct - a.weight_pct);
  const cash = capital - totalInvested;

  return {
    holdings,
    summary: {
      count: holdings.length,
      capital,
      invested: Math.round(totalInvested),
      cash: Math.round(cash),
      cash_pct: Math.round((cash / capital) * 1000) / 10,
      portfolio_entropy: Math.round(portfolioH * 1000000) / 1000000,
      equal_weight_entropy: Math.round(eqH * 1000000) / 1000000,
      entropy_ratio: Math.round(ratio * 10000) / 10000,
      regime,
      spread: Math.round(spread * 100) / 100,
      defensive_pct: Math.round(defensivePct * 10) / 10,
      cyclical_pct: Math.round(cyclicalPct * 10) / 10,
    },
  };
}
