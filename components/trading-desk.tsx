"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";

interface Profile {
  symbol: string;
  current60d: number;
  percentile: number;
  percentile1y: number;
  percentile3y: number;
  trend: number;
  regime: string;
  regimeColor: string;
  cogGap: number;
  anchorFailure: boolean;
  pvDivergence: number | null;
  pvDivergenceSignal: string;
  phase: number;
  phaseLabel: string;
  phaseConfidence: string;
  phaseColor: string;
  phaseAction: string;
  hmmRegime?: string;
  hmmPersistence?: number;
}

const PHASE_KELLY: Record<number, number> = { 1: 0.25, 2: 0, 3: 0.25, 4: 1.0, 0: 0.5 };

function convictionMultiplier(s: Profile): number {
  if (s.anchorFailure && ["ACCUMULATION", "QUIET_BUILDUP"].includes(s.pvDivergenceSignal)) return 1.5;
  if (s.anchorFailure) return 1.4;
  if (s.cogGap >= 5 && ["ACCUMULATION", "QUIET_BUILDUP"].includes(s.pvDivergenceSignal)) return 1.4;
  if (["ACCUMULATION", "QUIET_BUILDUP"].includes(s.pvDivergenceSignal)) return 1.3;
  if (s.cogGap >= 5) return 1.2;
  if (s.pvDivergenceSignal === "DISTRIBUTION") return 0.7;
  return 1.0;
}

function kellySize(s: Profile, baseKelly = 0.20): { raw: number; modified: number; label: string } {
  const phaseMod = PHASE_KELLY[s.phase] ?? 0.5;
  const convMod = convictionMultiplier(s);
  const raw = baseKelly * phaseMod * convMod;
  const capped = Math.min(raw, baseKelly); // never exceed half-Kelly (input is already half-Kelly)
  const pct = Math.round(capped * 100);

  let label: string;
  if (pct === 0) label = "CASH";
  else if (pct <= 3) label = "TINY";
  else if (pct <= 7) label = "SMALL";
  else if (pct <= 12) label = "MODERATE";
  else if (pct <= 18) label = "FULL";
  else label = "MAX";

  return { raw: capped, modified: pct, label };
}

interface ApiResponse {
  profiles: Profile[];
  portfolio: { crossEntropy: number; correlationEntropy: number; concentrated: boolean; detail: string };
  computed_at: string;
  source?: "cache" | "live";
}

const PHASE_META: Record<number, { icon: string; name: string; color: string; bg: string; desc: string }> = {
  1: { icon: "◆", name: "COMPRESSION", color: "#63b3ed", bg: "rgba(99,179,237,0.08)", desc: "Fragile monoculture — reduce size, buy hedges" },
  2: { icon: "⚡", name: "FRACTURE", color: "#f6ad55", bg: "rgba(246,173,85,0.08)", desc: "Spring breaking — do NOT buy dips" },
  3: { icon: "◎", name: "DISORDER", color: "#fc8181", bg: "rgba(252,129,129,0.08)", desc: "No edge — wait for PV Divergence" },
  4: { icon: "▲", name: "RE-COMPRESS", color: "#68d391", bg: "rgba(104,211,145,0.08)", desc: "Best entry — new narrative forming" },
  0: { icon: "—", name: "NEUTRAL", color: "#a0aec0", bg: "rgba(160,174,192,0.05)", desc: "Mid-cycle, no strong signal" },
};

const MACRO_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA", "^GSPC", "^DJI", "^IXIC", "^RUT", "GLD", "TLT", "USO", "UUP", "HYG", "VXX", "BTC-USD", "ETH-USD"];
const SECTOR_SYMBOLS = ["XLK", "XLF", "XLV", "XLE", "XLI", "XLC", "XLY", "XLP", "XLRE", "XLB", "XLU"];
const CN_SUFFIXES = [".HK", ".SS", ".SZ"];

type TabId = "all" | "macro" | "sector" | "us" | "china" | "phase1" | "phase2" | "phase3" | "phase4";

function classifyTab(sym: string): "macro" | "sector" | "china" | "us" {
  const s = sym.toUpperCase();
  if (MACRO_SYMBOLS.includes(s) || s.startsWith("^")) return "macro";
  if (SECTOR_SYMBOLS.includes(s)) return "sector";
  if (CN_SUFFIXES.some((sfx) => s.endsWith(sfx))) return "china";
  return "us";
}

function PhaseBadge({ phase }: { phase: number }) {
  const m = PHASE_META[phase] || PHASE_META[0];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
      style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}30` }}
    >
      {m.icon} {m.name}
    </span>
  );
}

function PhaseColumn({ phase, stocks }: { phase: number; stocks: Profile[] }) {
  const m = PHASE_META[phase] || PHASE_META[0];
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${m.color}30` }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ background: m.bg }}>
        <div className="flex items-center gap-2">
          <span className="text-lg" style={{ color: m.color }}>{m.icon}</span>
          <div>
            <div className="text-sm font-bold" style={{ color: m.color }}>
              Phase {phase}: {m.name}
            </div>
            <div className="text-[10px]" style={{ color: "var(--muted)" }}>{m.desc}</div>
          </div>
        </div>
        <span className="text-2xl font-mono font-bold" style={{ color: m.color }}>
          {stocks.length}
        </span>
      </div>
      {stocks.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs" style={{ color: "var(--muted)", background: "var(--card)" }}>
          No stocks in this phase
        </div>
      ) : (
        <div style={{ background: "var(--card)" }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th className="px-3 py-2 text-left font-medium" style={{ color: "var(--muted)" }}>Symbol</th>
                <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--muted)" }}>Pctile</th>
                <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--muted)" }}>Trend</th>
                <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--muted)" }}>PV Div</th>
                <th className="px-3 py-2 text-left font-medium" style={{ color: "var(--muted)" }}>HMM</th>
                <th className="px-3 py-2 text-center font-medium" style={{ color: "var(--muted)" }}>Kelly</th>
                <th className="px-3 py-2 text-left font-medium" style={{ color: "var(--muted)" }}>Signal</th>
              </tr>
            </thead>
            <tbody>
              {stocks.map((s) => {
                let combined = "";
                if (s.phase === 1 && s.pvDivergenceSignal === "ACCUMULATION") combined = "🟢 Smart money in compressed spring";
                else if (s.phase === 1 && s.pvDivergenceSignal === "DISTRIBUTION") combined = "🔴 Smart money exiting";
                else if (s.phase === 1 && s.hmmRegime === "Bear") combined = "⚡ Bear + compressed = reversal watch";
                else if (s.phase === 1 && s.hmmRegime === "Bull") combined = "⚠ Bull + compressed = fragile mania";
                else if (s.phase === 3 && s.pvDivergenceSignal === "ACCUMULATION") combined = "🟢 March 2009 pattern";
                else if (s.phase === 4 && s.hmmRegime === "Bull") combined = "🟢 Strong entry";
                else if (s.phase === 2) combined = "🚫 Avoid — fracture";

                return (
                  <tr key={s.symbol} style={{ borderBottom: "1px solid var(--border)" }} className="hover:brightness-110">
                    <td className="px-3 py-2">
                      <Link href={`/stock/${encodeURIComponent(s.symbol)}`} className="font-mono font-bold hover:underline" style={{ color: "var(--blue)" }}>
                        {s.symbol}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right font-mono" style={{
                      color: s.percentile <= 20 ? "#ef4444" : s.percentile >= 80 ? "#10b981" : "var(--text)"
                    }}>
                      {s.percentile.toFixed(0)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono" style={{
                      color: s.trend < -0.0005 ? "#ef4444" : s.trend > 0.0005 ? "#10b981" : "var(--muted)"
                    }}>
                      {s.trend >= 0 ? "+" : ""}{(s.trend * 1000).toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.pvDivergence !== null ? (
                        <span style={{
                          color: ["ACCUMULATION", "QUIET_BUILDUP"].includes(s.pvDivergenceSignal) ? "#10b981"
                            : ["DISTRIBUTION", "CAPITULATION"].includes(s.pvDivergenceSignal) ? "#ef4444"
                            : "var(--muted)"
                        }}>
                          <span className="font-mono">{s.pvDivergence > 0 ? "+" : ""}{s.pvDivergence.toFixed(0)}</span>
                          <span className="ml-1 text-[9px]">{s.pvDivergenceSignal.slice(0, 3)}</span>
                        </span>
                      ) : <span style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span style={{
                        color: s.hmmRegime === "Bull" ? "#10b981" : s.hmmRegime === "Bear" ? "#ef4444" : "var(--muted)"
                      }}>
                        {s.hmmRegime || "—"}
                        {s.hmmPersistence ? ` ${(s.hmmPersistence * 100).toFixed(0)}%` : ""}
                      </span>
                    </td>
                    {(() => {
                      const k = kellySize(s);
                      const kellyColor = k.modified === 0 ? "#ef4444"
                        : k.modified <= 5 ? "#f97316"
                        : k.modified <= 10 ? "#f59e0b"
                        : k.modified <= 15 ? "#10b981"
                        : "#22c55e";
                      return (
                        <td className="px-3 py-2 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="font-mono font-bold text-xs" style={{ color: kellyColor }}>
                              {k.modified}%
                            </span>
                            <span className="text-[8px] font-semibold uppercase tracking-wider" style={{ color: kellyColor, opacity: 0.7 }}>
                              {k.label}
                            </span>
                          </div>
                        </td>
                      );
                    })()}
                    <td className="px-3 py-2 text-[10px]" style={{ color: "var(--muted)", maxWidth: 180 }}>
                      {combined || s.phaseAction}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function TradingDesk() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabId>("all");

  const loadData = (forceRefresh = false) => {
    setLoading(true);
    fetch(`/api/entropy${forceRefresh ? "?refresh=1" : ""}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/entropy/refresh", { method: "POST" });
      loadData();
    } catch { /* ignore */ }
    setRefreshing(false);
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.profiles;
    if (tab === "macro") list = list.filter((p) => classifyTab(p.symbol) === "macro");
    else if (tab === "sector") list = list.filter((p) => classifyTab(p.symbol) === "sector");
    else if (tab === "us") list = list.filter((p) => classifyTab(p.symbol) === "us");
    else if (tab === "china") list = list.filter((p) => classifyTab(p.symbol) === "china");
    else if (tab === "phase1") list = list.filter((p) => p.phase === 1);
    else if (tab === "phase2") list = list.filter((p) => p.phase === 2);
    else if (tab === "phase3") list = list.filter((p) => p.phase === 3);
    else if (tab === "phase4") list = list.filter((p) => p.phase === 4);
    return list;
  }, [data, tab]);

  const phaseCounts = useMemo(() => {
    if (!data) return { 1: 0, 2: 0, 3: 0, 4: 0, 0: 0 };
    const c: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const p of filtered) c[p.phase] = (c[p.phase] || 0) + 1;
    return c;
  }, [data, filtered]);

  const byPhase = useMemo(() => {
    const groups: Record<number, Profile[]> = { 1: [], 2: [], 3: [], 4: [], 0: [] };
    for (const p of filtered) {
      (groups[p.phase] ??= []).push(p);
    }
    for (const k of Object.keys(groups)) {
      groups[Number(k)].sort((a, b) => a.percentile - b.percentile);
    }
    return groups;
  }, [filtered]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="inline-block w-8 h-8 rounded-full border-2 border-t-transparent animate-spin mb-3"
            style={{ borderColor: "var(--blue)", borderTopColor: "transparent" }} />
          <p className="text-sm" style={{ color: "var(--muted)" }}>Computing entropy phases for all watchlist stocks...</p>
        </div>
      </div>
    );
  }

  if (!data) return <div className="text-center py-10 text-sm" style={{ color: "#ef4444" }}>Failed to load data</div>;

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "all", label: "All", count: data.profiles.length },
    { id: "macro", label: "Macro", count: data.profiles.filter((p) => classifyTab(p.symbol) === "macro").length },
    { id: "sector", label: "Sectors", count: data.profiles.filter((p) => classifyTab(p.symbol) === "sector").length },
    { id: "us", label: "US Stocks", count: data.profiles.filter((p) => classifyTab(p.symbol) === "us").length },
    { id: "china", label: "China/HK", count: data.profiles.filter((p) => classifyTab(p.symbol) === "china").length },
    { id: "phase1", label: "Phase 1", count: data.profiles.filter((p) => p.phase === 1).length },
    { id: "phase2", label: "Phase 2", count: data.profiles.filter((p) => p.phase === 2).length },
    { id: "phase3", label: "Phase 3", count: data.profiles.filter((p) => p.phase === 3).length },
    { id: "phase4", label: "Phase 4", count: data.profiles.filter((p) => p.phase === 4).length },
  ];

  return (
    <div className="space-y-6">
      {/* Phase summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[1, 2, 3, 4, 0].map((phase) => {
          const m = PHASE_META[phase];
          return (
            <button
              key={phase}
              onClick={() => setTab(phase === 0 ? "all" : `phase${phase}` as TabId)}
              className="rounded-lg p-4 text-left transition-all hover:brightness-125"
              style={{
                background: m.bg,
                border: `1px solid ${m.color}${tab === `phase${phase}` ? "60" : "20"}`,
                opacity: tab === `phase${phase}` ? 1 : 0.8,
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-lg">{m.icon}</span>
                <span className="text-2xl font-mono font-bold" style={{ color: m.color }}>
                  {phaseCounts[phase]}
                </span>
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: m.color }}>
                {phase === 0 ? "Neutral" : `Phase ${phase}`}
              </div>
              <div className="text-[9px] mt-0.5" style={{ color: "var(--muted)" }}>{m.name}</div>
            </button>
          );
        })}
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1" style={{ borderBottom: "1px solid var(--border)" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-3 py-2 text-xs font-medium transition-colors rounded-t"
            style={{
              color: tab === t.id ? "var(--text)" : "var(--muted)",
              background: tab === t.id ? "var(--card)" : "transparent",
              borderBottom: tab === t.id ? "2px solid var(--blue)" : "2px solid transparent",
            }}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="ml-1 opacity-60">({t.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Kelly sizing legend */}
      <div className="rounded-lg p-4" style={{ background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.15)" }}>
        <div className="flex items-start gap-3">
          <span className="text-sm font-bold mt-0.5" style={{ color: "var(--blue)" }}>f*</span>
          <div>
            <p className="text-xs leading-relaxed mb-1.5">
              <strong>Kelly × Entropy Position Sizing</strong> — base ½-Kelly (20%) modified by phase + conviction.
              Phase determines edge reliability. PV Divergence + Anchor Failure modify conviction.
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px]" style={{ color: "var(--muted)" }}>
              <span>Phase 1: <strong style={{ color: "#63b3ed" }}>¼ Kelly</strong> (edge unreliable)</span>
              <span>Phase 2: <strong style={{ color: "#f6ad55" }}>0 Kelly</strong> (cash — no edge)</span>
              <span>Phase 3: <strong style={{ color: "#fc8181" }}>¼ Kelly</strong> (no direction)</span>
              <span>Phase 4: <strong style={{ color: "#68d391" }}>Full Kelly</strong> (max reliability)</span>
              <span>Accumulation: <strong style={{ color: "#10b981" }}>+30%</strong></span>
              <span>Distribution: <strong style={{ color: "#ef4444" }}>-30%</strong></span>
              <span>Anchor Failure: <strong style={{ color: "#f97316" }}>+40%</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Phase columns */}
      {tab.startsWith("phase") ? (
        <PhaseColumn phase={Number(tab.replace("phase", ""))} stocks={filtered} />
      ) : (
        <div className="space-y-4">
          {[1, 2, 4, 3, 0].map((phase) => {
            const stocks = byPhase[phase] || [];
            if (stocks.length === 0) return null;
            return <PhaseColumn key={phase} phase={phase} stocks={stocks} />;
          })}
        </div>
      )}

      {/* Timestamp + source + refresh */}
      <div className="flex items-center justify-between text-[10px]" style={{ color: "var(--muted)" }}>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold uppercase"
            style={{
              background: data.source === "cache" ? "rgba(16,185,129,0.1)" : "rgba(246,173,85,0.1)",
              color: data.source === "cache" ? "#10b981" : "#f6ad55",
            }}
          >
            {data.source === "cache" ? "● Cached" : "● Live"}
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-2 py-0.5 rounded text-[9px] font-medium transition-colors hover:brightness-125 disabled:opacity-50"
            style={{ background: "rgba(59,130,246,0.15)", color: "var(--blue)" }}
          >
            {refreshing ? "Refreshing..." : "Refresh Now"}
          </button>
        </div>
        <span>Computed: {new Date(data.computed_at).toLocaleString()}</span>
      </div>
    </div>
  );
}
