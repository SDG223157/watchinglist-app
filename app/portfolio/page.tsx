"use client";

import { useState } from "react";
import Link from "next/link";
import type { PortfolioResult, PortfolioHolding } from "@/lib/portfolio-builder";
import { buildMacroWSEPortfolio, buildSectorWSEPortfolio } from "@/lib/wse-optimizer";
import type { MacroWSEResult, MacroWSEHolding, SectorWSEResult, SectorWSEHolding, MacroAsset as WSEMacroAsset, MacroAllocation as WSEMacroAlloc, Sector as WSESector } from "@/lib/wse-optimizer";

const MARKETS = [
  { value: "ALL", label: "All Markets" },
  { value: "US", label: "US (S&P 500)" },
  { value: "China", label: "China (HK + CSI300)" },
  { value: "HK", label: "Hong Kong" },
  { value: "CN", label: "A-Shares (CSI300)" },
];

type Tab = "stocks" | "sectors" | "macro" | "entropy" | "wse" | "recipe";

type RecipeTier = "anchor" | "follower" | "tactical" | "trim";

interface RecipePosition {
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
  tier: RecipeTier;
  trailing60d: number;
  trailing1y: number;
  price: number;
  amount: number;
  shares: number;
}

interface RecipeRotation {
  added: string[];
  retired: { ticker: string; reason: string; prevWeight: number }[];
  resized: { ticker: string; prevWeight: number; newWeight: number; deltaPp: number }[];
}

interface RecipeResult {
  asOf: string;
  market: string;
  universeSize: number;
  topN: number;
  invested: number;
  cashReserve: number;
  leaderThreshold: number;
  capital: number;
  positions: RecipePosition[];
  sectorSummary: { sector: string; weight: number }[];
  tierSummary: { tier: RecipeTier | "cash"; count: number; weight: number }[];
  rotation: RecipeRotation | null;
  error?: string;
}

interface EntropyHolding {
  symbol: string; name: string; sector: string; price: number;
  weight_pct: number; amount: number; shares: number;
  hmm_regime: string; hmm_persistence: number;
  entropy_regime: string; entropy_percentile: number;
  cog_gap: number; anchor_failure: boolean;
  geometric_order: number; trend_signal: string;
  conviction: string; kelly_fraction: number; notes: string;
}

interface WSEHoldingRow {
  symbol: string; name: string; sector: string; price: number;
  weight_pct: number; amount: number; shares: number;
  conviction_u: number; score: number; green_walls: number;
  hmm_regime: string; hmm_persistence: number;
  entropy_regime: string; cog_gap: number; anchor_failure: boolean;
  trend_signal: string; momentum_type: string;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? "#16a34a" : score >= 65 ? "#22c55e" : score >= 50 ? "#b45309" : score >= 35 ? "#ea580c" : "#dc2626";
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold"
      style={{ background: `${color}20`, color }}
    >
      {score}
    </span>
  );
}

function MomentumBadge({ type, sw }: { type: string; sw: boolean }) {
  if (!type || type === "None") return <span className="text-zinc-500">—</span>;
  const color =
    type === "Structural" ? "#16a34a" : type === "Factor-only" ? "#b45309" : "#3b82f6";
  return (
    <span className="text-[11px] font-medium" style={{ color }}>
      {type}
      {sw && " ★"}
    </span>
  );
}

function WallComboBadge({ combo }: { combo: string }) {
  if (!combo || combo === "Mixed") return null;
  const color =
    combo === "Best Quadrant" ? "#16a34a" : combo === "Worst Quadrant" ? "#dc2626" : "#b45309";
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={{ background: `${color}15`, color }}
    >
      {combo}
    </span>
  );
}

interface MacroAsset {
  name: string;
  ticker: string;
  price: number;
  combined_score: number;
  net_signal: string;
  weight: string;
  hedge_score: number;
  arb_score: number;
  m2_floor: number;
  arb_fair_value: number;
}

interface MacroAllocation {
  equities: { range: string; score: number };
  hard_assets: { range: string; score: number };
  cash_usd: { range: string; score: number };
  crypto: { range: string; score: number };
}

interface MacroHolding {
  name: string;
  etf: string;
  category: string;
  weight_pct: number;
  amount: number;
  score: number;
  signal: string;
}

interface MacroPortfolio {
  holdings: MacroHolding[];
  allocation: MacroAllocation;
  assets: MacroAsset[];
  regime: string;
  capital: number;
  cash: number;
  cash_pct: number;
}

function buildMacroPortfolio(assets: MacroAsset[], alloc: MacroAllocation, capital: number): MacroPortfolio {
  const parseRange = (r: string): [number, number] => {
    const m = r.match(/(\d+)-(\d+)/);
    return m ? [parseInt(m[1]), parseInt(m[2])] : [0, 0];
  };

  const etfMap: Record<string, { etf: string; category: string }[]> = {
    equities: [
      { etf: "SPY", category: "US Large Cap" },
      { etf: "QQQ", category: "US Tech/Growth" },
      { etf: "VWO", category: "Emerging Markets" },
    ],
    hard_assets: [
      { etf: "GLD", category: "Gold" },
      { etf: "SLV", category: "Silver" },
      { etf: "USO", category: "Oil" },
    ],
    cash_usd: [
      { etf: "SHV", category: "Short-Term Treasury" },
      { etf: "UUP", category: "US Dollar Bull" },
      { etf: "TLT", category: "Long-Term Treasury" },
    ],
    crypto: [
      { etf: "IBIT", category: "Bitcoin ETF" },
    ],
  };

  const scoreForAsset = (name: string): number => {
    const a = assets.find((x) => x.name.toLowerCase().includes(name.toLowerCase()));
    return a?.combined_score ?? 50;
  };
  const signalForAsset = (name: string): string => {
    const a = assets.find((x) => x.name.toLowerCase().includes(name.toLowerCase()));
    return a?.net_signal ?? "HOLD";
  };

  const holdings: MacroHolding[] = [];

  const categories: { key: keyof MacroAllocation; label: string }[] = [
    { key: "equities", label: "Equities" },
    { key: "hard_assets", label: "Hard Assets" },
    { key: "cash_usd", label: "Cash / USD" },
    { key: "crypto", label: "Crypto" },
  ];

  for (const cat of categories) {
    const [lo, hi] = parseRange(alloc[cat.key].range);
    const midPct = (lo + hi) / 2;
    const score = alloc[cat.key].score;
    const adjPct = score < 30 ? hi : score > 70 ? lo : midPct;
    const etfs = etfMap[cat.key] || [];
    const perEtf = etfs.length > 0 ? adjPct / etfs.length : 0;

    for (const e of etfs) {
      const assetName = e.category.includes("Gold") ? "gold" : e.category.includes("Silver") ? "silver"
        : e.category.includes("Oil") ? "oil" : e.category.includes("Bitcoin") ? "bitcoin"
        : e.category.includes("Dollar") ? "dollar" : "s&p";
      const sc = scoreForAsset(assetName);
      const sig = signalForAsset(assetName);

      let wt = perEtf;
      if (sig.includes("TRIM") || sig.includes("SELL")) wt = Math.max(0, perEtf * 0.5);
      else if (sig.includes("STRONG BUY")) wt = Math.min(perEtf * 1.3, hi);

      if (wt < 1) continue;
      wt = Math.round(wt * 2) / 2;

      holdings.push({
        name: e.category,
        etf: e.etf,
        category: cat.label,
        weight_pct: wt,
        amount: Math.round(capital * wt / 100),
        score: sc,
        signal: sig,
      });
    }
  }

  const totalInvested = holdings.reduce((s, h) => s + h.amount, 0);
  const cash = capital - totalInvested;

  return {
    holdings,
    allocation: alloc,
    assets,
    regime: "",
    capital,
    cash,
    cash_pct: Math.round((cash / capital) * 1000) / 10,
  };
}

interface Sector {
  key: string;
  name: string;
  etf: string;
  beta_type: string;
  peak_phase: string;
  ret_3m: number;
  ret_12m: number;
  alpha_3m: number;
  hedge_demand: number;
  arb_score: number;
  pe: number | null;
  div_yield: number | null;
}

interface SectorHolding {
  name: string;
  etf: string;
  type: string;
  weight_pct: number;
  amount: number;
  alpha_3m: number;
  arb_score: number;
  hedge_demand: number;
  quadrant: string;
  peak_phase: string;
}

interface SectorPortfolio {
  holdings: SectorHolding[];
  regime: string;
  spread: number;
  capital: number;
  cash: number;
  cash_pct: number;
}

function buildSectorPortfolio(sectors: Sector[], regime: string, spread: number, capital: number): SectorPortfolio {
  const etfMap: Record<string, string> = {
    "consumer_staples": "XLP", "utilities": "XLU", "healthcare": "XLV",
    "real_estate": "XLRE", "technology": "XLK", "consumer_discretionary": "XLY",
    "financials": "XLF", "industrials": "XLI", "energy": "XLE",
    "materials": "XLB", "communication_services": "XLC",
  };

  const holdings: SectorHolding[] = [];

  for (const s of sectors) {
    const etf = etfMap[s.key] || s.etf || s.key.toUpperCase();
    const isDefensive = s.beta_type === "defensive";
    const isCheap = s.arb_score < 30;
    const isRich = s.arb_score > 70;
    const highHedge = s.hedge_demand > 60;

    let quadrant: string;
    if (highHedge && isCheap) quadrant = "Cheap Hedge";
    else if (highHedge && isRich) quadrant = "Expensive Hedge";
    else if (!highHedge && isCheap) quadrant = "Cheap Growth";
    else if (!highHedge && isRich) quadrant = "Expensive Growth";
    else quadrant = "Neutral";

    // Base weight: equal ~9% each (100/11)
    let wt = 9.0;

    // Regime tilt
    if (regime === "RISK-OFF" || regime === "LATE-CYCLE") {
      wt = isDefensive ? 12.0 : 6.0;
    } else if (regime === "EXPANSION" || regime === "BOOM") {
      wt = isDefensive ? 6.0 : 12.0;
    }

    // Arb adjustment
    if (isCheap) wt *= 1.2;
    if (isRich) wt *= 0.7;

    // Alpha momentum
    if (s.alpha_3m > 5) wt *= 1.15;
    if (s.alpha_3m < -5) wt *= 0.85;

    // Quadrant bonus
    if (quadrant === "Cheap Growth" || quadrant === "Cheap Hedge") wt *= 1.1;
    if (quadrant === "Expensive Growth") wt *= 0.7;

    wt = Math.max(2.0, Math.min(15.0, wt));
    wt = Math.round(wt * 2) / 2;

    holdings.push({
      name: s.name,
      etf,
      type: s.beta_type || (isDefensive ? "defensive" : "cyclical"),
      weight_pct: wt,
      amount: 0,
      alpha_3m: s.alpha_3m,
      arb_score: s.arb_score,
      hedge_demand: s.hedge_demand,
      quadrant,
      peak_phase: s.peak_phase,
    });
  }

  // Normalize to 95%
  const totalWt = holdings.reduce((s, h) => s + h.weight_pct, 0);
  const scale = totalWt > 95 ? 95 / totalWt : 1;
  for (const h of holdings) {
    h.weight_pct = Math.round(h.weight_pct * scale * 2) / 2;
    h.amount = Math.round(capital * h.weight_pct / 100);
  }

  // Sort by weight desc
  holdings.sort((a, b) => b.weight_pct - a.weight_pct);

  const totalInvested = holdings.reduce((s, h) => s + h.amount, 0);

  return {
    holdings,
    regime,
    spread,
    capital,
    cash: capital - totalInvested,
    cash_pct: Math.round(((capital - totalInvested) / capital) * 1000) / 10,
  };
}

export default function PortfolioPage() {
  const [tab, setTab] = useState<Tab>("stocks");
  const [capital, setCapital] = useState(1_000_000);
  const [market, setMarket] = useState("ALL");
  const [maxHoldings, setMaxHoldings] = useState(25);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PortfolioResult | null>(null);
  const [macroResult, setMacroResult] = useState<MacroPortfolio | null>(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const [sectorResult, setSectorResult] = useState<SectorPortfolio | null>(null);
  const [sectorLoading, setSectorLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [entropyResult, setEntropyResult] = useState<any>(null);
  const [entropyLoading, setEntropyLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [wseResult, setWseResult] = useState<any>(null);
  const [wseLoading, setWseLoading] = useState(false);
  const [macroWSE, setMacroWSE] = useState<MacroWSEResult | null>(null);
  const [sectorWSE, setSectorWSE] = useState<SectorWSEResult | null>(null);
  const [useWSEMacro, setUseWSEMacro] = useState(false);
  const [useWSESector, setUseWSESector] = useState(false);
  const [recipeResult, setRecipeResult] = useState<RecipeResult | null>(null);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [recipeTopN, setRecipeTopN] = useState(30);
  const [error, setError] = useState("");

  async function buildRecipe() {
    setRecipeLoading(true);
    setError("");
    try {
      const body: {
        market: string;
        topN: number;
        capital: number;
        previousHoldings?: { ticker: string; weight: number }[];
      } = {
        market: market === "China" ? "CHINA" : market,
        topN: recipeTopN,
        capital,
      };
      if (recipeResult?.positions?.length) {
        body.previousHoldings = recipeResult.positions.map((p) => ({
          ticker: p.ticker,
          weight: p.weight,
        }));
      }
      const res = await fetch("/api/recipe-portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as RecipeResult;
      if (!res.ok) {
        setError(json.error || "Recipe build failed");
        return;
      }
      setRecipeResult(json);
    } catch (e) {
      setError(String(e));
    } finally {
      setRecipeLoading(false);
    }
  }

  async function build() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capital, market, maxHoldings }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || `Failed (${res.status})`);
        return;
      }
      setResult(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function buildMacro() {
    setMacroLoading(true);
    setError("");
    try {
      const res = await fetch("/api/macro-playbook");
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || `Failed (${res.status})`);
        return;
      }
      const data = await res.json();
      setMacroResult(buildMacroPortfolio(data.assets || [], data.allocation || {}, capital));
      // Also compute WSE macro allocation
      try {
        const wse = buildMacroWSEPortfolio(
          data.assets as WSEMacroAsset[],
          data.allocation as WSEMacroAlloc,
          data.regime || "TRANSITION",
          capital,
        );
        setMacroWSE(wse);
      } catch { /* WSE is optional enhancement */ }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setMacroLoading(false);
    }
  }

  async function buildSectors() {
    setSectorLoading(true);
    setError("");
    try {
      const res = await fetch("/api/macro-playbook", { signal: AbortSignal.timeout(120000) });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || d.detail || `Macro API failed (${res.status})`);
        return;
      }
      const data = await res.json();
      const sectors = data.sectors || [];
      if (sectors.length === 0) {
        setError(`Macro API returned 0 sectors (regime: ${data.regime || "unknown"}). The API may need more time to fetch price history. Try again.`);
        return;
      }
      setSectorResult(buildSectorPortfolio(sectors, data.regime || "TRANSITION", data.spread || 0, capital));
      // Also compute WSE sector allocation
      try {
        const wse = buildSectorWSEPortfolio(
          sectors as WSESector[],
          data.regime || "TRANSITION",
          data.spread || 0,
          capital,
        );
        setSectorWSE(wse);
      } catch { /* WSE is optional */ }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      setError(msg.includes("timeout") ? "Macro API timed out (2min). Try again — data may be cached on second attempt." : msg);
    } finally {
      setSectorLoading(false);
    }
  }

  async function buildEntropy() {
    setEntropyLoading(true);
    setError("");
    try {
      const res = await fetch("/api/entropy-portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capital, market, maxHoldings }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || `Failed (${res.status})`); return; }
      setEntropyResult(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setEntropyLoading(false);
    }
  }

  async function buildWSE() {
    setWseLoading(true);
    setError("");
    try {
      const res = await fetch("/api/wse-portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capital, market, maxHoldings }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || `Failed (${res.status})`); return; }
      setWseResult(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setWseLoading(false);
    }
  }

  const s = result?.summary;
  const mp = macroResult;
  const sp = sectorResult;
  const ep = entropyResult;
  const wp = wseResult;

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-sm">
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-bold tracking-tight mt-1">Portfolio Builder</h1>
          <p className="text-xs text-zinc-500 mt-1">
            FAJ-enhanced position sizing · Hedge + Arbitrage macro allocation · 5 Gravity Walls
          </p>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 mb-6">
        {([["stocks", "Stock Portfolio"], ["sectors", "Sector Rotation (S&P 500)"], ["entropy", "HMM × Entropy"], ["wse", "WSE Optimizer"], ["recipe", "Recipe Portfolio"], ["macro", "Macro Allocation"]] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors"
            style={{
              background: tab === t ? "var(--card)" : "transparent",
              borderBottom: tab === t ? "2px solid #2563eb" : "2px solid transparent",
              color: tab === t ? "#fff" : "var(--muted)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ===== STOCK TAB ===== */}
      {tab === "stocks" && <>
      <div
        className="rounded-lg p-4 mb-6 flex flex-wrap items-end gap-4"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Capital ($)</label>
          <input
            type="number"
            value={capital}
            onChange={(e) => setCapital(Number(e.target.value))}
            className="w-40 px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white"
          />
        </div>
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Market</label>
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            className="px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white"
          >
            {MARKETS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Max Holdings</label>
          <input
            type="number"
            value={maxHoldings}
            onChange={(e) => setMaxHoldings(Number(e.target.value))}
            className="w-20 px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white"
          />
        </div>
        <button
          onClick={build}
          disabled={loading}
          className="px-5 py-2 rounded-md text-sm font-semibold transition-colors cursor-pointer hover:brightness-125 disabled:opacity-50"
          style={{ background: "#2563eb", color: "#fff" }}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Building...
            </span>
          ) : (
            "Build Portfolio"
          )}
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>

      {/* Summary Cards */}
      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
          {[
            { label: "Holdings", value: s.count },
            { label: "Invested", value: `$${fmt(s.invested)}` },
            { label: "Cash", value: `$${fmt(s.cash)} (${s.cash_pct}%)` },
            { label: "Avg Score", value: s.avg_score },
            { label: "Structural ★", value: s.structural_winners },
            { label: "Best Quadrant", value: s.best_quadrant },
            { label: "Excluded", value: s.excluded_count },
            { label: "Capital", value: `$${fmt(s.capital)}` },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-lg p-3"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            >
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{card.label}</div>
              <div className="text-lg font-bold mt-0.5">{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Sector Breakdown */}
      {s && Object.keys(s.sectors).length > 0 && (
        <div
          className="rounded-lg p-4 mb-6"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Sector Allocation</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(s.sectors).map(([sec, wt]) => (
              <div key={sec} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: "#2563eb" }} />
                <span className="text-xs">
                  {sec}: <strong>{wt.toFixed(1)}%</strong>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Holdings Table */}
      {result && result.holdings.length > 0 && (
        <div
          className="rounded-lg overflow-hidden"
          style={{ border: "1px solid var(--border)" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--card)" }}>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Symbol</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Weight</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Amount</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Shares</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Price</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Score</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Walls</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Momentum</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Wall Combo</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Sector</th>
              </tr>
            </thead>
            <tbody>
              {result.holdings.map((h: PortfolioHolding, i: number) => (
                <tr
                  key={h.symbol}
                  className="border-t transition-colors hover:brightness-125"
                  style={{ borderColor: "var(--border)", background: i % 2 === 0 ? "transparent" : "var(--card)" }}
                >
                  <td className="px-3 py-2 font-mono font-bold">
                    <Link href={`/stock/${h.symbol}`} className="hover:text-blue-400">
                      {h.symbol}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-400 max-w-[180px] truncate">{h.name}</td>
                  <td className="px-3 py-2 text-right font-semibold">{h.weight_pct.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right text-zinc-400">${fmt(h.amount)}</td>
                  <td className="px-3 py-2 text-right text-zinc-400">{fmt(h.shares)}</td>
                  <td className="px-3 py-2 text-right">${h.price.toFixed(2)}</td>
                  <td className="px-3 py-2 text-center"><ScoreBadge score={h.score} /></td>
                  <td className="px-3 py-2 text-xs">{h.green_walls}G</td>
                  <td className="px-3 py-2"><MomentumBadge type={h.momentum_type} sw={h.structural_winner} /></td>
                  <td className="px-3 py-2"><WallComboBadge combo={h.wall_combo} /></td>
                  <td className="px-3 py-2 text-xs text-zinc-500">{h.sector}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && result.holdings.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          No stocks passed the hard gates. Try relaxing criteria or adding more analyzed stocks.
        </div>
      )}
      </>}

      {/* ===== SECTOR TAB ===== */}
      {tab === "sectors" && <>
      <div
        className="rounded-lg p-4 mb-6 flex flex-wrap items-end gap-4"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Capital ($)</label>
          <input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))}
            className="w-40 px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white" />
        </div>
        <button onClick={buildSectors} disabled={sectorLoading}
          className="px-5 py-2 rounded-md text-sm font-semibold transition-colors cursor-pointer hover:brightness-125 disabled:opacity-50"
          style={{ background: "#2563eb", color: "#fff" }}>
          {sectorLoading ? <span className="flex items-center gap-2"><span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Loading...</span> : "Build Sector Portfolio"}
        </button>
        {sp && sectorWSE && (
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={useWSESector} onChange={(e) => setUseWSESector(e.target.checked)} className="accent-emerald-500" />
            <span style={{ color: useWSESector ? "#34d399" : "var(--muted)" }}>WSE Optimizer</span>
          </label>
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>

      {/* WSE Sector entropy bar */}
      {useWSESector && sectorWSE && (
        <div className="rounded-lg p-3 mb-4 flex flex-wrap gap-6 text-xs" style={{ background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.15)" }}>
          <div><span className="text-zinc-500">H_u(p):</span> <span className="font-bold" style={{ color: "#34d399" }}>{sectorWSE.summary.portfolio_entropy.toFixed(4)}</span></div>
          <div><span className="text-zinc-500">Equal-wt:</span> <span className="font-bold">{sectorWSE.summary.equal_weight_entropy.toFixed(4)}</span></div>
          <div><span className="text-zinc-500">Ratio:</span> <span className="font-bold" style={{ color: sectorWSE.summary.entropy_ratio > 0.95 ? "#16a34a" : "#b45309" }}>{sectorWSE.summary.entropy_ratio.toFixed(4)}</span></div>
          <div><span className="text-zinc-500">Defensive:</span> <span className="font-bold">{sectorWSE.summary.defensive_pct.toFixed(1)}%</span></div>
          <div><span className="text-zinc-500">Cyclical:</span> <span className="font-bold">{sectorWSE.summary.cyclical_pct.toFixed(1)}%</span></div>
        </div>
      )}

      {sp && <>
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          {[
            { label: "Regime", value: sp.regime },
            { label: "Spread", value: `${sp.spread > 0 ? "+" : ""}${sp.spread}pp` },
            { label: "Sectors", value: sp.holdings.length },
            { label: "Invested", value: `$${fmt(sp.capital - sp.cash)}` },
            { label: "Cash", value: `$${fmt(sp.cash)} (${sp.cash_pct}%)` },
          ].map((c) => (
            <div key={c.label} className="rounded-lg p-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{c.label}</div>
              <div className="text-lg font-bold mt-0.5">{c.value}</div>
            </div>
          ))}
        </div>

        {/* Sector Table */}
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--card)" }}>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase">ETF</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase">Sector</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Type</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">Weight</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">Amount</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">3M Alpha</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Arb</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Quadrant</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase">Peak Phase</th>
              </tr>
            </thead>
            <tbody>
              {(useWSESector && sectorWSE ? sectorWSE.holdings : sp.holdings).map((h, i) => {
                const bt = "beta_type" in h ? h.beta_type : ("type" in h ? h.type : "");
                const typeCol = bt === "defensive" ? "#3b82f6" : "#f59e0b";
                const alphaCol = h.alpha_3m > 3 ? "#16a34a" : h.alpha_3m < -3 ? "#dc2626" : "var(--muted)";
                const arbCol = h.arb_score < 30 ? "#16a34a" : h.arb_score > 70 ? "#dc2626" : "#b45309";
                const qCol = h.quadrant.includes("Cheap") ? "#16a34a" : h.quadrant.includes("Expensive") ? "#dc2626" : "var(--muted)";
                const uVal = "conviction_u" in h ? (h as SectorWSEHolding).conviction_u : null;
                return (
                  <tr key={`${h.etf}-${i}`} style={{ borderTop: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "var(--card)" }}>
                    <td className="px-3 py-2.5 font-mono font-bold">{h.etf}</td>
                    <td className="px-3 py-2.5 text-xs">{h.name}</td>
                    <td className="px-3 py-2.5 text-center"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: typeCol, background: `${typeCol}15` }}>{bt}</span></td>
                    <td className="px-3 py-2.5 text-right font-semibold">{h.weight_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-right text-zinc-400">${fmt(h.amount)}</td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: alphaCol }}>{h.alpha_3m > 0 ? "+" : ""}{h.alpha_3m.toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-center"><span className="font-mono font-bold text-xs" style={{ color: arbCol }}>{h.arb_score}</span></td>
                    <td className="px-3 py-2.5 text-center"><span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ color: qCol, background: `${qCol}10` }}>{h.quadrant}</span></td>
                    <td className="px-3 py-2.5 text-xs text-zinc-500">{h.peak_phase}{uVal != null ? ` (u=${uVal.toFixed(2)})` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>}
      </>}

      {/* ===== ENTROPY TAB ===== */}
      {tab === "entropy" && <>
      <div className="rounded-lg p-4 mb-6 flex flex-wrap items-end gap-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Capital ($)</label>
          <input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} className="w-40 px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white" />
        </div>
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Market</label>
          <select value={market} onChange={(e) => setMarket(e.target.value)} className="px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white">
            {MARKETS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <button onClick={buildEntropy} disabled={entropyLoading}
          className="px-5 py-2 rounded-md text-sm font-semibold cursor-pointer hover:brightness-125 disabled:opacity-50"
          style={{ background: "#7c3aed", color: "#fff" }}>
          {entropyLoading ? <span className="flex items-center gap-2"><span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Building...</span> : "Build HMM × Entropy Portfolio"}
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>

      {/* Methodology */}
      <div className="rounded-lg p-4 mb-6 text-xs" style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.15)" }}>
        <h3 className="font-bold text-sm mb-2" style={{ color: "#a78bfa" }}>HMM × Entropy Portfolio Theory</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-zinc-400">
          <div><strong className="text-zinc-200">HMM Regime Filter:</strong> Only hold stocks in Bull regime (high persistence) or Flat regime with TrendWise confirmation. Skip Bear + high persistence. Skip Geometric Order 3 (fragile).</div>
          <div><strong className="text-zinc-200">Shannon Entropy Sizing:</strong> Compressed + far from ATH = hidden gem (increase conviction). Compressed + at ATH + high PE = CROWDED trade (decrease to 0.7x). Anchor failure = maximum signal.</div>
          <div><strong className="text-zinc-200">Kelly Fraction:</strong> Position size = edge / variance. Edge from composite score, variance from regime uncertainty. Quarter-Kelly cap prevents overbetting on imprecise estimates.</div>
          <div><strong className="text-zinc-200">Tiered Entry (v2):</strong> HIGH conviction + TW Closed → 1/3 early entry. MAXIMUM + TW Closed → 1/2 early entry. Backtest showed TrendWise lags ~40d, missing +32.9% avg returns at HIGH conviction.</div>
        </div>
      </div>

      {ep && <>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
          {[
            { label: "Holdings", value: ep.summary.count },
            { label: "Invested", value: `$${fmt(ep.summary.invested)}` },
            { label: "Cash", value: `$${fmt(ep.summary.cash)} (${ep.summary.cash_pct}%)` },
            { label: "Avg Kelly", value: `${ep.summary.avg_kelly}%` },
            { label: "Bull", value: ep.summary.regime_mix.bull, color: "#16a34a" },
            { label: "Flat", value: ep.summary.regime_mix.flat, color: "#b45309" },
            { label: "Compressed", value: ep.summary.entropy_mix.compressed, color: "#7c3aed" },
            { label: "Anchor Fail", value: ep.summary.anchor_failures, color: "#dc2626" },
          ].map((c) => (
            <div key={c.label} className="rounded-lg p-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{c.label}</div>
              <div className="text-lg font-bold mt-0.5" style={{ color: "color" in c ? c.color : undefined }}>{c.value}</div>
            </div>
          ))}
        </div>

        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--card)" }}>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase">Symbol</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase">Name</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">Weight</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">Amount</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">HMM</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Persist</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Entropy</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Cog Gap</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Conviction</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">Kelly</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Geo</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Trend</th>
              </tr>
            </thead>
            <tbody>
              {ep.holdings.map((h: EntropyHolding, i: number) => {
                const hmmCol = h.hmm_regime.toLowerCase().includes("bull") ? "#16a34a" : h.hmm_regime.toLowerCase().includes("bear") ? "#dc2626" : "#b45309";
                const entCol = h.entropy_regime.includes("compressed") ? "#7c3aed" : h.entropy_regime.includes("diverse") ? "#3b82f6" : "var(--muted)";
                const convCol = h.conviction === "CROWDED" ? "#ef4444" : h.conviction === "MAXIMUM" ? "#dc2626" : h.conviction === "HIGH" ? "#f59e0b" : h.conviction === "ELEVATED" ? "#7c3aed" : "var(--muted)";
                const geoCol = h.geometric_order === 0 ? "#16a34a" : h.geometric_order === 1 ? "#22c55e" : h.geometric_order === 2 ? "#b45309" : "#dc2626";
                return (
                  <tr key={h.symbol} style={{ borderTop: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "var(--card)" }}>
                    <td className="px-3 py-2.5 font-mono font-bold"><Link href={`/stock/${h.symbol}`} className="hover:text-purple-400">{h.symbol}</Link></td>
                    <td className="px-3 py-2.5 text-xs text-zinc-400 max-w-[150px] truncate">{h.name}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{h.weight_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-right text-zinc-400">${fmt(h.amount)}</td>
                    <td className="px-3 py-2.5 text-center"><span className="text-xs font-bold" style={{ color: hmmCol }}>{h.hmm_regime}</span></td>
                    <td className="px-3 py-2.5 text-center font-mono text-xs">{(h.hmm_persistence * 100).toFixed(0)}%</td>
                    <td className="px-3 py-2.5 text-center"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: entCol, background: `${entCol}15` }}>{h.entropy_regime}</span></td>
                    <td className="px-3 py-2.5 text-center font-mono text-xs">{h.cog_gap}/10{h.anchor_failure ? " ⚠" : ""}</td>
                    <td className="px-3 py-2.5 text-center"><span className="text-[10px] font-bold" style={{ color: convCol }}>{h.conviction}</span></td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{h.kelly_fraction.toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-center"><span className="font-mono text-xs font-bold" style={{ color: geoCol }}>{h.geometric_order}</span></td>
                    <td className="px-3 py-2.5 text-center text-xs">{h.trend_signal === "Open" ? "🟢" : "⬜"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>}
      </>}

      {/* ===== WSE TAB ===== */}
      {tab === "wse" && <>
      <div className="rounded-lg p-4 mb-6 flex flex-wrap items-end gap-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Capital ($)</label>
          <input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} className="w-40 px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white" />
        </div>
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Market</label>
          <select value={market} onChange={(e) => setMarket(e.target.value)} className="px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white">
            {MARKETS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <button onClick={buildWSE} disabled={wseLoading}
          className="px-5 py-2 rounded-md text-sm font-semibold cursor-pointer hover:brightness-125 disabled:opacity-50"
          style={{ background: "#059669", color: "#fff" }}>
          {wseLoading ? <span className="flex items-center gap-2"><span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Optimizing...</span> : "Build WSE Portfolio"}
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>

      {/* Methodology */}
      <div className="rounded-lg p-4 mb-6 text-xs" style={{ background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.15)" }}>
        <h3 className="font-bold text-sm mb-2" style={{ color: "#34d399" }}>Weighted Shannon Entropy (WSE) — Șerban & Dedu 2025</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-zinc-400">
          <div><strong className="text-zinc-200">Objective:</strong> Maximize H_u(p) = −Σ u_i p_i ln(p_i) — the weighted Shannon entropy of portfolio weights. Anti-concentration by construction: every asset gets some weight.</div>
          <div><strong className="text-zinc-200">Informational Weights u_i:</strong> HMM regime + persistence, entropy regime, cognitive gap, anchor failure, composite score, momentum type, TrendWise signal → single conviction multiplier per stock.</div>
          <div><strong className="text-zinc-200">Constraints:</strong> Full investment (Σp=1), position bounds [2%, 8%], sector cap 30%. Softmax-like solutions naturally discourage concentration.</div>
          <div><strong className="text-zinc-200">Entropy Ratio:</strong> Portfolio entropy / equal-weight entropy. 1.0 = maximum diversification. Lower = stronger conviction tilt. Typically 0.90–1.01.</div>
        </div>
      </div>

      {wp && <>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
          {[
            { label: "Holdings", value: wp.summary.count },
            { label: "Invested", value: `$${fmt(wp.summary.invested)}` },
            { label: "Cash", value: `$${fmt(wp.summary.cash)} (${wp.summary.cash_pct}%)` },
            { label: "Avg Score", value: wp.summary.avg_score },
            { label: "Avg u_i", value: wp.summary.avg_conviction_u?.toFixed(3), color: "#059669" },
            { label: "H_u(p)", value: wp.summary.portfolio_entropy?.toFixed(4), color: "#059669" },
            { label: "H_u(eq)", value: wp.summary.equal_weight_entropy?.toFixed(4) },
            { label: "Ratio", value: wp.summary.entropy_ratio?.toFixed(4), color: wp.summary.entropy_ratio > 0.95 ? "#16a34a" : wp.summary.entropy_ratio > 0.85 ? "#b45309" : "#dc2626" },
          ].map((c) => (
            <div key={c.label} className="rounded-lg p-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{c.label}</div>
              <div className="text-lg font-bold mt-0.5" style={{ color: "color" in c ? c.color : undefined }}>{c.value}</div>
            </div>
          ))}
        </div>

        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--card)" }}>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase">Symbol</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase">Name</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">Weight</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">Amount</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">u_i</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Score</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">HMM</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Persist</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Entropy</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Cog</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Trend</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase">Sector</th>
              </tr>
            </thead>
            <tbody>
              {wp.holdings.map((h: WSEHoldingRow, i: number) => {
                const hmmCol = h.hmm_regime?.toLowerCase().includes("bull") ? "#16a34a" : h.hmm_regime?.toLowerCase().includes("bear") ? "#dc2626" : "#b45309";
                const entCol = h.entropy_regime?.includes("compressed") ? "#7c3aed" : h.entropy_regime?.includes("diverse") ? "#3b82f6" : "var(--muted)";
                const uCol = h.conviction_u >= 1.5 ? "#16a34a" : h.conviction_u >= 1.0 ? "#059669" : h.conviction_u >= 0.7 ? "#b45309" : "#dc2626";
                return (
                  <tr key={h.symbol} style={{ borderTop: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "var(--card)" }}>
                    <td className="px-3 py-2.5 font-mono font-bold"><Link href={`/stock/${h.symbol}`} className="hover:text-emerald-400">{h.symbol}</Link></td>
                    <td className="px-3 py-2.5 text-xs text-zinc-400 max-w-[140px] truncate">{h.name}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{h.weight_pct?.toFixed(2)}%</td>
                    <td className="px-3 py-2.5 text-right text-zinc-400">${fmt(h.amount)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs font-bold" style={{ color: uCol }}>{h.conviction_u?.toFixed(2)}x</td>
                    <td className="px-3 py-2.5 text-center"><ScoreBadge score={h.score} /></td>
                    <td className="px-3 py-2.5 text-center"><span className="text-xs font-bold" style={{ color: hmmCol }}>{h.hmm_regime}</span></td>
                    <td className="px-3 py-2.5 text-center font-mono text-xs">{((h.hmm_persistence || 0) * 100).toFixed(0)}%</td>
                    <td className="px-3 py-2.5 text-center"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: entCol, background: `${entCol}15` }}>{h.entropy_regime}</span></td>
                    <td className="px-3 py-2.5 text-center font-mono text-xs">{h.cog_gap}/10{h.anchor_failure ? " ⚠" : ""}</td>
                    <td className="px-3 py-2.5 text-center text-xs">{h.trend_signal === "Open" ? "🟢" : "⬜"}</td>
                    <td className="px-3 py-2.5 text-xs text-zinc-500 max-w-[100px] truncate">{h.sector}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Sector breakdown */}
        {wp.summary.sectors && Object.keys(wp.summary.sectors).length > 0 && (
        <div className="mt-4 rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <h3 className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Sector Allocation</h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(wp.summary.sectors as Record<string, number>).map(([sec, pct]) => (
              <div key={sec} className="text-xs">
                <span className="text-zinc-400">{sec}:</span>{" "}
                <span className="font-bold" style={{ color: pct > 25 ? "#b45309" : "#059669" }}>{pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
        )}
      </>}
      </>}

      {/* ===== MACRO TAB ===== */}
      {tab === "macro" && <>
      <div
        className="rounded-lg p-4 mb-6 flex flex-wrap items-end gap-4"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Capital ($)</label>
          <input
            type="number"
            value={capital}
            onChange={(e) => setCapital(Number(e.target.value))}
            className="w-40 px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white"
          />
        </div>
        <button
          onClick={buildMacro}
          disabled={macroLoading}
          className="px-5 py-2 rounded-md text-sm font-semibold transition-colors cursor-pointer hover:brightness-125 disabled:opacity-50"
          style={{ background: "#2563eb", color: "#fff" }}
        >
          {macroLoading ? (
            <span className="flex items-center gap-2">
              <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Loading Macro...
            </span>
          ) : (
            "Build Macro Portfolio"
          )}
        </button>
        {mp && macroWSE && (
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={useWSEMacro} onChange={(e) => setUseWSEMacro(e.target.checked)} className="accent-emerald-500" />
            <span style={{ color: useWSEMacro ? "#34d399" : "var(--muted)" }}>WSE Optimizer</span>
          </label>
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>

      {/* WSE Macro entropy bar */}
      {useWSEMacro && macroWSE && (
        <div className="rounded-lg p-3 mb-4 flex flex-wrap gap-6 text-xs" style={{ background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.15)" }}>
          <div><span className="text-zinc-500">H_u(p):</span> <span className="font-bold" style={{ color: "#34d399" }}>{macroWSE.summary.portfolio_entropy.toFixed(4)}</span></div>
          <div><span className="text-zinc-500">Equal-wt:</span> <span className="font-bold">{macroWSE.summary.equal_weight_entropy.toFixed(4)}</span></div>
          <div><span className="text-zinc-500">Ratio:</span> <span className="font-bold" style={{ color: macroWSE.summary.entropy_ratio > 0.95 ? "#16a34a" : "#b45309" }}>{macroWSE.summary.entropy_ratio.toFixed(4)}</span></div>
          <div><span className="text-zinc-500">Regime:</span> <span className="font-bold">{macroWSE.summary.regime}</span></div>
          {Object.entries(macroWSE.summary.categories).map(([cat, pct]) => (
            <div key={cat}><span className="text-zinc-500">{cat.replace(/_/g, " ")}:</span> <span className="font-bold">{pct.toFixed(1)}%</span></div>
          ))}
        </div>
      )}

      {mp && (
        <>
        {/* Macro Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Capital", value: `$${fmt(mp.capital)}` },
            { label: "Invested", value: `$${fmt(mp.capital - mp.cash)}` },
            { label: "Cash Buffer", value: `$${fmt(mp.cash)} (${mp.cash_pct}%)` },
            { label: "Positions", value: mp.holdings.length },
          ].map((c) => (
            <div key={c.label} className="rounded-lg p-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{c.label}</div>
              <div className="text-lg font-bold mt-0.5">{c.value}</div>
            </div>
          ))}
        </div>

        {/* Cross-Asset Signals */}
        <div className="rounded-lg overflow-hidden mb-6" style={{ border: "1px solid var(--border)" }}>
          <div className="px-4 py-2.5" style={{ background: "var(--card)" }}>
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Cross-Asset Signals (Hedge + Arbitrage)</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--card)" }}>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase">Asset</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">Price</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">Hedge</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">Arb</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Score</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Signal</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">M2 Floor</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">Fair Value</th>
              </tr>
            </thead>
            <tbody>
              {mp.assets.map((a, i) => {
                const sc = a.combined_score;
                const col = sc <= 30 ? "#16a34a" : sc <= 50 ? "#22c55e" : sc <= 65 ? "#b45309" : "#dc2626";
                const sigCol = a.net_signal.includes("BUY") ? "#16a34a" : a.net_signal.includes("TRIM") ? "#dc2626" : "#b45309";
                return (
                  <tr key={a.ticker} style={{ borderTop: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "var(--card)" }}>
                    <td className="px-3 py-2 font-bold">{a.name}<span className="text-zinc-500 text-xs ml-2">{a.ticker}</span></td>
                    <td className="px-3 py-2 text-right font-mono">${a.price > 999 ? fmt(a.price) : a.price.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{a.hedge_score}</td>
                    <td className="px-3 py-2 text-right font-mono">{a.arb_score}</td>
                    <td className="px-3 py-2 text-center"><span className="font-bold font-mono" style={{ color: col }}>{sc}</span></td>
                    <td className="px-3 py-2 text-center"><span className="text-xs font-bold px-2 py-0.5 rounded" style={{ color: sigCol, background: `${sigCol}15` }}>{a.net_signal}</span></td>
                    <td className="px-3 py-2 text-right text-zinc-400 font-mono">${a.m2_floor > 999 ? fmt(Math.round(a.m2_floor)) : a.m2_floor.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-zinc-400 font-mono">${a.arb_fair_value > 999 ? fmt(Math.round(a.arb_fair_value)) : a.arb_fair_value.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ETF Allocation Table — heuristic or WSE */}
        <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${useWSEMacro ? "rgba(5,150,105,0.3)" : "var(--border)"}` }}>
          <div className="px-4 py-2.5" style={{ background: "var(--card)" }}>
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
              {useWSEMacro ? "ETF Portfolio — WSE Optimized" : "ETF Portfolio Allocation"}
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--card)" }}>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase">ETF</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase">Category</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">Weight</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">Amount</th>
                {useWSEMacro && <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase">u_i</th>}
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Score</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase">Signal</th>
              </tr>
            </thead>
            <tbody>
              {(useWSEMacro && macroWSE ? macroWSE.holdings : mp.holdings).map((h, i) => {
                const sig = ("signal" in h ? h.signal : "") as string;
                const sigCol = sig.includes("BUY") ? "#16a34a" : sig.includes("TRIM") ? "#dc2626" : "#b45309";
                const sc = ("score" in h ? h.score : 0) as number;
                const col = sc <= 30 ? "#16a34a" : sc <= 50 ? "#22c55e" : sc <= 65 ? "#b45309" : "#dc2626";
                const uVal = "conviction_u" in h ? (h as MacroWSEHolding).conviction_u : null;
                return (
                  <tr key={`${h.etf}-${i}`} style={{ borderTop: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "var(--card)" }}>
                    <td className="px-3 py-2 font-mono font-bold">{h.etf}</td>
                    <td className="px-3 py-2 text-xs">{h.category}</td>
                    <td className="px-3 py-2 text-right font-semibold">{h.weight_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right text-zinc-400">${fmt(h.amount)}</td>
                    {useWSEMacro && <td className="px-3 py-2 text-right font-mono text-xs" style={{ color: uVal && uVal >= 1.2 ? "#16a34a" : uVal && uVal >= 0.8 ? "#059669" : "#dc2626" }}>{uVal?.toFixed(2)}x</td>}
                    <td className="px-3 py-2 text-center"><span className="font-bold font-mono text-xs" style={{ color: col }}>{sc}</span></td>
                    <td className="px-3 py-2 text-center"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: sigCol, background: `${sigCol}15` }}>{sig}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
      </>}

      {/* ===== RECIPE PORTFOLIO TAB ===== */}
      {tab === "recipe" && <>
      <div
        className="rounded-lg p-4 mb-6 flex flex-wrap items-end gap-4"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Capital ($)</label>
          <input
            type="number"
            value={capital}
            onChange={(e) => setCapital(Number(e.target.value))}
            className="w-40 px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white"
          />
        </div>
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Market</label>
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            className="w-40 px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white"
          >
            {MARKETS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Top-N</label>
          <input
            type="number"
            min={5}
            max={50}
            value={recipeTopN}
            onChange={(e) => setRecipeTopN(Number(e.target.value))}
            className="w-24 px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white"
          />
        </div>
        <button
          onClick={buildRecipe}
          disabled={recipeLoading}
          className="px-5 py-2 rounded-md text-sm font-semibold transition-colors cursor-pointer hover:brightness-125 disabled:opacity-50"
          style={{ background: "#2563eb", color: "#fff" }}
        >
          {recipeLoading ? (
            <span className="flex items-center gap-2">
              <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Building Recipe Portfolio...
            </span>
          ) : recipeResult ? "Re-run (diff)" : "Build Recipe Portfolio"}
        </button>
        <div className="text-[11px] text-zinc-500 max-w-xl">
          Bayesian prior (composite score) + posterior on 2y returns →
          Ledoit-Wolf-shrunk vector Kelly × ¼ → 7% / 30% / 20% cap stack.
          Leader score = Schreiber (2000) Transfer Entropy into the held book.
        </div>
      </div>

      {recipeResult && !recipeResult.error && (
      <>
        {/* Rebalance alert banner */}
        {(() => {
          const rot = recipeResult.rotation;
          if (!rot) return null;
          const actionableResized = rot.resized.filter((r) => Math.abs(r.deltaPp) >= 2);
          const addedCount = rot.added.length;
          const retiredCount = rot.retired.length;
          const drift = actionableResized.length;
          if (addedCount === 0 && retiredCount === 0 && drift === 0) {
            return (
              <div className="rounded-lg p-3 mb-4 flex items-center gap-3"
                   style={{ background: "#0f1f12", border: "1px solid #14532d" }}>
                <span className="text-lg" style={{ color: "#16a34a" }}>●</span>
                <div className="text-xs" style={{ color: "#86efac" }}>
                  <strong>No rebalance required.</strong> No new entries, no retirements,
                  no positions drifted ≥ 2 pp. Hold through to the next weekly review.
                </div>
              </div>
            );
          }
          const modeSwitch = addedCount + retiredCount >= 8 && drift < 2;
          const severity = retiredCount > 0 ? "critical" : drift > 0 ? "warning" : "info";
          const theme = severity === "critical"
            ? { bg: "#2a1111", border: "#7f1d1d", dot: "#dc2626", text: "#fecaca", label: "CRITICAL" }
            : severity === "warning"
            ? { bg: "#1e1b11", border: "#b45309", dot: "#d97706", text: "#fcd34d", label: "WARNING" }
            : { bg: "#0f1a24", border: "#1d4ed8", dot: "#3b82f6", text: "#bfdbfe", label: "NOTICE" };
          return (
            <div className="rounded-lg p-4 mb-4"
                 style={{ background: theme.bg, border: `2px solid ${theme.border}` }}>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xl font-bold" style={{ color: theme.dot }}>●</span>
                <div className="text-sm font-bold tracking-wide" style={{ color: theme.dot }}>
                  REBALANCE ALERT — {theme.label}
                </div>
                <div className="text-xs" style={{ color: theme.text }}>
                  {addedCount > 0 && <span className="mr-3">{addedCount} added</span>}
                  {retiredCount > 0 && <span className="mr-3">{retiredCount} retired</span>}
                  {drift > 0 && <span className="mr-3">{drift} drifted ≥ 2pp</span>}
                </div>
              </div>
              <div className="text-xs leading-relaxed" style={{ color: theme.text }}>
                {modeSwitch ? (
                  <>
                    <strong>Likely a mode switch</strong> (market filter or top-N change), not
                    true drift. Keep the same filter and re-run after the next daily cron to see
                    a real rebalance signal.
                  </>
                ) : severity === "critical" ? (
                  <>
                    Positions have been retired by the engine — their posterior μ collapsed or
                    they fell below the 0.5 % floor. Review the retired list below and exit
                    those positions at next open. Execute any adds in the same session.
                  </>
                ) : severity === "warning" ? (
                  <>
                    {drift} position(s) drifted ≥ 2 pp from target. Rebalance the
                    highlighted rows at next open; leave sub-2 pp drift for the weekly review.
                  </>
                ) : (
                  <>
                    New entries only — no exits, no significant drift. Execute the additions at
                    tactical weight (half-target) and reassess next week.
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="rounded-lg p-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">As of</div>
            <div className="text-lg font-mono font-bold mt-1">{recipeResult.asOf}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">market: {recipeResult.market}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Universe</div>
            <div className="text-lg font-bold mt-1">{recipeResult.universeSize}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">actionable names</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Invested</div>
            <div className="text-lg font-bold mt-1" style={{ color: "#16a34a" }}>{(recipeResult.invested * 100).toFixed(1)}%</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">${fmt(recipeResult.invested * recipeResult.capital)}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Cash reserve</div>
            <div className="text-lg font-bold mt-1" style={{ color: "#d97706" }}>{(recipeResult.cashReserve * 100).toFixed(1)}%</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">${fmt(recipeResult.cashReserve * recipeResult.capital)}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">TE threshold</div>
            <div className="text-lg font-mono font-bold mt-1">{recipeResult.leaderThreshold.toFixed(4)}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">median of held book</div>
          </div>
        </div>

        {/* Rotation diff */}
        {recipeResult.rotation && (
          (recipeResult.rotation.added.length > 0 ||
           recipeResult.rotation.retired.length > 0 ||
           recipeResult.rotation.resized.length > 0) && (
          <div className="rounded-lg p-4 mb-6" style={{ background: "#1e1b11", border: "1px solid #b45309" }}>
            <div className="text-sm font-bold mb-2" style={{ color: "#d97706" }}>Rotation vs previous run</div>
            {recipeResult.rotation.added.length > 0 && (
              <div className="text-xs mb-1">
                <span className="text-zinc-400">Added:</span>{" "}
                <span className="font-mono" style={{ color: "#16a34a" }}>{recipeResult.rotation.added.join(", ")}</span>
              </div>
            )}
            {recipeResult.rotation.retired.length > 0 && (
              <div className="text-xs mb-1">
                <span className="text-zinc-400">Retired:</span>{" "}
                <span className="font-mono" style={{ color: "#dc2626" }}>
                  {recipeResult.rotation.retired.map((r) => `${r.ticker} (${(r.prevWeight * 100).toFixed(1)}%)`).join(", ")}
                </span>
              </div>
            )}
            {recipeResult.rotation.resized.length > 0 && (
              <div className="text-xs">
                <span className="text-zinc-400">
                  Resized (|Δ| ≥ 1pp):{" "}
                  <span className="text-zinc-500">
                    bold = ≥ 2pp (actionable this week) · plain = 1–2pp (monitor)
                  </span>
                </span>
                <div className="mt-1 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-0.5 font-mono">
                  {recipeResult.rotation.resized.map((r) => {
                    const actionable = Math.abs(r.deltaPp) >= 2;
                    return (
                      <div key={r.ticker}
                           style={{
                             fontWeight: actionable ? 700 : 400,
                             color: actionable ? "#f5f5f4" : "#a1a1aa",
                           }}>
                        {r.ticker} {(r.prevWeight * 100).toFixed(1)}% → {(r.newWeight * 100).toFixed(1)}%{" "}
                        <span style={{ color: r.deltaPp > 0 ? "#16a34a" : "#dc2626" }}>
                          ({r.deltaPp > 0 ? "+" : ""}{r.deltaPp.toFixed(1)}pp)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          )
        )}

        {/* Tier + sector summary side-by-side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="text-sm font-semibold mb-2">Tier summary</div>
            <div className="space-y-1">
              {recipeResult.tierSummary.map((t) => {
                const col =
                  t.tier === "anchor" ? "#2563eb"
                  : t.tier === "follower" ? "#059669"
                  : t.tier === "tactical" ? "#d97706"
                  : t.tier === "trim" ? "#71717a"
                  : "#6b7280";
                return (
                  <div key={t.tier} className="flex items-center justify-between text-xs">
                    <span className="font-mono uppercase" style={{ color: col }}>{t.tier}</span>
                    <span className="text-zinc-500">{t.count} names</span>
                    <span className="font-mono font-semibold">{(t.weight * 100).toFixed(2)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="text-sm font-semibold mb-2">Sector summary</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              {recipeResult.sectorSummary.filter((s) => s.weight > 0).map((s) => (
                <div key={s.sector} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">{s.sector}</span>
                  <span className="font-mono font-semibold" style={{ color: s.weight >= 0.25 ? "#d97706" : "#059669" }}>
                    {(s.weight * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Allocation table */}
        <div className="overflow-x-auto rounded-lg" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left" style={{ color: "var(--muted)", background: "var(--card-hover)" }}>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Ticker</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Sector</th>
                <th className="px-3 py-2 text-center">Mkt</th>
                <th className="px-3 py-2 text-right">Score</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2 text-right">μ prior</th>
                <th className="px-3 py-2 text-right">μ post</th>
                <th className="px-3 py-2 text-right">TE</th>
                <th className="px-3 py-2 text-center">Tier</th>
                <th className="px-3 py-2 text-right">Weight</th>
                <th className="px-3 py-2 text-right">$</th>
                <th className="px-3 py-2 text-right">Shares</th>
              </tr>
            </thead>
            <tbody>
              {recipeResult.positions.map((p, i) => {
                const tierCol =
                  p.tier === "anchor" ? "#2563eb"
                  : p.tier === "follower" ? "#059669"
                  : p.tier === "tactical" ? "#d97706"
                  : "#71717a";
                return (
                  <tr key={p.ticker} style={{ borderTop: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "var(--card-hover)" }}>
                    <td className="px-3 py-2 text-zinc-500">{i + 1}</td>
                    <td className="px-3 py-2 font-mono font-bold">
                      <Link href={`/stock/${p.ticker}`} className="hover:underline">{p.ticker}</Link>
                    </td>
                    <td className="px-3 py-2 truncate max-w-[180px]" title={p.name}>{p.name}</td>
                    <td className="px-3 py-2 text-zinc-400 text-[11px]">{p.sector}</td>
                    <td className="px-3 py-2 text-center text-zinc-400 text-[11px]">{p.market}</td>
                    <td className="px-3 py-2 text-right font-mono">{p.score}</td>
                    <td className="px-3 py-2 text-[11px] text-zinc-400 truncate max-w-[120px]" title={p.action}>{p.action}</td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-500">{(p.priorMu * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right font-mono" style={{ color: p.posteriorMu > 0 ? "#16a34a" : "#dc2626" }}>
                      {(p.posteriorMu * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[11px]">{p.leaderScore.toFixed(3)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                            style={{ color: tierCol, background: `${tierCol}20` }}>
                        {p.tier}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{(p.weight * 100).toFixed(2)}%</td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-400">${fmt(p.amount)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(p.shares)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="text-[11px] text-zinc-500 mt-3 max-w-4xl leading-relaxed">
          <strong>Read the table:</strong> μ posterior is the Bayesian blend of the fundamental score-implied prior
          with observed 2y excess returns. TE is Schreiber-style information flow from the name into the rest of the book;
          anchor tier requires both weight ≥ 5.5% and TE above the median of the held book. Shares are floor-rounded to
          the nearest whole share; for A-share and HK lot sizing, round down further at execution.
        </div>
      </>
      )}

      {recipeResult?.error && (
        <div className="rounded-lg p-4 mb-6" style={{ background: "#2a1111", border: "1px solid #7f1d1d", color: "#fecaca" }}>
          <div className="text-sm font-semibold">Recipe build failed</div>
          <div className="text-xs mt-1">{recipeResult.error}</div>
        </div>
      )}
      </>}
    </main>
  );
}
