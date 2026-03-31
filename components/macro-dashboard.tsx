"use client";

import { useState, useEffect, useCallback } from "react";

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

export function MacroDashboard() {
  const [data, setData] = useState<PlaybookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "sectors" | "verify" | "reflexivity">("overview");

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

  useEffect(() => { fetchData(); }, [fetchData]);

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
    { key: "verify" as const, label: "Performance" },
    { key: "reflexivity" as const, label: "Reflexivity" },
  ];

  return (
    <div>
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
