"use client";

import { useState, useCallback } from "react";
import type { StockMacroResult, FactorResult } from "@/lib/stock-macro";

function round(v: number, d = 1) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function SignalBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold"
      style={{ background: `${color}20`, color }}
    >
      {label}
    </span>
  );
}

function signalColor(signal: string): string {
  const s = signal.toUpperCase();
  if (s.includes("STRONG BUY") || s.includes("CHEAP") || s.includes("ACCUMULATE")) return "var(--green)";
  if (s.includes("HOLD") || s.includes("FAIR") || s.includes("TRANSITION") || s.includes("WARMING")) return "var(--yellow)";
  if (s.includes("TRIM") || s.includes("RICH") || s.includes("EXTREME") || s.includes("HOT")) return "var(--red)";
  if (s.includes("BOOM") || s.includes("EXPANSION")) return "var(--green)";
  if (s.includes("LATE") || s.includes("COOLING")) return "var(--red)";
  if (s.includes("BELOW") || s.includes("DORMANT")) return "var(--green)";
  if (s.includes("ABOVE")) return "var(--yellow)";
  return "var(--muted)";
}

function MetricBox({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="text-lg font-mono font-bold mt-0.5">{value}</div>
      {sub && <div className="text-[10px] font-mono" style={{ color: "var(--muted)" }}>{sub}</div>}
    </div>
  );
}

function R2Bar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(Math.max(value * 100, 0), 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] w-16 shrink-0 text-right" style={{ color: "var(--muted)" }}>{label}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] font-mono w-10 text-right">{(value * 100).toFixed(1)}%</span>
    </div>
  );
}

function FactorRow({ f }: { f: FactorResult }) {
  const catColors: Record<string, string> = {
    hedge: "#f59e0b",
    arb: "#3b82f6",
    structural: "#8b5cf6",
  };
  return (
    <tr className="border-t" style={{ borderColor: "var(--border)" }}>
      <td className="px-3 py-1.5 text-xs font-mono font-semibold">{f.name}</td>
      <td className="px-3 py-1.5">
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: `${catColors[f.category] ?? "var(--muted)"}20`, color: catColors[f.category] ?? "var(--muted)" }}
        >
          {f.category}
        </span>
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-xs">
        <span style={{ color: f.beta > 0 ? "var(--green)" : f.beta < 0 ? "var(--red)" : "var(--muted)" }}>
          {f.beta > 0 ? "+" : ""}{f.beta.toFixed(4)}
        </span>
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-xs">
        <span style={{ fontWeight: f.significant ? 700 : 400, color: f.significant ? "var(--foreground)" : "var(--muted)" }}>
          {f.tStat.toFixed(2)}{f.significant ? " *" : ""}
        </span>
      </td>
      <td className="px-3 py-1.5 text-xs" style={{ color: "var(--muted)" }}>{f.desc}</td>
    </tr>
  );
}

function Layer1Section({ l1 }: { l1: StockMacroResult["layer1"] }) {
  return (
    <div className="rounded-lg p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--blue)" }}>
          Layer 1 — Hedge Floor / Arb Fair Value
        </h3>
        <SignalBadge label={l1.netSignal} color={signalColor(l1.netSignal)} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <MetricBox label="M2 Floor" value={`$${l1.m2Floor.toLocaleString()}`} sub={`${l1.m2Premium > 0 ? "+" : ""}${l1.m2Premium}% above`} />
        <MetricBox label="Arb Fair" value={`$${l1.arbFairValue.toLocaleString()}`} sub={`${l1.arbPremium > 0 ? "+" : ""}${l1.arbPremium}% vs SPY`} />
        <MetricBox label="Combined Fair" value={`$${l1.combinedFair.toLocaleString()}`} sub={`${l1.vsFair > 0 ? "+" : ""}${l1.vsFair}% vs fair`} />
        <MetricBox label="Current" value={`$${l1.price.toLocaleString()}`} />
      </div>

      <div className="flex items-center gap-3">
        <SignalBadge label={`Hedge: ${l1.activation}`} color={signalColor(l1.activation)} />
        <SignalBadge label={`Arb: ${l1.arbSignal}`} color={signalColor(l1.arbSignal)} />
      </div>
    </div>
  );
}

function Layer2Section({ l2 }: { l2: StockMacroResult["layer2"] }) {
  if (!l2) return (
    <div className="rounded-lg p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--blue)" }}>
        Layer 2 — Factor Regression
      </h3>
      <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>Insufficient data for regression (need 50+ weekly observations).</p>
    </div>
  );

  return (
    <div className="rounded-lg p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--blue)" }}>
          Layer 2 — Factor Regression (APT-Style V2)
        </h3>
        <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(139,92,246,0.15)", color: "#8b5cf6" }}>
          {l2.nObs} obs · orthogonalized
        </span>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-4 mb-4">
        <MetricBox label="Alpha (wk)" value={`${l2.alpha > 0 ? "+" : ""}${l2.alpha}%`} />
        <MetricBox label="R²" value={`${(l2.r2 * 100).toFixed(1)}%`} />
        {l2.r2Oos != null && <MetricBox label="OOS R²" value={`${(l2.r2Oos * 100).toFixed(1)}%`} />}
        <MetricBox label="Hedge" value={`${(l2.hedgeR2 * 100).toFixed(1)}%`} />
        <MetricBox label="Arb" value={`${(l2.arbR2 * 100).toFixed(1)}%`} />
      </div>

      <div className="space-y-1 mb-4">
        <R2Bar label="Hedge" value={l2.hedgeR2} color="#f59e0b" />
        <R2Bar label="Arb" value={l2.arbR2} color="#3b82f6" />
        <R2Bar label="Structural" value={l2.structuralR2} color="#8b5cf6" />
        <R2Bar label="Unexplained" value={1 - l2.r2} color="var(--muted)" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="px-3 py-1.5 text-left text-[10px] font-semibold" style={{ color: "var(--muted)" }}>Factor</th>
              <th className="px-3 py-1.5 text-left text-[10px] font-semibold" style={{ color: "var(--muted)" }}>Category</th>
              <th className="px-3 py-1.5 text-right text-[10px] font-semibold" style={{ color: "var(--muted)" }}>Beta</th>
              <th className="px-3 py-1.5 text-right text-[10px] font-semibold" style={{ color: "var(--muted)" }}>t-Stat</th>
              <th className="px-3 py-1.5 text-left text-[10px] font-semibold" style={{ color: "var(--muted)" }}>Description</th>
            </tr>
          </thead>
          <tbody>
            {l2.factors.map(f => <FactorRow key={f.name} f={f} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Layer3Section({ l3 }: { l3: StockMacroResult["layer3"] }) {
  if (!l3) return (
    <div className="rounded-lg p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--blue)" }}>
        Layer 3 — Sector Context
      </h3>
      <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>Sector mapping unavailable for this stock.</p>
    </div>
  );

  return (
    <div className="rounded-lg p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--blue)" }}>
          Layer 3 — Sector Context
        </h3>
        <div className="flex items-center gap-2">
          <SignalBadge label={l3.regime} color={signalColor(l3.regime)} />
          <span className="text-[10px] font-mono" style={{ color: "var(--muted)" }}>
            Def-Cyc: {l3.defCycSpread > 0 ? "+" : ""}{l3.defCycSpread}pp
          </span>
        </div>
      </div>

      <div className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
        Stock sector: <strong style={{ color: "var(--foreground)" }}>{l3.stockSector}</strong> ({l3.stockSectorEtf}) — {l3.stockBetaType}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left text-[10px] font-semibold" style={{ color: "var(--muted)" }}>Sector</th>
              <th className="px-2 py-1 text-left text-[10px] font-semibold" style={{ color: "var(--muted)" }}>Type</th>
              <th className="px-2 py-1 text-right text-[10px] font-semibold" style={{ color: "var(--muted)" }}>3M Ret</th>
              <th className="px-2 py-1 text-right text-[10px] font-semibold" style={{ color: "var(--muted)" }}>6M Ret</th>
              <th className="px-2 py-1 text-right text-[10px] font-semibold" style={{ color: "var(--muted)" }}>3M Alpha</th>
            </tr>
          </thead>
          <tbody>
            {l3.sectors.map(s => (
              <tr
                key={s.etf}
                className="border-t"
                style={{
                  borderColor: "var(--border)",
                  background: s.isStock ? "rgba(59,130,246,0.06)" : undefined,
                }}
              >
                <td className="px-2 py-1.5 text-xs">
                  {s.isStock && <span style={{ color: "var(--blue)" }}>● </span>}
                  {s.name} <span className="font-mono" style={{ color: "var(--muted)" }}>({s.etf})</span>
                </td>
                <td className="px-2 py-1.5 text-[10px]" style={{ color: s.betaType === "defensive" ? "var(--yellow)" : "var(--blue)" }}>
                  {s.betaType}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-xs" style={{ color: s.ret3m >= 0 ? "var(--green)" : "var(--red)" }}>
                  {s.ret3m >= 0 ? "+" : ""}{s.ret3m}%
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-xs" style={{ color: s.ret6m >= 0 ? "var(--green)" : "var(--red)" }}>
                  {s.ret6m >= 0 ? "+" : ""}{s.ret6m}%
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-xs" style={{ color: s.alpha3m >= 0 ? "var(--green)" : "var(--red)" }}>
                  {s.alpha3m >= 0 ? "+" : ""}{s.alpha3m}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Layer4Section({ l4 }: { l4: StockMacroResult["layer4"] }) {
  const scoreColor = l4.blueprintScore >= 5 ? "var(--green)"
    : l4.blueprintScore >= 3 ? "var(--yellow)" : "var(--red)";

  return (
    <div className="rounded-lg p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--blue)" }}>
          Layer 4 — Long Bull Blueprint
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold font-mono" style={{ color: scoreColor }}>
            {l4.blueprintScore}/6
          </span>
          {l4.alpha10y != null && (
            <span className="text-xs font-mono" style={{ color: l4.alpha10y > 0 ? "var(--green)" : "var(--red)" }}>
              10Y α: {l4.alpha10y > 0 ? "+" : ""}{l4.alpha10y.toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4 mb-4">
        <MetricBox label="Op Margin" value={`${l4.opMargin}%`} />
        <MetricBox label="Gross Margin" value={`${l4.grossMargin}%`} />
        <MetricBox label="ROIC/ROE" value={`${l4.roic}%`} />
        <MetricBox label="FCF/Rev" value={`${l4.fcfYield}%`} />
        <MetricBox label="Rev Growth" value={`${l4.revGrowth}%`} />
      </div>

      {l4.details.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {l4.details.map((d, i) => (
            <span
              key={i}
              className="text-[10px] px-2 py-0.5 rounded-full"
              style={{ background: "rgba(34,197,94,0.1)", color: "var(--green)" }}
            >
              {d}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function VerdictSection({ data }: { data: StockMacroResult }) {
  const { layer1: l1, layer2: l2, layer4: l4 } = data;
  const signals: string[] = [];

  // Layer 1 signal
  if (l1.vsFair < -15) signals.push("below fair value");
  else if (l1.vsFair > 20) signals.push("above fair value");

  // Layer 2: positive alpha
  if (l2 && l2.alpha > 0.1) signals.push("positive weekly alpha");
  if (l2 && l2.r2 < 0.3) signals.push("low macro sensitivity");
  else if (l2 && l2.r2 > 0.7) signals.push("high macro dependency");

  // Layer 4: quality
  if (l4.blueprintScore >= 5) signals.push("elite quality");
  else if (l4.blueprintScore >= 3) signals.push("solid quality");
  else signals.push("weak fundamentals");

  if (l4.alpha10y != null && l4.alpha10y > 5) signals.push("strong 10Y alpha");

  let verdict: string;
  let verdictColor: string;
  const bullCount = [
    l1.vsFair < 0,
    l2 && l2.alpha > 0,
    l4.blueprintScore >= 4,
    l4.alpha10y != null && l4.alpha10y > 0,
  ].filter(Boolean).length;

  if (bullCount >= 3) { verdict = "FAVORABLE"; verdictColor = "var(--green)"; }
  else if (bullCount >= 2) { verdict = "NEUTRAL"; verdictColor = "var(--yellow)"; }
  else { verdict = "CAUTIOUS"; verdictColor = "var(--red)"; }

  return (
    <div
      className="rounded-lg p-5"
      style={{ background: `${verdictColor}08`, border: `1px solid ${verdictColor}40` }}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: verdictColor }}>
          4-Layer Verdict
        </h3>
        <span className="text-xl font-bold" style={{ color: verdictColor }}>{verdict}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {signals.map((s, i) => (
          <span
            key={i}
            className="text-[10px] px-2 py-0.5 rounded-full"
            style={{ background: "rgba(255,255,255,0.06)", color: "var(--foreground)" }}
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

export function StockMacroCard({ symbol }: { symbol: string }) {
  const [data, setData] = useState<StockMacroResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/stock-macro/${encodeURIComponent(symbol)}`);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      setData(await resp.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  if (!data && !loading && !error) {
    return (
      <div className="rounded-lg p-6 mb-8" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Macro Playbook</h2>
            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              4-layer analysis: Hedge Floor, Factor Regression, Sector Context, Blueprint Score
            </p>
          </div>
          <button
            onClick={run}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ background: "var(--blue)", color: "#000" }}
          >
            Run Analysis
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-lg p-8 mb-8 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="inline-block w-5 h-5 border-2 border-t-transparent rounded-full animate-spin mb-2" style={{ borderColor: "var(--blue)", borderTopColor: "transparent" }} />
        <p className="text-sm" style={{ color: "var(--muted)" }}>Running 4-layer macro analysis...</p>
        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>Fetching price history, macro factors, sector data, and fundamentals</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg p-5 mb-8" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.3)" }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Macro Playbook</h2>
            <p className="text-sm mt-1" style={{ color: "var(--red)" }}>{error}</p>
          </div>
          <button
            onClick={run}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: "var(--border)", color: "var(--foreground)" }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Macro Playbook</h2>
        <div className="flex items-center gap-3">
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>
            {new Date(data.computed_at).toLocaleString()}
          </span>
          <button
            onClick={run}
            className="px-3 py-1 rounded text-[10px] font-semibold"
            style={{ background: "var(--border)", color: "var(--foreground)" }}
          >
            Refresh
          </button>
        </div>
      </div>
      <div className="space-y-4">
        <VerdictSection data={data} />
        <Layer1Section l1={data.layer1} />
        <Layer2Section l2={data.layer2} />
        <Layer3Section l3={data.layer3} />
        <Layer4Section l4={data.layer4} />
      </div>
    </div>
  );
}
