"use client";

import { useEffect, useState } from "react";

interface HmmEntropyData {
  symbol: string;
  price: number;
  ath: number;
  athDistancePct: number;
  pe: number | null;
  hmm: { regime: string; persistence: number };
  entropy: {
    h60: number;
    h120: number;
    h252: number;
    percentile: number;
    percentile1y: number;
    percentile3y: number;
    trend: number;
    regime: string;
    cogGap: number;
    cogGapLabel: string;
    anchorFailure: boolean;
    anchorDetail: string;
  };
  transferEntropy: {
    toBenchmark: number;
    fromBenchmark: number;
    net: number;
    direction: string;
  };
  halfLife: { full: number | null; recent120d: number | null; regime: string };
  trendwise: { position: number; retracement: number; open: boolean };
  conviction: { level: string; multiplier: number };
  entryAssessment: string;
  crossReference: string;
  lookbackInterpretation: string;
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: `${color}15`, color }}
    >
      {text}
    </span>
  );
}

function colorForConviction(level: string): string {
  if (level === "CROWDED") return "#ef4444";
  if (level === "MAXIMUM") return "#dc2626";
  if (level === "HIGH") return "#f59e0b";
  if (level === "ELEVATED") return "#7c3aed";
  if (level === "NORMAL") return "#3b82f6";
  return "#94a3b8";
}

export function StockHmmEntropyCard({ symbol }: { symbol: string }) {
  const [data, setData] = useState<HmmEntropyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`/api/hmm-entropy/${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active) return;
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [symbol]);

  if (loading) {
    return (
      <div className="rounded-lg p-5 mb-8" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h2 className="text-lg font-bold mb-3">HMM × Entropy</h2>
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
          <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#7c3aed", borderTopColor: "transparent" }} />
          Computing regime + entropy synthesis...
        </div>
      </div>
    );
  }
  if (!data) return null;

  const convictionColor = colorForConviction(data.conviction.level);
  const hmmColor =
    data.hmm.regime.toLowerCase().includes("bull")
      ? "#16a34a"
      : data.hmm.regime.toLowerCase().includes("bear")
        ? "#dc2626"
        : "#b45309";
  const entropyColor =
    data.entropy.regime === "compressed"
      ? "#7c3aed"
      : data.entropy.regime === "diverse"
        ? "#3b82f6"
        : "#94a3b8";

  return (
    <div className="rounded-lg p-5 mb-8" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-bold">HMM × Entropy</h2>
          <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Regime filter + informational compression + tiered entry
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Pill text={`${data.hmm.regime} ${(data.hmm.persistence * 100).toFixed(0)}%`} color={hmmColor} />
          <Pill text={`${data.entropy.regime}`} color={entropyColor} />
          <Pill text={`${data.conviction.level} ${data.conviction.multiplier.toFixed(1)}x`} color={convictionColor} />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 mb-4">
        <div><div className="text-[10px] uppercase tracking-wider text-zinc-500">H(60d)</div><div className="font-mono text-lg">{data.entropy.h60.toFixed(3)}</div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-zinc-500">Pctile (1Y / 3Y)</div><div className="font-mono text-lg">{data.entropy.percentile1y.toFixed(0)}% / {data.entropy.percentile3y.toFixed(0)}%</div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-zinc-500">Cog Gap</div><div className="font-mono text-lg">{data.entropy.cogGap}/10</div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-zinc-500">TrendWise</div><div className="font-mono text-lg">{data.trendwise.open ? "Open 🟢" : "Closed ⬜"}</div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-zinc-500">Transfer Entropy</div><div className="font-mono text-sm">{data.transferEntropy.direction}</div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-zinc-500">Half-Life</div><div className="font-mono text-sm">{data.halfLife.recent120d ? `${data.halfLife.recent120d.toFixed(0)}d` : "N/A"} · {data.halfLife.regime}</div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
          <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--blue)" }}>
            Conviction Flow
          </div>
          <div className="space-y-2 text-sm">
            <div><strong>Step 1:</strong> Entropy regime is <strong>{data.entropy.regime}</strong> ({data.entropy.percentile.toFixed(0)}th percentile full history)</div>
            <div><strong>Step 2:</strong> Anchor failure = <strong>{data.entropy.anchorFailure ? "YES" : "NO"}</strong>{data.entropy.anchorFailure && data.entropy.anchorDetail ? ` — ${data.entropy.anchorDetail}` : ""}</div>
            <div><strong>Step 3:</strong> Cognitive gap = <strong>{data.entropy.cogGap}/10</strong> ({data.entropy.cogGapLabel})</div>
            <div><strong>1Y vs 3Y:</strong> {data.lookbackInterpretation}</div>
            <div className="pt-2"><strong>Result:</strong> <span style={{ color: convictionColor }}>{data.conviction.level}</span> conviction ({data.conviction.multiplier.toFixed(1)}x)</div>
          </div>
        </div>

        <div className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
          <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#7c3aed" }}>
            Entry Assessment
          </div>
          <div className="space-y-2 text-sm">
            <div><strong>Cross-reference:</strong> {data.crossReference}</div>
            <div><strong>Entry:</strong> {data.entryAssessment}</div>
            <div><strong>ATH distance:</strong> {data.athDistancePct.toFixed(1)}%</div>
            <div><strong>PE:</strong> {data.pe != null ? `${data.pe.toFixed(1)}x` : "N/A"}</div>
            <div><strong>TrendWise window:</strong> Position {data.trendwise.position.toFixed(1)}% vs Retracement {data.trendwise.retracement.toFixed(1)}%</div>
          </div>
        </div>
      </div>
    </div>
  );
}
