import type { WatchlistStock } from "./db";
import { computeCompositeScore } from "./composite-score";
import { isAnalyzed } from "./db";

export interface PortfolioHolding {
  symbol: string;
  name: string;
  sector: string;
  weight_pct: number;
  amount: number;
  shares: number;
  price: number;
  score: number;
  green_walls: number;
  momentum_type: string;
  structural_winner: boolean;
  wall_combo: string;
  macro_regime: string;
  te_direction: string;
  halflife_regime: string;
  leverage_quality: string;
  capex_risk: string;
  notes: string;
}

export interface PortfolioResult {
  holdings: PortfolioHolding[];
  excluded: { symbol: string; reason: string }[];
  summary: {
    count: number;
    capital: number;
    invested: number;
    cash: number;
    cash_pct: number;
    avg_score: number;
    structural_winners: number;
    best_quadrant: number;
    sectors: Record<string, number>;
    excluded_count: number;
  };
}

function passesHardGates(s: WatchlistStock): [boolean, string] {
  const gw = s.green_walls || 0;
  if (gw < 3) return [false, `Only ${gw} green walls (need 3+)`];

  const stage = s.corporate_stage || "";
  if (stage.includes("Stage 6") || stage.includes("Decline"))
    return [false, "Stage 6 Decline"];

  const wc = s.wall_combo || "";
  if (wc === "Worst Quadrant")
    return [false, "Worst Quadrant (expensive + slow growth)"];

  const crf = s.capex_risk_flag || "";
  if (crf.includes("EmpireBuilding") && crf.includes("PoorAccruals"))
    return [false, `Empire building + poor accruals`];

  if ((s.accrual_flag || "") === "Poor" && crf.includes("HighCapexBurn"))
    return [false, "Poor accruals + high CAPEX burn"];

  if (!s.price || s.price <= 0) return [false, "No price data"];

  return [true, "Passed"];
}

function convictionScore(s: WatchlistStock): number {
  const sc = computeCompositeScore(s);
  let base = sc.total;

  const teDir = s.te_causal_direction || "";
  if (teDir === "Stock leads") base += 2;

  const hlRegime = s.halflife_regime || "";
  if (hlRegime.includes("Fast")) base += 1;

  const lq = s.leverage_quality || "";
  if (lq === "High" || lq === "No Debt") base += 1;
  else if (lq === "Distressed") base -= 3;

  return Math.max(0, Math.min(100, base));
}

function positionWeight(s: WatchlistStock, score: number): number {
  if (score < 50) return 0;

  let base = score >= 80 ? 6.0 : score >= 70 ? 5.0 : score >= 60 ? 4.0 : 3.0;

  const mt = s.momentum_type || "";
  if (mt === "Structural") base *= 1.2;
  else if (mt === "Factor-only") base *= 0.7;

  const ts = (s.trend_signal || "").toLowerCase();
  const action = (s.action || "").toLowerCase();
  if (action.includes("right") && !ts.includes("open")) return 0;
  if (action.includes("left") && !ts.includes("open")) base *= 0.5;

  const er = (s.entropy_regime || "").toLowerCase();
  if (er.includes("compressed")) {
    const es = (s.emotion_signal || "").toLowerCase();
    base *= es === "high" ? 1.1 : 0.8;
  }

  const wc = s.wall_combo || "";
  if (wc === "Best Quadrant") base *= 1.15;

  const mr = s.macro_regime || "";
  if (mr === "Stagflation") base *= 0.7;
  else if (mr === "Goldilocks") base *= 1.1;

  const hmm = (s.hmm_regime || "").toLowerCase();
  const hmmP = s.hmm_persistence || 0;
  if (hmm.includes("bear") && hmmP > 0.9) base *= 0.5;
  else if (hmm.includes("bull") && hmmP > 0.95) base *= 1.1;

  const crf = s.capex_risk_flag || "";
  if (crf) {
    const riskCount = (crf.match(/\|/g) || []).length + 1;
    base *= Math.max(0.5, 1.0 - riskCount * 0.15);
  }

  base = Math.max(2.0, Math.min(8.0, base));
  return Math.round(base * 2) / 2;
}

export function buildPortfolio(
  stocks: WatchlistStock[],
  capital: number,
  maxHoldings: number = 25,
  sectorCapPct: number = 30,
): PortfolioResult {
  const excluded: { symbol: string; reason: string }[] = [];
  const candidates: { stock: WatchlistStock; score: number; weight: number }[] = [];

  for (const s of stocks) {
    if (!isAnalyzed(s)) {
      excluded.push({ symbol: s.symbol, reason: "Not analyzed" });
      continue;
    }
    const [passed, reason] = passesHardGates(s);
    if (!passed) {
      excluded.push({ symbol: s.symbol, reason });
      continue;
    }
    const score = convictionScore(s);
    const weight = positionWeight(s, score);
    if (weight < 2.0) {
      excluded.push({ symbol: s.symbol, reason: `Score ${score} → weight ${weight}% < 2%` });
      continue;
    }
    candidates.push({ stock: s, score, weight });
  }

  candidates.sort((a, b) => b.score - a.score || b.weight - a.weight || (a.stock.pe_ratio || 999) - (b.stock.pe_ratio || 999));

  const maxPerSector = Math.max(Math.floor(maxHoldings * sectorCapPct / 100), 2);
  const selected: typeof candidates = [];
  const sectorCount: Record<string, number> = {};

  for (const c of candidates) {
    if (selected.length >= maxHoldings) break;
    const sec = (c.stock.sector || "Other").trim();
    if ((sectorCount[sec] || 0) >= maxPerSector) {
      excluded.push({ symbol: c.stock.symbol, reason: `Sector cap (${sec})` });
      continue;
    }
    selected.push(c);
    sectorCount[sec] = (sectorCount[sec] || 0) + 1;
  }

  const totalWeight = selected.reduce((sum, c) => sum + c.weight, 0);
  const scale = totalWeight > 95 ? Math.min(95 / totalWeight, 1) : 1;

  const holdings: PortfolioHolding[] = [];
  let totalInvested = 0;

  for (const { stock: s, score, weight } of selected) {
    let adjWeight = Math.round(weight * scale * 2) / 2;
    adjWeight = Math.max(2.0, Math.min(8.0, adjWeight));
    const amount = capital * (adjWeight / 100);
    const price = s.price || 1;
    const shares = Math.floor(amount / price);
    const actualAmount = shares * price;
    totalInvested += actualAmount;

    const mt = s.momentum_type || "";
    const sw = s.structural_winner;

    holdings.push({
      symbol: s.symbol,
      name: s.name,
      sector: (s.sector || "Other").trim(),
      weight_pct: adjWeight,
      amount: Math.round(actualAmount * 100) / 100,
      shares,
      price: Math.round(price * 100) / 100,
      score,
      green_walls: s.green_walls || 0,
      momentum_type: mt,
      structural_winner: !!sw,
      wall_combo: s.wall_combo || "",
      macro_regime: s.macro_regime || "",
      te_direction: s.te_causal_direction || "",
      halflife_regime: s.halflife_regime || "",
      leverage_quality: s.leverage_quality || "",
      capex_risk: s.capex_risk_flag || "",
      notes: [
        `Score:${score}`,
        `${s.green_walls || 0}G/${s.yellow_walls || 0}Y/${s.red_walls || 0}R`,
        s.trend_signal || "",
        mt ? `${mt}${sw ? "★" : ""}` : "",
        s.wall_combo && s.wall_combo !== "Mixed" ? `[${s.wall_combo}]` : "",
      ].filter(Boolean).join(" | "),
    });
  }

  const cash = capital - totalInvested;
  const sectors: Record<string, number> = {};
  for (const h of holdings) sectors[h.sector] = (sectors[h.sector] || 0) + h.weight_pct;

  return {
    holdings,
    excluded: excluded.slice(0, 20),
    summary: {
      count: holdings.length,
      capital,
      invested: Math.round(totalInvested * 100) / 100,
      cash: Math.round(cash * 100) / 100,
      cash_pct: Math.round((cash / capital) * 1000) / 10,
      avg_score: holdings.length ? Math.round(holdings.reduce((s, h) => s + h.score, 0) / holdings.length * 10) / 10 : 0,
      structural_winners: holdings.filter((h) => h.structural_winner).length,
      best_quadrant: holdings.filter((h) => h.wall_combo === "Best Quadrant").length,
      sectors: Object.fromEntries(Object.entries(sectors).sort((a, b) => b[1] - a[1])),
      excluded_count: excluded.length,
    },
  };
}
