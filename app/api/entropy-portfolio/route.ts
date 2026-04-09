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
 * - Compressed entropy + high cog_gap = market under-processing → high conviction
 * - Diverse entropy = healthy market → normal conviction
 * - Compressed entropy + anchor failure = maximum signal
 */
function entropyConviction(s: WatchlistStock): { level: string; multiplier: number } {
  const regime = (s.entropy_regime || "normal").toLowerCase();
  const cog = s.cog_gap || 0;
  const anchor = s.anchor_failure || false;
  const pctile = s.entropy_percentile || 50;

  if (anchor && regime.includes("compressed")) {
    return { level: "MAXIMUM", multiplier: 1.5 };
  }
  if (regime.includes("compressed") && cog >= 5) {
    return { level: "HIGH", multiplier: 1.3 };
  }
  if (regime.includes("compressed")) {
    return { level: "ELEVATED", multiplier: 1.1 };
  }
  if (regime.includes("diverse") && pctile > 80) {
    return { level: "NORMAL", multiplier: 1.0 };
  }
  return { level: "STANDARD", multiplier: 1.0 };
}

/**
 * HMM regime filter: which stocks to include and how to size.
 * - Bull + high persistence: full position
 * - Flat + TrendWise Open: half position (use trend as tiebreaker)
 * - Bear + high persistence: SHORT or SKIP
 * - Low persistence: reduce size (uncertain regime)
 */
function hmmSizing(s: WatchlistStock): { include: boolean; multiplier: number; reason: string } {
  const regime = (s.hmm_regime || "").toLowerCase();
  const p = s.hmm_persistence || 0;
  const trend = (s.trend_signal || "").toLowerCase();
  const geo = s.geometric_order ?? 2;

  // Bear regime with high persistence: skip
  if (regime.includes("bear") && p > 0.85) {
    return { include: false, multiplier: 0, reason: "Bear regime, high persistence" };
  }

  // Bull regime
  if (regime.includes("bull")) {
    if (p > 0.95) return { include: true, multiplier: 1.2, reason: `Bull ${(p*100).toFixed(0)}% — full conviction` };
    if (p > 0.85) return { include: true, multiplier: 1.0, reason: `Bull ${(p*100).toFixed(0)}%` };
    return { include: true, multiplier: 0.8, reason: `Bull but low persistence ${(p*100).toFixed(0)}%` };
  }

  // Flat regime — use TrendWise as tiebreaker
  if (regime.includes("flat")) {
    if (trend.includes("open")) {
      return { include: true, multiplier: p > 0.9 ? 0.8 : 0.6, reason: `Flat + TrendWise Open` };
    }
    return { include: false, multiplier: 0, reason: "Flat regime, TrendWise closed" };
  }

  // Geometric order filter: skip Order 3 (jerk — fragile)
  if (geo >= 3) {
    return { include: false, multiplier: 0, reason: "Geometric Order 3 (fragile)" };
  }

  // Default: include with reduced size
  if (trend.includes("open")) {
    return { include: true, multiplier: 0.7, reason: "Unknown regime, TrendWise Open" };
  }
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
    const hmm = hmmSizing(s);
    if (!hmm.include) continue;

    const kelly = kellyFraction(s);
    if (kelly <= 0) continue;

    const conviction = entropyConviction(s);

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
