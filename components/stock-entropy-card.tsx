"use client";

import { useState, useEffect } from "react";

interface EntropyData {
  symbol: string;
  current60d: number;
  current120d: number;
  current252d: number;
  volumeEntropy60d: number;
  percentile: number;
  trend: number;
  regime: "compressed" | "normal" | "diverse";
  regimeColor: string;
  anchorFailure: boolean;
  anchorDetail: string;
  history: { date: string; entropy: number }[];
  cogGap: number;
  cogGapLabel: string;
}

function EntropyChart({ history }: { history: { date: string; entropy: number }[] }) {
  if (history.length < 2) return null;

  const W = 600;
  const H = 120;
  const PAD = { top: 10, right: 10, bottom: 20, left: 40 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;

  const values = history.map((h) => h.entropy);
  const min = Math.min(...values) * 0.95;
  const max = Math.max(...values) * 1.05;
  const range = max - min || 0.01;

  const points = values.map((v, i) => {
    const x = PAD.left + (i / (values.length - 1)) * cw;
    const y = PAD.top + ch - ((v - min) / range) * ch;
    return { x, y };
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaD = `${pathD} L ${points[points.length - 1].x} ${PAD.top + ch} L ${points[0].x} ${PAD.top + ch} Z`;

  const latest = values[values.length - 1];
  const color = latest <= 0.5 ? "#ef4444" : latest <= 0.7 ? "#f59e0b" : "#10b981";

  const yTicks = [min, min + range * 0.5, max];
  const xLabels: { i: number; label: string }[] = [];
  const step = Math.max(1, Math.floor(history.length / 5));
  for (let i = 0; i < history.length; i += step) {
    const d = new Date(history[i].date);
    xLabels.push({ i, label: `${d.getMonth() + 1}/${d.getFullYear().toString().slice(2)}` });
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 120 }}>
      <defs>
        <linearGradient id="entropyGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Threshold lines */}
      {[0.5, 0.7].map((threshold) => {
        if (threshold < min || threshold > max) return null;
        const y = PAD.top + ch - ((threshold - min) / range) * ch;
        return (
          <line
            key={threshold}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y}
            y2={y}
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="4,4"
          />
        );
      })}
      {/* Y axis labels */}
      {yTicks.map((v) => {
        const y = PAD.top + ch - ((v - min) / range) * ch;
        return (
          <text key={v} x={PAD.left - 4} y={y + 3} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="9">
            {v.toFixed(2)}
          </text>
        );
      })}
      {/* X axis labels */}
      {xLabels.map(({ i, label }) => {
        const x = PAD.left + (i / (values.length - 1)) * cw;
        return (
          <text key={i} x={x} y={H - 2} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9">
            {label}
          </text>
        );
      })}
      <path d={areaD} fill="url(#entropyGrad)" />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      {/* Latest point */}
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill={color} />
    </svg>
  );
}

function CogGapBar({ score, label }: { score: number; label: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <div className="flex gap-0.5">
          {Array.from({ length: 10 }, (_, i) => {
            const active = i < score;
            let color = "#10b981";
            if (i >= 7) color = "#ef4444";
            else if (i >= 5) color = "#f97316";
            else if (i >= 3) color = "#f59e0b";
            return (
              <div
                key={i}
                className="rounded-sm"
                style={{
                  width: 8,
                  height: 18,
                  background: active ? color : "rgba(255,255,255,0.06)",
                  opacity: active ? 1 : 0.3,
                }}
              />
            );
          })}
        </div>
        <span className="text-sm font-mono font-bold">{score}/10</span>
      </div>
      <div className="text-xs" style={{ color: "var(--muted)" }}>
        {label}
      </div>
    </div>
  );
}

export function StockEntropyCard({ symbol }: { symbol: string }) {
  const [data, setData] = useState<EntropyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/entropy/${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [symbol]);

  if (loading) {
    return (
      <div className="rounded-lg p-5 mb-8" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h2 className="text-lg font-bold mb-3">Shannon Entropy</h2>
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
          <div
            className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "var(--blue)", borderTopColor: "transparent" }}
          />
          Computing entropy profile...
        </div>
      </div>
    );
  }

  if (!data) return null;

  const regimeIcon = data.regime === "compressed" ? "⚠" : data.regime === "diverse" ? "✓" : "—";

  return (
    <>
      <h2 className="text-lg font-bold mb-3">Shannon Entropy</h2>
      <div
        className="rounded-lg p-5 mb-8"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        {/* Top row: regime + key metrics */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <span
              className="text-2xl font-bold font-mono"
              style={{ color: data.regimeColor }}
            >
              H {data.current60d.toFixed(3)}
            </span>
            <span
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold uppercase"
              style={{ background: `${data.regimeColor}15`, color: data.regimeColor }}
            >
              {regimeIcon} {data.regime}
            </span>
          </div>
          <div className="flex items-center gap-6 text-right">
            <div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Percentile
              </div>
              <div
                className="text-lg font-mono font-bold"
                style={{ color: data.percentile <= 20 ? "#ef4444" : data.percentile >= 80 ? "#10b981" : "var(--text)" }}
              >
                {data.percentile.toFixed(0)}%
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Trend
              </div>
              <div
                className="text-lg font-mono font-bold"
                style={{ color: data.trend < -0.0005 ? "#ef4444" : data.trend > 0.0005 ? "#10b981" : "var(--muted)" }}
              >
                {data.trend >= 0 ? "+" : ""}{(data.trend * 1000).toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        {/* Entropy breakdown bars */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-xs w-14 shrink-0 text-right" style={{ color: "var(--muted)" }}>60d</span>
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${data.current60d * 100}%`,
                  background: data.current60d <= 0.5 ? "#ef4444" : data.current60d <= 0.7 ? "#f59e0b" : "#10b981",
                }}
              />
            </div>
            <span className="text-xs font-mono w-10 text-right">{data.current60d.toFixed(3)}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs w-14 shrink-0 text-right" style={{ color: "var(--muted)" }}>120d</span>
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div className="h-full rounded-full" style={{ width: `${data.current120d * 100}%`, background: "#3b82f6" }} />
            </div>
            <span className="text-xs font-mono w-10 text-right">{data.current120d.toFixed(3)}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs w-14 shrink-0 text-right" style={{ color: "var(--muted)" }}>252d</span>
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div className="h-full rounded-full" style={{ width: `${data.current252d * 100}%`, background: "#8b5cf6" }} />
            </div>
            <span className="text-xs font-mono w-10 text-right">{data.current252d.toFixed(3)}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs w-14 shrink-0 text-right" style={{ color: "var(--muted)" }}>Vol H</span>
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${data.volumeEntropy60d * 100}%`,
                  background: data.volumeEntropy60d < 0.5 ? "#ef4444" : "#10b981",
                }}
              />
            </div>
            <span className="text-xs font-mono w-10 text-right">{data.volumeEntropy60d.toFixed(3)}</span>
          </div>
        </div>

        {/* Chart */}
        {data.history.length > 10 && (
          <div className="mb-4">
            <EntropyChart history={data.history} />
          </div>
        )}

        {/* Cognitive Gap + Anchor */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--blue)" }}>
              Cognitive Computation Gap
            </div>
            <CogGapBar score={data.cogGap} label={data.cogGapLabel} />
            <p className="text-[10px] mt-1" style={{ color: "var(--muted)" }}>
              How many &quot;bits&quot; of reality the market is leaving unprocessed
            </p>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--blue)" }}>
              Valuation Anchor Check
            </div>
            {data.anchorFailure ? (
              <div
                className="rounded-lg p-3"
                style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.3)" }}
              >
                <div className="text-sm font-semibold" style={{ color: "#f97316" }}>
                  Anchor Failure Detected
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                  {data.anchorDetail}
                </div>
              </div>
            ) : (
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                {data.anchorDetail}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
