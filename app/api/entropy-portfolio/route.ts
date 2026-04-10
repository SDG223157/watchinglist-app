import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchAllLatest } from "@/lib/db";
import type { WatchlistStock } from "@/lib/db";
import { isAnalyzed } from "@/lib/db";

export const dynamic = "force-dynamic";

interface EntropyPortfolioHolding {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  weight_pct: number;
  amount: number;
  shares: number;
  hmm_regime: string;
  hmm_persistence: number;
  entropy_regime: string;
  entropy_percentile: number;
  cog_gap: number;
  anchor_failure: boolean;
  geometric_order: number;
  trend_signal: string;
  conviction: string;
  kelly_fraction: number;
  notes: string;
}

/**
 * Kelly-inspired sizing: edge / variance, capped at fractional Kelly.
 * Edge proxy: composite_score normalized to [-1, 1] range.
 * Variance proxy: inverse of HMM persistence (high persistence = low variance).
 */
function kellyFraction(s: WatchlistStock): number {
  const score = s.composite_score || 50;
  const edge = (score - 50) / 50; // -1 to +1
  const persistence = s.hmm_persistence || 0.5;
  const variance = 1 - persistence; // low persistence = high variance

  if (edge <= 0 || variance <= 0) return 0;
  const fullKelly = edge / (variance * 10); // scale down
  return Math.max(0, Math.min(0.15, fullKelly * 0.25)); // quarter-Kelly, max 15%
}

/**
 * Entropy-based conviction: how much to trust your signal.
 *
 * v3: Adds crowded-trade detection. Compressed entropy at ATH with
 * high PE = everyone bought for one reason (crowded), NOT "nobody is
 * looking" (hidden gem). Downgrades conviction for expensive + compressed.
 *
 * The key distinction:
 *   Compressed + far from ATH + reasonable PE = HIDDEN GEM → upgrade
 *   Compressed + near ATH + extreme PE = CROWDED TRADE → downgrade
 */
function entropyConviction(s: WatchlistStock): { level: string; multiplier: number } {
  const regime = (s.entropy_regime || "normal").toLowerCase();
  const cog = s.cog_gap || 0;
  const anchor = s.anchor_failure || false;
  const pctile = s.entropy_percentile || 50;

  if (!regime.includes("compressed")) {
    if (regime.includes("diverse") && pctile > 80) {
      return { level: "NORMAL", multiplier: 1.0 };
    }
    return { level: "STANDARD", multiplier: 1.0 };
  }

  // --- Compressed regime: is this a hidden gem or a crowded trade? ---

  // Parse ATH distance
  const athStr = s.distance_from_ath || "";
  const athMatch = athStr.match(/-?([\d.]+)%/);
  const athDist = athMatch ? -Math.abs(parseFloat(athMatch[1])) : 0;
  const pe = s.pe_ratio || s.pe_ttm || 0;

  const nearATH = athDist > -15;       // within 15% of ATH
  const expensivePE = pe > 40;         // PE > 40x
  const cheapPE = pe > 0 && pe < 20;   // PE < 20x (genuinely cheap)
  const farFromATH = athDist <= -25;    // 25%+ below ATH

  // Crowded trade detection: compressed + near ATH + expensive
  if (nearATH && expensivePE && cog >= 5) {
    // Everyone bought for one reason. This is NOT "nobody is looking."
    // Downgrade from HIGH/MAXIMUM to ELEVATED with warning.
    return { level: "CROWDED", multiplier: 0.7 };
  }
  if (nearATH && expensivePE) {
    return { level: "CROWDED", multiplier: 0.8 };
  }

  // Hidden gem: compressed + far from ATH = real opportunity
  if (anchor && farFromATH) {
    return { level: "MAXIMUM", multiplier: 1.5 };
  }
  if (anchor) {
    return { level: "MAXIMUM", multiplier: 1.4 };
  }
  if (cog >= 5 && farFromATH) {
    return { level: "HIGH", multiplier: 1.4 };
  }
  if (cog >= 5) {
    return { level: "HIGH", multiplier: 1.3 };
  }
  if (farFromATH && cheapPE) {
    return { level: "HIGH", multiplier: 1.3 };
  }
  return { level: "ELEVATED", multiplier: 1.1 };
}

/**
 * HMM regime filter with TIERED ENTRY (v2 — backtest-informed).
 *
 * Key insight from 002475.SZ backtest: TrendWise is a lagging indicator.
 * HIGH conviction signals averaged +32.9% in 60d but were never bought
 * because TrendWise was Closed. By the time TW fired Open (~40d later),
 * 30-50% of the move was done and the entropy edge had evaporated.
 *
 * Fix: Allow early partial entry when conviction is HIGH or MAXIMUM,
 * even with TrendWise Closed. Full position when TW confirms.
 *
 * Tiered entry:
 *   STANDARD + TW Closed  → SKIP (no edge, no momentum)
 *   ELEVATED + TW Closed  → SKIP (mild edge, not enough)
 *   HIGH     + TW Closed  → ENTER 1/3 position (strong edge, accept lag)
 *   MAXIMUM  + TW Closed  → ENTER 1/2 position (strongest edge, worth it)
 *   Any      + TW Open    → Full position (momentum confirmed)
 */
function hmmSizing(
  s: WatchlistStock,
  conviction: { level: string; multiplier: number },
): { include: boolean; multiplier: number; reason: string } {
  const regime = (s.hmm_regime || "").toLowerCase();
  const p = s.hmm_persistence || 0;
  const trend = (s.trend_signal || "").toLowerCase();
  const geo = s.geometric_order ?? 2;
  const twOpen = trend.includes("open");

  // Geometric order filter: skip Order 3 (jerk — fragile) always
  if (geo >= 3) {
    return { include: false, multiplier: 0, reason: "Geometric Order 3 (fragile)" };
  }

  // Bear regime with high persistence: skip (unless MAXIMUM conviction)
  if (regime.includes("bear") && p > 0.85) {
    if (conviction.level === "MAXIMUM" && twOpen) {
      return { include: true, multiplier: 0.3, reason: `Bear ${(p*100).toFixed(0)}% BUT MAXIMUM conviction + TW Open → 1/3` };
    }
    return { include: false, multiplier: 0, reason: "Bear regime, high persistence" };
  }

  // Bull regime
  if (regime.includes("bull")) {
    if (twOpen) {
      if (p > 0.95) return { include: true, multiplier: 1.2, reason: `Bull ${(p*100).toFixed(0)}% + TW Open — full` };
      if (p > 0.85) return { include: true, multiplier: 1.0, reason: `Bull ${(p*100).toFixed(0)}% + TW Open` };
      return { include: true, multiplier: 0.8, reason: `Bull low-p ${(p*100).toFixed(0)}% + TW Open` };
    }
    // Bull but TW Closed — tiered by conviction
    if (conviction.level === "MAXIMUM") return { include: true, multiplier: 0.5, reason: `Bull ${(p*100).toFixed(0)}% TW Closed → 1/2 (MAXIMUM)` };
    if (conviction.level === "HIGH") return { include: true, multiplier: 0.33, reason: `Bull ${(p*100).toFixed(0)}% TW Closed → 1/3 (HIGH)` };
    return { include: false, multiplier: 0, reason: `Bull ${(p*100).toFixed(0)}% TW Closed — wait for TW` };
  }

  // Flat regime — tiered entry
  if (regime.includes("flat")) {
    if (twOpen) {
      return { include: true, multiplier: p > 0.9 ? 0.8 : 0.6, reason: `Flat + TW Open` };
    }
    // Flat + TW Closed — tiered by conviction
    if (conviction.level === "MAXIMUM") return { include: true, multiplier: 0.4, reason: `Flat TW Closed → 2/5 (MAXIMUM — early entry)` };
    if (conviction.level === "HIGH") return { include: true, multiplier: 0.25, reason: `Flat TW Closed → 1/4 (HIGH — early entry)` };
    return { include: false, multiplier: 0, reason: "Flat TW Closed — wait for TW" };
  }

  // Default
  if (twOpen) {
    return { include: true, multiplier: 0.7, reason: "Unknown regime, TW Open" };
  }
  if (conviction.level === "MAXIMUM") return { include: true, multiplier: 0.3, reason: "Unknown regime, MAXIMUM conviction → 1/3 early" };
  return { include: false, multiplier: 0, reason: "No clear regime signal" };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const capital = Number(body.capital) || 1_000_000;
  const market = (body.market || "ALL").toUpperCase();
  const maxHoldings = Number(body.maxHoldings) || 20;

  const allStocks = await fetchAllLatest();
  const filtered = allStocks.filter((s) => {
    if (!isAnalyzed(s)) return false;
    if (market === "US") return !s.symbol.includes(".") || s.symbol.includes(".US");
    if (market === "HK") return s.symbol.includes(".HK");
    if (market === "CN") return s.symbol.includes(".SS") || s.symbol.includes(".SZ");
    if (market === "CHINA") return s.symbol.includes(".HK") || s.symbol.includes(".SS") || s.symbol.includes(".SZ");
    return true;
  });

  const candidates: {
    stock: WatchlistStock;
    kelly: number;
    conviction: { level: string; multiplier: number };
    hmm: { include: boolean; multiplier: number; reason: string };
    weight: number;
  }[] = [];

  for (const s of filtered) {
    const conviction = entropyConviction(s);
    const hmm = hmmSizing(s, conviction);
    if (!hmm.include) continue;

    const kelly = kellyFraction(s);
    if (kelly <= 0) continue;

    const weight = kelly * hmm.multiplier * conviction.multiplier * 100;
    if (weight < 1.5) continue;

    candidates.push({ stock: s, kelly, conviction, hmm, weight });
  }

  // Sort by weight descending
  candidates.sort((a, b) => b.weight - a.weight);

  // Sector cap: max 30%
  const maxPerSector = Math.max(Math.floor(maxHoldings * 0.3), 2);
  const sectorCount: Record<string, number> = {};
  const selected = candidates.filter((c) => {
    const sec = (c.stock.sector || "Other").trim();
    if ((sectorCount[sec] || 0) >= maxPerSector) return false;
    sectorCount[sec] = (sectorCount[sec] || 0) + 1;
    return true;
  }).slice(0, maxHoldings);

  // Normalize weights
  const totalWt = selected.reduce((s, c) => s + c.weight, 0);
  const scale = totalWt > 90 ? 90 / totalWt : 1;

  const holdings: EntropyPortfolioHolding[] = [];
  let totalInvested = 0;

  for (const { stock: s, kelly, conviction, hmm, weight } of selected) {
    const adjWt = Math.round(weight * scale * 2) / 2;
    const finalWt = Math.max(2, Math.min(12, adjWt));
    const amount = capital * finalWt / 100;
    const shares = Math.floor(amount / (s.price || 1));
    const actual = shares * (s.price || 1);
    totalInvested += actual;

    holdings.push({
      symbol: s.symbol,
      name: s.name,
      sector: (s.sector || "Other").trim(),
      price: Math.round((s.price || 0) * 100) / 100,
      weight_pct: finalWt,
      amount: Math.round(actual),
      shares,
      hmm_regime: s.hmm_regime || "N/A",
      hmm_persistence: s.hmm_persistence || 0,
      entropy_regime: s.entropy_regime || "normal",
      entropy_percentile: s.entropy_percentile || 50,
      cog_gap: s.cog_gap || 0,
      anchor_failure: s.anchor_failure || false,
      geometric_order: s.geometric_order ?? 0,
      trend_signal: s.trend_signal || "",
      conviction: conviction.level,
      kelly_fraction: Math.round(kelly * 10000) / 100,
      notes: `${hmm.reason} | ${conviction.level} conviction | Kelly ${(kelly*100).toFixed(1)}%`,
    });
  }

  const cash = capital - totalInvested;
  const sectors: Record<string, number> = {};
  for (const h of holdings) sectors[h.sector] = (sectors[h.sector] || 0) + h.weight_pct;

  // Regime summary
  const regimeCounts = { bull: 0, flat: 0, bear: 0 };
  const entropyCounts = { compressed: 0, normal: 0, diverse: 0 };
  for (const h of holdings) {
    const r = h.hmm_regime.toLowerCase();
    if (r.includes("bull")) regimeCounts.bull++;
    else if (r.includes("bear")) regimeCounts.bear++;
    else regimeCounts.flat++;
    const e = h.entropy_regime.toLowerCase();
    if (e.includes("compressed")) entropyCounts.compressed++;
    else if (e.includes("diverse")) entropyCounts.diverse++;
    else entropyCounts.normal++;
  }

  return NextResponse.json({
    holdings,
    summary: {
      count: holdings.length,
      capital,
      invested: Math.round(totalInvested),
      cash: Math.round(cash),
      cash_pct: Math.round(cash / capital * 1000) / 10,
      avg_kelly: holdings.length ? Math.round(holdings.reduce((s, h) => s + h.kelly_fraction, 0) / holdings.length * 100) / 100 : 0,
      regime_mix: regimeCounts,
      entropy_mix: entropyCounts,
      anchor_failures: holdings.filter(h => h.anchor_failure).length,
      sectors: Object.fromEntries(Object.entries(sectors).sort((a, b) => b[1] - a[1])),
    },
  });
}
