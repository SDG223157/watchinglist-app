"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Asset {
  key: string;
  name: string;
  ticker: string;
  category: string;
  price: number;
  hedge_score: number;
  arb_score: number;
  combined_score: number;
  m2_floor: number;
  m2_premium: number;
  activation: string;
  arb_fair_value: number;
  arb_premium: number;
  arb_signal: string;
  combined_fair: number;
  stretch_target: number;
  net_signal: string;
  signal_detail: string;
  vs_floor: number;
  vs_fair: number;
  weight: string;
  structural_bid: number;
  hedge_against: string[];
}

interface Sector {
  key: string;
  name: string;
  etf: string;
  beta_type: string;
  peak_phase: string;
  ret_1m: number;
  ret_3m: number;
  ret_6m: number;
  ret_12m: number;
  alpha_3m: number;
  hedge_demand: number;
  arb_score: number;
  pe: number | null;
  div_yield: number | null;
}

interface PerfEntry {
  category: string;
  price: number;
  w1: number;
  m1: number;
  m3: number;
  ytd: number;
  y1: number;
}

interface Allocation {
  equities: { range: string; score: number; regime: string };
  hard_assets: { range: string; score: number };
  cash_usd: { range: string; score: number };
  crypto: { range: string; score: number };
}

interface Reflexivity {
  source: string;
  target: string;
  state: string;
  strength: string;
  mechanism: string;
}

interface RegressionFactor {
  name: string;
  category: string;
  beta: number;
  t_stat: number;
  significant: boolean;
  desc: string;
}

interface RegressionResult {
  asset: string;
  ticker: string;
  n_obs: number;
  alpha: number;
  r2: number;
  adj_r2: number;
  hedge_r2: number;
  arb_r2: number;
  structural_r2: number;
  unexplained: number;
  orthogonalized?: boolean;
  r2_oos?: number;
  factors: RegressionFactor[];
}

interface PlaybookData {
  timestamp: string;
  assets: Asset[];
  sectors: Sector[];
  regime: string;
  spread: number;
  allocation: Allocation;
  reflexivity: Reflexivity[];
  verify: {
    rules: unknown[];
    performance: Record<string, PerfEntry>;
  };
  regression?: Record<string, RegressionResult>;
}

interface StockCrossSection {
  symbol: string;
  name: string;
  alpha10y: number;
  blueprintScore: number;
  opMargin: number;
  roic: number;
  fcfYield: number;
  revGrowth: number;
  grossMargin: number;
}

interface CrossSectionData {
  stocks: StockCrossSection[];
  regression: { r2: number; beta: number; intercept: number; tStat: number };
  factorBetas: { name: string; beta: number; tStat: number; significant: boolean }[];
  computed_at: string;
}

function scoreColor(score: number) {
  if (score < 30) return "var(--green)";
  if (score < 50) return "#4ade80";
  if (score < 65) return "var(--yellow)";
  if (score < 80) return "#f97316";
  return "var(--red)";
}

function retColor(v: number) {
  if (v > 2) return "var(--green)";
  if (v < -2) return "var(--red)";
  return "var(--muted)";
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 text-right" style={{ color: "var(--muted)" }}>{label}</span>
      <div className="flex-1 h-2 rounded-full" style={{ background: "var(--border)" }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, background: scoreColor(score) }}
        />
      </div>
      <span className="w-8 font-mono font-bold" style={{ color: scoreColor(score) }}>
        {score}
      </span>
    </div>
  );
}

function SignalBadge({ signal }: { signal: string }) {
  const s = signal.toUpperCase();
  let bg = "var(--border)";
  let color = "var(--muted)";
  if (s.includes("STRONG BUY")) { bg = "color-mix(in srgb, var(--green) 20%, transparent)"; color = "var(--green)"; }
  else if (s.includes("ACCUMULATE")) { bg = "color-mix(in srgb, #4ade80 15%, transparent)"; color = "#4ade80"; }
  else if (s.includes("TRIM")) { bg = "color-mix(in srgb, var(--red) 15%, transparent)"; color = "var(--red)"; }
  else if (s.includes("HOLD")) { bg = "color-mix(in srgb, var(--yellow) 12%, transparent)"; color = "var(--yellow)"; }
  return (
    <span
      className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
      style={{ background: bg, color, border: `1px solid ${color}33` }}
    >
      {signal}
    </span>
  );
}

function WeightBadge({ weight }: { weight: string }) {
  const colors: Record<string, string> = {
    overweight: "var(--green)",
    neutral: "var(--yellow)",
    underweight: "var(--red)",
  };
  const c = colors[weight] || "var(--muted)";
  return (
    <span
      className="px-2 py-0.5 rounded text-[10px] font-bold uppercase"
      style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }}
    >
      {weight === "overweight" ? "▲ OW" : weight === "underweight" ? "▼ UW" : "● N"}
    </span>
  );
}

function regimeColor(regime: string) {
  switch (regime) {
    case "COOLING": case "RISK-OFF": return "var(--blue)";
    case "LATE-CYCLE": return "var(--yellow)";
    case "TRANSITION": return "var(--muted)";
    case "EXPANSION": return "#4ade80";
    case "BOOM": return "var(--green)";
    default: return "var(--muted)";
  }
}

const CATEGORY_ORDER = ["cross_asset", "bonds", "volatility", "sectors", "factors"];
const CATEGORY_LABELS: Record<string, string> = {
  cross_asset: "Cross-Asset",
  bonds: "Bonds & Credit",
  volatility: "Volatility",
  sectors: "Sectors",
  factors: "Factors & Thematic",
};

function StockSearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const go = () => {
    const sym = query.trim().toUpperCase();
    if (sym) {
      router.push(`/stock/${encodeURIComponent(sym)}`);
      setQuery("");
    }
  };

  return (
    <div className="flex items-center gap-2 mb-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
        placeholder="Analyze any stock → type ticker (e.g. GOOG, TSLA, NVDA)"
        className="flex-1 px-3 py-2 rounded-lg text-sm"
        style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)" }}
      />
      <button
        onClick={go}
        className="px-4 py-2 rounded-lg text-sm font-semibold shrink-0 cursor-pointer"
        style={{ background: "var(--blue)", color: "#000" }}
      >
        4-Layer Analysis →
      </button>
    </div>
  );
}

export function MacroDashboard() {
  const [data, setData] = useState<PlaybookData | null>(null);
  const [crossData, setCrossData] = useState<CrossSectionData | null>(null);
  const [crossLoading, setCrossLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "sectors" | "verify" | "reflexivity" | "regression" | "crossSection">("overview");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/macro-playbook");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCrossSection = useCallback(async () => {
    if (crossData || crossLoading) return;
    setCrossLoading(true);
    try {
      const res = await fetch("/api/cross-section");
      if (res.ok) setCrossData(await res.json());
    } catch { /* silent */ } finally {
      setCrossLoading(false);
    }
  }, [crossData, crossLoading]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (activeTab === "crossSection") fetchCrossSection(); }, [activeTab, fetchCrossSection]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--blue)", borderTopColor: "transparent" }} />
        <p className="text-sm" style={{ color: "var(--muted)" }}>Running macro playbook — fetching cross-asset data...</p>
        <p className="text-xs" style={{ color: "var(--border)" }}>This takes ~30-60 seconds on first load</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg p-6 text-center" style={{ background: "var(--card)", border: "1px solid var(--red)" }}>
        <p className="text-sm font-bold" style={{ color: "var(--red)" }}>Error loading macro playbook</p>
        <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>{error}</p>
        <button onClick={fetchData} className="mt-4 text-xs px-4 py-2 rounded-md cursor-pointer" style={{ background: "var(--border)", color: "var(--text)" }}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const tabs = [
    { key: "overview" as const, label: "Overview" },
    { key: "sectors" as const, label: "Sectors" },
    { key: "regression" as const, label: "Regression" },
    { key: "crossSection" as const, label: "Cross-Section" },
    { key: "verify" as const, label: "Performance" },
    { key: "reflexivity" as const, label: "Reflexivity" },
  ];

  return (
    <div>
      {/* Stock Search */}
      <StockSearchBar />

      {/* Tab Bar */}
      <div className="flex gap-1 mb-6 p-1 rounded-lg w-fit" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className="px-4 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer"
            style={{
              background: activeTab === t.key ? "var(--border)" : "transparent",
              color: activeTab === t.key ? "var(--text)" : "var(--muted)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && <OverviewTab data={data} />}
      {activeTab === "sectors" && <SectorsTab data={data} />}
      {activeTab === "regression" && <RegressionTab data={data} />}
      {activeTab === "crossSection" && <CrossSectionTab data={crossData} loading={crossLoading} />}
      {activeTab === "verify" && <VerifyTab data={data} />}
      {activeTab === "reflexivity" && <ReflexivityTab data={data} />}

      <div className="mt-8 text-[10px] text-center" style={{ color: "var(--border)" }}>
        Framework output, not investment advice. Always verify with fundamental analysis.
        <br />Last computed: {data.timestamp}
      </div>
    </div>
  );
}

function OverviewTab({ data }: { data: PlaybookData }) {
  const alloc = data.allocation;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Allocation Card */}
      <div className="rounded-lg p-5 lg:col-span-1" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h3 className="text-sm font-bold uppercase tracking-wider mb-4">Allocation</h3>
        <div className="space-y-3">
          <AllocRow label="Equities" range={alloc.equities.range} score={alloc.equities.score} extra={alloc.equities.regime} />
          <AllocRow label="Hard Assets" range={alloc.hard_assets.range} score={alloc.hard_assets.score} />
          <AllocRow label="Cash / USD" range={alloc.cash_usd.range} score={alloc.cash_usd.score} />
          <AllocRow label="Crypto" range={alloc.crypto.range} score={alloc.crypto.score} />
        </div>

        <div className="mt-5 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>Regime</span>
            <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ color: regimeColor(data.regime), background: `color-mix(in srgb, ${regimeColor(data.regime)} 12%, transparent)` }}>
              {data.regime}
            </span>
          </div>
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            Def-Cyc Spread: <span className="font-mono font-bold" style={{ color: data.spread > 2 ? "var(--blue)" : data.spread < -2 ? "var(--green)" : "var(--muted)" }}>
              {data.spread > 0 ? "+" : ""}{data.spread}pp
            </span>
          </div>
        </div>
      </div>

      {/* Cross-Asset Signal Matrix */}
      <div className="rounded-lg p-5 lg:col-span-2" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h3 className="text-sm font-bold uppercase tracking-wider mb-4">Layer 1: Cross-Asset Signals</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th className="text-left py-2 pr-3 font-medium" style={{ color: "var(--muted)" }}>Asset</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>Price</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>Hedge</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>Arb</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>Score</th>
                <th className="text-center py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>Signal</th>
                <th className="text-center py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>Weight</th>
              </tr>
            </thead>
            <tbody>
              {data.assets.map((a) => (
                <tr key={a.key} className="hover:brightness-110" style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="py-2.5 pr-3">
                    <div className="font-bold">{a.name}</div>
                    <div className="text-[10px]" style={{ color: "var(--muted)" }}>{a.activation}</div>
                  </td>
                  <td className="text-right py-2 px-2 font-mono">
                    ${a.price > 100 ? a.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : a.price.toFixed(2)}
                  </td>
                  <td className="text-right py-2 px-2 font-mono" style={{ color: scoreColor(a.hedge_score) }}>{a.hedge_score}</td>
                  <td className="text-right py-2 px-2 font-mono" style={{ color: scoreColor(a.arb_score) }}>{a.arb_score}</td>
                  <td className="text-right py-2 px-2">
                    <span className="font-mono font-bold text-sm" style={{ color: scoreColor(a.combined_score) }}>{a.combined_score}</span>
                  </td>
                  <td className="text-center py-2 px-2"><SignalBadge signal={a.net_signal} /></td>
                  <td className="text-center py-2 px-2"><WeightBadge weight={a.weight} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Asset Detail Cards */}
      {data.assets.map((a) => (
        <div key={a.key} className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="font-bold text-sm">{a.name}</span>
              <span className="ml-2 text-xs font-mono" style={{ color: "var(--muted)" }}>{a.ticker}</span>
            </div>
            <SignalBadge signal={a.net_signal} />
          </div>
          <div className="space-y-1.5 mb-3">
            <ScoreBar score={a.hedge_score} label="Hedge" />
            <ScoreBar score={a.arb_score} label="Arb" />
            <ScoreBar score={a.combined_score} label="Comb" />
          </div>
          <div className="grid grid-cols-3 gap-2 text-[10px] mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            <div>
              <div style={{ color: "var(--muted)" }}>M2 Floor</div>
              <div className="font-mono font-bold">${a.m2_floor.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
            <div>
              <div style={{ color: "var(--muted)" }}>Fair Value</div>
              <div className="font-mono font-bold">${a.combined_fair.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
            <div>
              <div style={{ color: "var(--muted)" }}>vs Fair</div>
              <div className="font-mono font-bold" style={{ color: a.vs_fair < 0 ? "var(--green)" : "var(--red)" }}>
                {a.vs_fair > 0 ? "+" : ""}{a.vs_fair}%
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AllocRow({ label, range, score, extra }: { label: string; range: string; score: number; extra?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-xs" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono font-bold">{range}</span>
        {extra && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--border)", color: "var(--muted)" }}>
            {extra}
          </span>
        )}
        <span className="text-[10px] font-mono" style={{ color: scoreColor(score) }}>({score})</span>
      </div>
    </div>
  );
}

function SectorsTab({ data }: { data: PlaybookData }) {
  const defensives = data.sectors.filter((s) => s.beta_type === "defensive");
  const cyclicals = data.sectors.filter((s) => s.beta_type === "cyclical");

  return (
    <div className="space-y-4">
      <div className="rounded-lg p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-sm font-bold uppercase tracking-wider">Layer 2: Sector Rotation</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ color: regimeColor(data.regime), background: `color-mix(in srgb, ${regimeColor(data.regime)} 12%, transparent)` }}>
            {data.regime}
          </span>
          <span className="text-xs font-mono" style={{ color: "var(--muted)" }}>Spread {data.spread > 0 ? "+" : ""}{data.spread}pp</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th className="text-left py-2 pr-3 font-medium" style={{ color: "var(--muted)" }}>Sector</th>
                <th className="text-center py-2 px-1 font-medium" style={{ color: "var(--muted)" }}>Type</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>1M</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>3M</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>6M</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>12M</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>α 3M</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>Hedge</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>Arb</th>
                <th className="text-left py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>Peak Phase</th>
              </tr>
            </thead>
            <tbody>
              {data.sectors.map((s) => {
                const typeColor = s.beta_type === "defensive" ? "var(--blue)" : "var(--yellow)";
                return (
                  <tr key={s.key} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="py-2 pr-3">
                      <span className="font-bold">{s.name}</span>
                      <span className="ml-1 text-[10px] font-mono" style={{ color: "var(--muted)" }}>{s.etf}</span>
                    </td>
                    <td className="text-center py-2 px-1">
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ color: typeColor, background: `color-mix(in srgb, ${typeColor} 12%, transparent)` }}>
                        {s.beta_type === "defensive" ? "DEF" : "CYC"}
                      </span>
                    </td>
                    <td className="text-right py-2 px-2 font-mono" style={{ color: retColor(s.ret_1m) }}>{s.ret_1m > 0 ? "+" : ""}{s.ret_1m}%</td>
                    <td className="text-right py-2 px-2 font-mono" style={{ color: retColor(s.ret_3m) }}>{s.ret_3m > 0 ? "+" : ""}{s.ret_3m}%</td>
                    <td className="text-right py-2 px-2 font-mono" style={{ color: retColor(s.ret_6m) }}>{s.ret_6m > 0 ? "+" : ""}{s.ret_6m}%</td>
                    <td className="text-right py-2 px-2 font-mono" style={{ color: retColor(s.ret_12m) }}>{s.ret_12m > 0 ? "+" : ""}{s.ret_12m}%</td>
                    <td className="text-right py-2 px-2 font-mono font-bold" style={{ color: s.alpha_3m > 2 ? "var(--green)" : s.alpha_3m < -2 ? "var(--red)" : "var(--muted)" }}>
                      {s.alpha_3m > 0 ? "+" : ""}{s.alpha_3m}%
                    </td>
                    <td className="text-right py-2 px-2 font-mono" style={{ color: scoreColor(s.hedge_demand) }}>{s.hedge_demand}</td>
                    <td className="text-right py-2 px-2 font-mono" style={{ color: scoreColor(s.arb_score) }}>{s.arb_score}</td>
                    <td className="py-2 px-2 text-[10px]" style={{ color: "var(--muted)" }}>{s.peak_phase}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Defensive vs Cyclical */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectorGroup title="Defensive" sectors={defensives} color="var(--blue)" />
        <SectorGroup title="Cyclical" sectors={cyclicals} color="var(--yellow)" />
      </div>
    </div>
  );
}

function SectorGroup({ title, sectors, color }: { title: string; sectors: Sector[]; color: string }) {
  const avgAlpha = sectors.length > 0 ? sectors.reduce((s, x) => s + x.alpha_3m, 0) / sectors.length : 0;
  return (
    <div className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-bold uppercase" style={{ color }}>{title}</h4>
        <span className="text-xs font-mono" style={{ color: avgAlpha > 0 ? "var(--green)" : "var(--red)" }}>
          Avg α: {avgAlpha > 0 ? "+" : ""}{avgAlpha.toFixed(1)}%
        </span>
      </div>
      <div className="space-y-2">
        {sectors.map((s) => (
          <div key={s.key} className="flex items-center justify-between text-xs">
            <span className="font-medium">{s.name}</span>
            <div className="flex items-center gap-3">
              <span className="font-mono" style={{ color: retColor(s.ret_3m) }}>{s.ret_3m > 0 ? "+" : ""}{s.ret_3m}%</span>
              <span className="font-mono font-bold" style={{ color: s.alpha_3m > 2 ? "var(--green)" : s.alpha_3m < -2 ? "var(--red)" : "var(--muted)" }}>
                α {s.alpha_3m > 0 ? "+" : ""}{s.alpha_3m}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VerifyTab({ data }: { data: PlaybookData }) {
  const perf = data.verify.performance;
  const entries = Object.entries(perf);

  return (
    <div className="space-y-4">
      {CATEGORY_ORDER.map((cat) => {
        const items = entries.filter(([, v]) => v.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--muted)" }}>
              {CATEGORY_LABELS[cat] || cat}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th className="text-left py-1.5 pr-3 font-medium" style={{ color: "var(--muted)" }}>Asset</th>
                    <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--muted)" }}>Price</th>
                    <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--muted)" }}>1W</th>
                    <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--muted)" }}>1M</th>
                    <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--muted)" }}>3M</th>
                    <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--muted)" }}>YTD</th>
                    <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--muted)" }}>1Y</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(([name, v]) => (
                    <tr key={name} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className="py-1.5 pr-3 font-medium">{name}</td>
                      <td className="text-right py-1.5 px-2 font-mono">
                        {v.price > 100 ? `$${v.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : v.price > 1 ? `$${v.price.toFixed(2)}` : v.price.toFixed(2)}
                      </td>
                      <td className="text-right py-1.5 px-2 font-mono" style={{ color: retColor(v.w1) }}>{v.w1 > 0 ? "+" : ""}{v.w1}%</td>
                      <td className="text-right py-1.5 px-2 font-mono" style={{ color: retColor(v.m1) }}>{v.m1 > 0 ? "+" : ""}{v.m1}%</td>
                      <td className="text-right py-1.5 px-2 font-mono" style={{ color: retColor(v.m3) }}>{v.m3 > 0 ? "+" : ""}{v.m3}%</td>
                      <td className="text-right py-1.5 px-2 font-mono font-bold" style={{ color: retColor(v.ytd) }}>{v.ytd > 0 ? "+" : ""}{v.ytd}%</td>
                      <td className="text-right py-1.5 px-2 font-mono" style={{ color: retColor(v.y1) }}>{v.y1 > 0 ? "+" : ""}{v.y1}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DecompBar({ hedge, arb, structural, unexplained }: { hedge: number; arb: number; structural: number; unexplained: number }) {
  const total = hedge + arb + structural + unexplained;
  if (total === 0) return null;
  const hPct = (hedge / total) * 100;
  const aPct = (arb / total) * 100;
  const sPct = (structural / total) * 100;
  return (
    <div className="flex h-3 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
      {hPct > 0.5 && <div style={{ width: `${hPct}%`, background: "#3b82f6" }} title={`Hedge ${(hedge * 100).toFixed(1)}%`} />}
      {aPct > 0.5 && <div style={{ width: `${aPct}%`, background: "#f59e0b" }} title={`Arb ${(arb * 100).toFixed(1)}%`} />}
      {sPct > 0.5 && <div style={{ width: `${sPct}%`, background: "#10b981" }} title={`Structural ${(structural * 100).toFixed(1)}%`} />}
    </div>
  );
}

function RegressionTab({ data }: { data: PlaybookData }) {
  const reg = data.regression;
  if (!reg || Object.keys(reg).length === 0) {
    return (
      <div className="rounded-lg p-6 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <p className="text-sm" style={{ color: "var(--muted)" }}>No regression data available</p>
      </div>
    );
  }

  const sorted = Object.entries(reg).sort(([, a], [, b]) => b.r2 - a.r2);

  return (
    <div className="space-y-4">
      {/* Cross-asset comparison */}
      <div className="rounded-lg p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3 mb-1">
          <h3 className="text-sm font-bold uppercase tracking-wider">Factor Regression (APT-Style V2)</h3>
          <span className="text-[10px] px-2 py-0.5 rounded font-bold" style={{ color: "#a78bfa", background: "color-mix(in srgb, #a78bfa 12%, transparent)" }}>
            Orthogonalized
          </span>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
          Weekly returns regressed against Hedge, Arb &amp; Credit, and Structural macro factors · Non-SPY factors orthogonalized via Frisch-Waugh-Lovell
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th className="text-left py-2 pr-3 font-medium" style={{ color: "var(--muted)" }}>Asset</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>R²</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>OOS R²</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "#3b82f6" }}>Hedge</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "#f59e0b" }}>Arb</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "#10b981" }}>Struct</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>Unexpl</th>
                <th className="text-center py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>Dominant</th>
                <th className="py-2 pl-3 font-medium w-40" style={{ color: "var(--muted)" }}>Decomposition</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(([key, res]) => {
                const dominant = res.hedge_r2 >= res.arb_r2 && res.hedge_r2 >= res.structural_r2 ? "HEDGE"
                  : res.arb_r2 >= res.structural_r2 ? "ARB" : "STRUCT";
                const domColor = dominant === "HEDGE" ? "#3b82f6" : dominant === "ARB" ? "#f59e0b" : "#10b981";
                const oosR2 = res.r2_oos;
                const oosColor = oosR2 != null
                  ? oosR2 > 0.3 ? "var(--green)" : oosR2 > 0 ? "var(--yellow)" : "var(--red)"
                  : "var(--muted)";
                return (
                  <tr key={key} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold">{res.asset}</span>
                        <span className="text-[10px] font-mono" style={{ color: "var(--muted)" }}>{res.ticker}</span>
                        {res.orthogonalized && (
                          <span className="text-[8px] px-1 rounded" style={{ color: "#a78bfa", background: "color-mix(in srgb, #a78bfa 10%, transparent)" }}>⊥</span>
                        )}
                      </div>
                    </td>
                    <td className="text-right py-2 px-2 font-mono font-bold" style={{ color: res.r2 > 0.4 ? "var(--text)" : "var(--muted)" }}>
                      {(res.r2 * 100).toFixed(1)}%
                    </td>
                    <td className="text-right py-2 px-2 font-mono" style={{ color: oosColor }}>
                      {oosR2 != null ? `${(oosR2 * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="text-right py-2 px-2 font-mono" style={{ color: "#3b82f6" }}>{(res.hedge_r2 * 100).toFixed(1)}%</td>
                    <td className="text-right py-2 px-2 font-mono" style={{ color: "#f59e0b" }}>{(res.arb_r2 * 100).toFixed(1)}%</td>
                    <td className="text-right py-2 px-2 font-mono" style={{ color: "#10b981" }}>{(res.structural_r2 * 100).toFixed(1)}%</td>
                    <td className="text-right py-2 px-2 font-mono" style={{ color: "var(--muted)" }}>{(res.unexplained * 100).toFixed(1)}%</td>
                    <td className="text-center py-2 px-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ color: domColor, background: `color-mix(in srgb, ${domColor} 15%, transparent)` }}>
                        {dominant}
                      </span>
                    </td>
                    <td className="py-2 pl-3">
                      <DecompBar hedge={res.hedge_r2} arb={res.arb_r2} structural={res.structural_r2} unexplained={res.unexplained} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-4 mt-3 pt-3 text-[10px]" style={{ borderTop: "1px solid var(--border)", color: "var(--muted)" }}>
          <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: "#3b82f6" }} />Hedge (VIX, DXY, Gold, TIPS)</span>
          <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: "#f59e0b" }} />Arb (SPY, 10Y, BTC, Credit)</span>
          <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: "#10b981" }} />Structural (Oil, Silver)</span>
          <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: "#a78bfa" }} />⊥ = Orthogonalized vs SPY</span>
        </div>
      </div>

      {/* Per-asset detail cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sorted.map(([key, res]) => (
          <div key={key} className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="font-bold text-sm">{res.asset}</span>
                <span className="ml-2 text-[10px] font-mono" style={{ color: "var(--muted)" }}>R²={(res.r2 * 100).toFixed(1)}%</span>
              </div>
              <span className="text-[10px] font-mono" style={{ color: "var(--muted)" }}>α={res.alpha > 0 ? "+" : ""}{res.alpha}%/wk</span>
            </div>

            <DecompBar hedge={res.hedge_r2} arb={res.arb_r2} structural={res.structural_r2} unexplained={res.unexplained} />

            <div className="grid grid-cols-4 gap-1 text-[10px] mt-2 mb-3">
              <div className="text-center"><span style={{ color: "#3b82f6" }}>{(res.hedge_r2 * 100).toFixed(0)}%</span><div style={{ color: "var(--muted)" }}>Hedge</div></div>
              <div className="text-center"><span style={{ color: "#f59e0b" }}>{(res.arb_r2 * 100).toFixed(0)}%</span><div style={{ color: "var(--muted)" }}>Arb</div></div>
              <div className="text-center"><span style={{ color: "#10b981" }}>{(res.structural_r2 * 100).toFixed(0)}%</span><div style={{ color: "var(--muted)" }}>Struct</div></div>
              <div className="text-center"><span style={{ color: "var(--muted)" }}>{(res.unexplained * 100).toFixed(0)}%</span><div style={{ color: "var(--muted)" }}>Idio</div></div>
            </div>

            <div className="text-[10px]" style={{ borderTop: "1px solid var(--border)" }}>
              <div className="grid grid-cols-4 gap-1 py-1.5 font-medium" style={{ color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                <span>Factor</span><span className="text-right">Beta</span><span className="text-right">t-stat</span><span className="text-center">Sig</span>
              </div>
              {res.factors.map((f) => {
                const catColor = f.category === "hedge" ? "#3b82f6" : f.category === "arb" ? "#f59e0b" : "#10b981";
                return (
                  <div key={f.name} className="grid grid-cols-4 gap-1 py-1" style={{ borderBottom: "1px solid color-mix(in srgb, var(--border) 50%, transparent)" }}>
                    <span style={{ color: catColor }}>{f.name}</span>
                    <span className="text-right font-mono">{f.beta > 0 ? "+" : ""}{f.beta.toFixed(3)}</span>
                    <span className="text-right font-mono" style={{ color: Math.abs(f.t_stat) > 1.96 ? "var(--text)" : "var(--muted)" }}>
                      {f.t_stat > 0 ? "+" : ""}{f.t_stat.toFixed(1)}
                    </span>
                    <span className="text-center font-bold" style={{ color: Math.abs(f.t_stat) > 2.58 ? "var(--green)" : Math.abs(f.t_stat) > 1.96 ? "var(--yellow)" : "var(--muted)" }}>
                      {Math.abs(f.t_stat) > 2.58 ? "***" : Math.abs(f.t_stat) > 1.96 ? "**" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScatterChart({ stocks, regression }: { stocks: StockCrossSection[]; regression: CrossSectionData["regression"] }) {
  if (stocks.length === 0) return null;

  const alphas = stocks.map((s) => s.alpha10y);
  const scores = stocks.map((s) => s.blueprintScore);
  const minA = Math.min(...alphas) - 2;
  const maxA = Math.max(...alphas) + 2;
  const minS = Math.min(...scores) - 0.5;
  const maxS = Math.max(...scores) + 0.5;

  const W = 600, H = 360, PAD = 50, R_PAD = 20, T_PAD = 20;
  const plotW = W - PAD - R_PAD;
  const plotH = H - PAD - T_PAD;
  const x = (s: number) => PAD + ((s - minS) / (maxS - minS)) * plotW;
  const y = (a: number) => T_PAD + plotH - ((a - minA) / (maxA - minA)) * plotH;

  // Regression line
  const lineX1 = minS;
  const lineX2 = maxS;
  const lineY1 = regression.intercept + regression.beta * lineX1;
  const lineY2 = regression.intercept + regression.beta * lineX2;

  // Grid lines
  const yTicks: number[] = [];
  const step = Math.ceil((maxA - minA) / 5);
  for (let v = Math.ceil(minA / step) * step; v <= maxA; v += step) yTicks.push(v);
  const xTicks: number[] = [];
  for (let v = Math.ceil(minS); v <= maxS; v++) xTicks.push(v);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[700px]" style={{ fontFamily: "ui-monospace, monospace" }}>
      {/* Grid */}
      {yTicks.map((v) => (
        <g key={`gy${v}`}>
          <line x1={PAD} y1={y(v)} x2={W - R_PAD} y2={y(v)} stroke="var(--border)" strokeWidth={0.5} />
          <text x={PAD - 6} y={y(v) + 3} textAnchor="end" fill="var(--muted)" fontSize={9}>{v}%</text>
        </g>
      ))}
      {xTicks.map((v) => (
        <g key={`gx${v}`}>
          <line x1={x(v)} y1={T_PAD} x2={x(v)} y2={H - PAD} stroke="var(--border)" strokeWidth={0.5} />
          <text x={x(v)} y={H - PAD + 14} textAnchor="middle" fill="var(--muted)" fontSize={9}>{v}</text>
        </g>
      ))}

      {/* Regression line */}
      <line
        x1={x(lineX1)} y1={y(lineY1)} x2={x(lineX2)} y2={y(lineY2)}
        stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="6 3" opacity={0.7}
      />

      {/* Axis labels */}
      <text x={W / 2} y={H - 4} textAnchor="middle" fill="var(--muted)" fontSize={10}>Blueprint Score</text>
      <text x={12} y={H / 2} textAnchor="middle" fill="var(--muted)" fontSize={10} transform={`rotate(-90 12 ${H / 2})`}>10Y Ann. Alpha (%)</text>

      {/* Data points */}
      {stocks.map((s) => {
        const cx = x(s.blueprintScore);
        const cy = y(s.alpha10y);
        const col = s.alpha10y > 5 ? "#10b981" : s.alpha10y > 0 ? "#4ade80" : s.alpha10y > -5 ? "#f59e0b" : "#ef4444";
        return (
          <g key={s.symbol}>
            <circle cx={cx} cy={cy} r={5} fill={col} opacity={0.8} stroke="var(--card)" strokeWidth={1} />
            <text x={cx + 7} y={cy + 3} fill="var(--text)" fontSize={8} fontWeight={600}>{s.symbol}</text>
          </g>
        );
      })}

      {/* R² label */}
      <text x={W - R_PAD - 4} y={T_PAD + 14} textAnchor="end" fill="#f59e0b" fontSize={10} fontWeight={700}>
        R² = {(regression.r2 * 100).toFixed(1)}%
      </text>
    </svg>
  );
}

function CrossSectionTab({ data, loading }: { data: CrossSectionData | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#f59e0b", borderTopColor: "transparent" }} />
        <p className="text-xs" style={{ color: "var(--muted)" }}>Computing cross-sectional alpha for ~28 stocks (10Y data + fundamentals)...</p>
        <p className="text-[10px]" style={{ color: "var(--border)" }}>This takes 2-3 minutes on first load, then caches for 24 hours</p>
      </div>
    );
  }

  if (!data || data.stocks.length === 0) {
    return (
      <div className="rounded-lg p-6 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <p className="text-sm" style={{ color: "var(--muted)" }}>No cross-section data available</p>
      </div>
    );
  }

  const { stocks, regression, factorBetas } = data;

  return (
    <div className="space-y-4">
      {/* Scatter chart + regression summary */}
      <div className="rounded-lg p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3 mb-1">
          <h3 className="text-sm font-bold uppercase tracking-wider">Cross-Sectional: Alpha ~ Blueprint Score</h3>
          <span className="text-[10px] px-2 py-0.5 rounded font-bold" style={{
            color: regression.r2 > 0.3 ? "var(--green)" : "var(--yellow)",
            background: `color-mix(in srgb, ${regression.r2 > 0.3 ? "var(--green)" : "var(--yellow)"} 12%, transparent)`,
          }}>
            R² = {(regression.r2 * 100).toFixed(1)}%
          </span>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
          10-year macro-adjusted annualized alpha regressed against Long Bull Blueprint quality score across {stocks.length} stocks
        </p>

        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1">
            <ScatterChart stocks={stocks} regression={regression} />
          </div>
          <div className="lg:w-64 space-y-4">
            <div>
              <h4 className="text-[10px] font-bold uppercase mb-2" style={{ color: "var(--muted)" }}>Simple Regression</h4>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span style={{ color: "var(--muted)" }}>R²</span><span className="font-mono font-bold">{(regression.r2 * 100).toFixed(1)}%</span></div>
                <div className="flex justify-between"><span style={{ color: "var(--muted)" }}>β (Score)</span><span className="font-mono">{regression.beta > 0 ? "+" : ""}{regression.beta.toFixed(2)}</span></div>
                <div className="flex justify-between"><span style={{ color: "var(--muted)" }}>t-stat</span><span className="font-mono" style={{ color: Math.abs(regression.tStat) > 1.96 ? "var(--green)" : "var(--muted)" }}>{regression.tStat.toFixed(2)}</span></div>
                <div className="flex justify-between"><span style={{ color: "var(--muted)" }}>Intercept</span><span className="font-mono">{regression.intercept.toFixed(2)}%</span></div>
              </div>
              <p className="text-[10px] mt-2" style={{ color: "var(--muted)" }}>
                Each +1 Blueprint Score → {regression.beta > 0 ? "+" : ""}{regression.beta.toFixed(1)}% annualized alpha
              </p>
            </div>

            {factorBetas.length > 0 && (
              <div>
                <h4 className="text-[10px] font-bold uppercase mb-2" style={{ color: "var(--muted)" }}>Multi-Factor Betas</h4>
                <div className="space-y-1">
                  {factorBetas.map((f) => (
                    <div key={f.name} className="flex items-center justify-between text-xs">
                      <span style={{ color: f.significant ? "var(--text)" : "var(--muted)" }}>{f.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono">{f.beta > 0 ? "+" : ""}{f.beta.toFixed(3)}</span>
                        <span className="font-mono text-[10px]" style={{ color: Math.abs(f.tStat) > 1.96 ? "var(--green)" : "var(--muted)" }}>
                          t={f.tStat.toFixed(1)}
                        </span>
                        {f.significant && <span style={{ color: "var(--green)" }}>**</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stock data table */}
      <div className="rounded-lg p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h3 className="text-sm font-bold uppercase tracking-wider mb-4">Stock-by-Stock Data</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th className="text-left py-2 pr-3 font-medium" style={{ color: "var(--muted)" }}>Stock</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>10Y α</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "#f59e0b" }}>Score</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>OpMgn</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>ROIC</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>FCFYld</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>RevGr</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: "var(--muted)" }}>GrsMgn</th>
              </tr>
            </thead>
            <tbody>
              {stocks.map((s) => {
                const alphaColor = s.alpha10y > 10 ? "var(--green)" : s.alpha10y > 0 ? "#4ade80" : s.alpha10y > -5 ? "var(--yellow)" : "var(--red)";
                const scoreColor = s.blueprintScore >= 5 ? "var(--green)" : s.blueprintScore >= 3 ? "var(--yellow)" : "var(--red)";
                return (
                  <tr key={s.symbol} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="py-2 pr-3">
                      <span className="font-bold">{s.symbol}</span>
                      <span className="ml-1 text-[10px]" style={{ color: "var(--muted)" }}>{s.name}</span>
                    </td>
                    <td className="text-right py-2 px-2 font-mono font-bold" style={{ color: alphaColor }}>
                      {s.alpha10y > 0 ? "+" : ""}{s.alpha10y.toFixed(1)}%
                    </td>
                    <td className="text-right py-2 px-2">
                      <span className="font-mono font-bold px-1.5 py-0.5 rounded" style={{ color: scoreColor, background: `color-mix(in srgb, ${scoreColor} 12%, transparent)` }}>
                        {s.blueprintScore}/6
                      </span>
                    </td>
                    <td className="text-right py-2 px-2 font-mono">{s.opMargin.toFixed(1)}%</td>
                    <td className="text-right py-2 px-2 font-mono">{s.roic.toFixed(1)}%</td>
                    <td className="text-right py-2 px-2 font-mono">{s.fcfYield.toFixed(1)}%</td>
                    <td className="text-right py-2 px-2 font-mono" style={{ color: s.revGrowth > 10 ? "var(--green)" : s.revGrowth < 0 ? "var(--red)" : "var(--muted)" }}>
                      {s.revGrowth > 0 ? "+" : ""}{s.revGrowth.toFixed(1)}%
                    </td>
                    <td className="text-right py-2 px-2 font-mono">{s.grossMargin.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-[10px] text-center" style={{ color: "var(--border)" }}>
        Cross-section computed: {data.computed_at}
      </div>
    </div>
  );
}

function ReflexivityTab({ data }: { data: PlaybookData }) {
  const bySource: Record<string, Reflexivity[]> = {};
  for (const r of data.reflexivity) {
    if (!bySource[r.source]) bySource[r.source] = [];
    bySource[r.source].push(r);
  }

  const strengthColor: Record<string, string> = {
    strong: "var(--red)",
    moderate: "var(--yellow)",
    weak: "var(--muted)",
    minimal: "var(--border)",
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h3 className="text-sm font-bold uppercase tracking-wider mb-4">Reflexivity Map</h3>
        <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
          How each asset&apos;s current state drives hedge/arb demand for others
        </p>

        <div className="space-y-5">
          {Object.entries(bySource).map(([source, impacts]) => {
            const asset = data.assets.find((a) => a.name === source);
            return (
              <div key={source}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-bold text-sm">{source}</span>
                  {asset && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--border)", color: "var(--muted)" }}>
                      {asset.activation}
                    </span>
                  )}
                </div>
                <div className="space-y-1.5 pl-4" style={{ borderLeft: `2px solid ${asset ? scoreColor(asset.combined_score) : "var(--border)"}` }}>
                  {impacts.map((imp, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="font-mono text-[10px] mt-0.5" style={{ color: strengthColor[imp.strength] || "var(--muted)" }}>
                        {imp.strength === "strong" ? "═══►" : imp.strength === "moderate" ? "──►" : "···►"}
                      </span>
                      <div>
                        <span className="font-bold">{imp.target}</span>
                        <span className="ml-1" style={{ color: "var(--muted)" }}>{imp.mechanism}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
