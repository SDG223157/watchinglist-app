"use client";

import { useState, useEffect, useCallback } from "react";

interface TdaResult {
  preset: string;
  label: string;
  assets: string[];
  descriptions: string[];
  observations: number;
  cloudShape: [number, number];
  beta0: number;
  beta1: number;
  l2Norm: number;
  l2Trend: { trend: string; slope: number; current: number };
  correlation: {
    meanCorrRecent: number;
    meanCorrBaseline: number;
    maxCorrRecent: number;
    collapse: boolean;
    corrDelta: number;
  };
  crisis: { probability: number; zone: string };
  rollingL2: { idx: number; l2: number }[];
  h0MaxLifetime: number;
  h1MaxLifetime: number;
  mismatch: boolean;
  mismatchReasons: string[];
  computedAt: string;
  source?: string;
}

const PRESETS = [
  { key: "broad-market", label: "Broad Market", icon: "📊" },
  { key: "oil-crisis", label: "Oil / Geopolitical", icon: "🛢️" },
  { key: "tech-bubble", label: "Tech / AI Bubble", icon: "💻" },
  { key: "china", label: "China / HK", icon: "🇨🇳" },
];

const ZONE_COLORS: Record<string, string> = {
  NORMAL: "#22c55e",
  ELEVATED: "#eab308",
  WARNING: "#f97316",
  CRISIS: "#ef4444",
};

const TREND_ICONS: Record<string, string> = {
  RISING_FAST: "↑↑",
  RISING: "↑",
  STABLE: "→",
  FALLING: "↓",
  FALLING_FAST: "↓↓",
  INSUFFICIENT_DATA: "?",
};

function ZoneGauge({ probability, zone }: { probability: number; zone: string }) {
  const pct = Math.min(probability * 100, 100);
  const color = ZONE_COLORS[zone] || "#a1a1aa";
  const radius = 70;
  const stroke = 10;
  const circumference = Math.PI * radius;
  const offset = circumference * (1 - pct / 100);

  return (
    <div className="flex flex-col items-center">
      <svg width="160" height="90" viewBox="0 0 160 90">
        <path
          d={`M ${80 - radius} 85 A ${radius} ${radius} 0 0 1 ${80 + radius} 85`}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M ${80 - radius} 85 A ${radius} ${radius} 0 0 1 ${80 + radius} 85`}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s ease-out" }}
        />
        <text x="80" y="70" textAnchor="middle" fill={color} fontSize="28" fontWeight="700" fontFamily="JetBrains Mono, monospace">
          {(pct).toFixed(1)}%
        </text>
        <text x="80" y="88" textAnchor="middle" fill="var(--muted)" fontSize="11">
          Crisis Probability
        </text>
      </svg>
      <span
        className="text-xs font-semibold px-3 py-1 rounded-full mt-1"
        style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
      >
        {zone}
      </span>
    </div>
  );
}

function L2Chart({ data }: { data: { idx: number; l2: number }[] }) {
  if (data.length < 2) return <div className="text-xs" style={{ color: "var(--muted)" }}>Insufficient data for trend chart</div>;

  const w = 500;
  const h = 120;
  const pad = { t: 10, b: 25, l: 45, r: 10 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;

  const vals = data.map((d) => d.l2);
  const maxV = Math.max(...vals, 0.50);
  const minV = Math.min(...vals, 0);

  const points = data.map((d, i) => {
    const x = pad.l + (i / (data.length - 1)) * iw;
    const y = pad.t + ih - ((d.l2 - minV) / (maxV - minV || 1)) * ih;
    return `${x},${y}`;
  });

  const thresholds = [
    { val: 0.35, label: "Warning", color: "#f9731640" },
    { val: 0.45, label: "Crisis", color: "#ef444440" },
  ];

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="block">
      {thresholds.map((t) => {
        const y = pad.t + ih - ((t.val - minV) / (maxV - minV || 1)) * ih;
        if (y < pad.t || y > h - pad.b) return null;
        return (
          <g key={t.label}>
            <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke={t.color} strokeDasharray="4 3" />
            <text x={pad.l - 3} y={y + 3} textAnchor="end" fill="var(--muted)" fontSize="9">{t.val}</text>
          </g>
        );
      })}
      <polyline points={points.join(" ")} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
      {data.length > 0 && (() => {
        const last = data[data.length - 1];
        const x = pad.l + ((data.length - 1) / (data.length - 1)) * iw;
        const y = pad.t + ih - ((last.l2 - minV) / (maxV - minV || 1)) * ih;
        return <circle cx={x} cy={y} r="4" fill="#3b82f6" />;
      })()}
      <text x={pad.l} y={h - 4} fill="var(--muted)" fontSize="9">oldest</text>
      <text x={w - pad.r} y={h - 4} textAnchor="end" fill="var(--muted)" fontSize="9">latest</text>
    </svg>
  );
}

function MetricRow({ label, value, interp, color }: { label: string; value: string; interp: string; color?: string }) {
  return (
    <div
      className="flex items-center gap-4 py-2.5 px-3 rounded-lg"
      style={{ background: "rgba(255,255,255,0.02)" }}
    >
      <span className="text-xs w-40 shrink-0" style={{ color: "var(--muted)" }}>{label}</span>
      <span className="text-sm font-mono font-semibold w-24 shrink-0" style={{ color: color || "var(--text)" }}>
        {value}
      </span>
      <span className="text-xs flex-1" style={{ color: "var(--muted)" }}>{interp}</span>
    </div>
  );
}

function AssetPill({ symbol, description }: { symbol: string; description: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs"
      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)" }}
    >
      <span className="font-mono font-semibold" style={{ color: "var(--blue)" }}>{symbol}</span>
      <span style={{ color: "var(--muted)" }}>{description}</span>
    </span>
  );
}

export function TdaDashboard() {
  const [preset, setPreset] = useState("broad-market");
  const [data, setData] = useState<TdaResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (p: string, refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tda?preset=${p}&days=252${refresh ? "&refresh=1" : ""}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(preset);
  }, [preset, fetchData]);

  const beta0Color = !data ? "var(--text)" : data.beta0 >= 3 ? "#ef4444" : data.beta0 >= 2 ? "#f97316" : "#22c55e";
  const l2Color = !data ? "var(--text)" : data.l2Norm > 0.45 ? "#ef4444" : data.l2Norm > 0.35 ? "#f97316" : data.l2Norm > 0.25 ? "#eab308" : "#22c55e";
  const trendColor = !data ? "var(--text)" :
    data.l2Trend.trend.includes("RISING") ? "#ef4444" :
    data.l2Trend.trend.includes("FALLING") ? "#22c55e" : "#eab308";

  return (
    <div className="space-y-6">
      {/* Preset selector */}
      <div className="flex gap-2 flex-wrap">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className="px-4 py-2 rounded-lg text-sm transition-all"
            style={{
              background: preset === p.key ? "var(--blue)" : "var(--card)",
              color: preset === p.key ? "#fff" : "var(--muted)",
              border: `1px solid ${preset === p.key ? "var(--blue)" : "var(--border)"}`,
            }}
          >
            {p.icon} {p.label}
          </button>
        ))}
        <button
          onClick={() => fetchData(preset, true)}
          disabled={loading}
          className="px-3 py-2 rounded-lg text-xs transition-all ml-auto"
          style={{ background: "var(--card)", color: "var(--muted)", border: "1px solid var(--border)" }}
        >
          {loading ? "Computing..." : "↻ Refresh"}
        </button>
      </div>

      {loading && !data && (
        <div className="text-center py-20">
          <div className="inline-block w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: "var(--border)", borderTopColor: "var(--blue)" }} />
          <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>Computing persistent homology...</p>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>Vietoris-Rips filtration on {preset} basket</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg p-4" style={{ background: "#ef444420", border: "1px solid #ef444440" }}>
          <p className="text-sm" style={{ color: "#ef4444" }}>{error}</p>
        </div>
      )}

      {data && (
        <>
          {/* Top cards: Gauge + β₀ + β₁ + L2 */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Crisis gauge */}
            <div className="rounded-xl p-5 flex items-center justify-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <ZoneGauge probability={data.crisis.probability} zone={data.crisis.zone} />
            </div>

            {/* β₀ */}
            <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>β₀ Pricing Regimes</div>
              <div className="text-4xl font-bold font-mono" style={{ color: beta0Color }}>{data.beta0}</div>
              <div className="text-xs mt-2" style={{ color: "var(--muted)" }}>
                {data.beta0 === 1 ? "Single consensus — market agrees" :
                 data.beta0 === 2 ? "Two regimes coexist — mismatch!" :
                 `${data.beta0} regimes — fractured market`}
              </div>
            </div>

            {/* β₁ */}
            <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>β₁ Feedback Loops</div>
              <div className="text-4xl font-bold font-mono" style={{ color: data.beta1 >= 3 ? "#f97316" : data.beta1 >= 1 ? "#eab308" : "#22c55e" }}>
                {data.beta1}
              </div>
              <div className="text-xs mt-2" style={{ color: "var(--muted)" }}>
                {data.beta1 === 0 ? "No hidden cycles" :
                 data.beta1 <= 3 ? `${data.beta1} feedback loop(s) detected` :
                 "Complex feedback web"}
              </div>
            </div>

            {/* L2 norm */}
            <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>L2 Norm (Structural Stress)</div>
              <div className="text-4xl font-bold font-mono" style={{ color: l2Color }}>{data.l2Norm.toFixed(4)}</div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs font-mono" style={{ color: trendColor }}>
                  {TREND_ICONS[data.l2Trend.trend] || ""} {data.l2Trend.trend}
                </span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  slope {data.l2Trend.slope > 0 ? "+" : ""}{data.l2Trend.slope}
                </span>
              </div>
            </div>
          </div>

          {/* Mismatch alert */}
          {data.mismatch && (
            <div
              className="rounded-xl p-4 flex items-start gap-3"
              style={{ background: "#f9731615", border: "1px solid #f9731640" }}
            >
              <span className="text-xl mt-0.5">⚠️</span>
              <div>
                <div className="text-sm font-semibold" style={{ color: "#f97316" }}>Topological Mismatch Detected</div>
                {data.mismatchReasons.map((r, i) => (
                  <div key={i} className="text-xs mt-1" style={{ color: "var(--muted)" }}>• {r}</div>
                ))}
                <div className="text-xs mt-2" style={{ color: "var(--muted)" }}>
                  Market consensus assumes β₀=1 (one price regime). The topology shows otherwise — this gap is the source of fragility.
                </div>
              </div>
            </div>
          )}

          {/* L2 trend chart */}
          <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold">Persistence Landscape L2 Norm — Rolling Trend</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                  Gidea &amp; Katz (2017): L2 &gt; 0.45 predicted crashes 250 days ahead at 98% significance
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs" style={{ color: "var(--muted)" }}>
                <span><span style={{ color: "#f97316" }}>- -</span> Warning 0.35</span>
                <span><span style={{ color: "#ef4444" }}>- -</span> Crisis 0.45</span>
              </div>
            </div>
            <L2Chart data={data.rollingL2} />
          </div>

          {/* Detail metrics */}
          <div className="rounded-xl p-5 space-y-1" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="text-sm font-semibold mb-3">Structural Metrics</div>
            <MetricRow
              label="β₀ (pricing regimes)"
              value={String(data.beta0)}
              color={beta0Color}
              interp={data.beta0 === 1 ? "Single consensus" : data.beta0 === 2 ? "Two regimes coexist — topological mismatch" : `${data.beta0} regimes — highly fractured`}
            />
            <MetricRow
              label="β₁ (feedback loops)"
              value={String(data.beta1)}
              interp={data.beta1 === 0 ? "No hidden cyclical feedback" : `${data.beta1} feedback loop(s) — oil→inflation→rates→costs→economy`}
            />
            <MetricRow label="L2 norm" value={data.l2Norm.toFixed(4)} color={l2Color}
              interp={data.l2Norm < 0.25 ? "Normal — no structural stress" : data.l2Norm < 0.35 ? "Mild structural features forming" : data.l2Norm < 0.45 ? "Warning zone — approaching crisis threshold" : `Crisis zone (${(data.l2Norm / 1.1 * 100).toFixed(0)}% of 2008 peak)`}
            />
            <MetricRow label="L2 trend" value={`${TREND_ICONS[data.l2Trend.trend] || ""} ${data.l2Trend.trend}`} color={trendColor}
              interp={`slope ${data.l2Trend.slope > 0 ? "+" : ""}${data.l2Trend.slope}`}
            />
            <MetricRow label="Correlation (20d)" value={data.correlation.meanCorrRecent.toFixed(3)}
              interp={data.correlation.collapse ? "COLLAPSE — all assets moving together" : `Normal dispersion (Δ${data.correlation.corrDelta > 0 ? "+" : ""}${data.correlation.corrDelta.toFixed(3)} vs baseline)`}
              color={data.correlation.collapse ? "#ef4444" : undefined}
            />
            <MetricRow label="H₀ max lifetime" value={data.h0MaxLifetime.toFixed(4)} interp="Longest-lived connected component" />
            <MetricRow label="H₁ max lifetime" value={data.h1MaxLifetime.toFixed(4)} interp="Longest-lived loop/cycle" />
            <MetricRow label="Point cloud" value={`${data.cloudShape[0]} × ${data.cloudShape[1]}`} interp={`${data.observations} observations, ${data.assets.length} assets, Takens embedding dim=5`} />
          </div>

          {/* Assets */}
          <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="text-sm font-semibold mb-3">Asset Basket — {data.label}</div>
            <div className="flex flex-wrap gap-2">
              {data.assets.map((sym, i) => (
                <AssetPill key={sym} symbol={sym} description={data.descriptions[i] || ""} />
              ))}
            </div>
          </div>

          {/* Interpretation */}
          <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="text-sm font-semibold mb-3">Interpretation</div>
            <div className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              {data.crisis.zone === "CRISIS" ? (
                <>
                  The topological structure shows <strong style={{ color: "#ef4444" }}>crisis-level</strong> complexity.
                  L2 norm at {data.l2Norm.toFixed(4)} ({(data.l2Norm / 1.1 * 100).toFixed(0)}% of 2008 peak) indicates
                  multiple long-lived structural features. With β₀={data.beta0} and β₁={data.beta1}, the market has fractured
                  into distinct pricing regimes with feedback loops that cannot be resolved by linear mean-reversion.
                  <strong style={{ color: "#ef4444" }}> Extreme caution warranted.</strong> Consider: long volatility,
                  reduce directional exposure, overweight gold.
                </>
              ) : data.crisis.zone === "WARNING" ? (
                <>
                  Structural warning signs are present. L2 at {data.l2Norm.toFixed(4)} is approaching the crisis threshold
                  of 0.45. This is where Gidea &amp; Katz (2017) found L2 reliably predicts crashes 250 trading days ahead.
                  This is not a crash signal — it&apos;s a <strong style={{ color: "#f97316" }}>fragility signal</strong>.
                  The system is one exogenous shock away from rapid structural collapse.
                  {data.mismatch && " The topological mismatch between market pricing and structural reality amplifies this fragility."}
                </>
              ) : data.crisis.zone === "ELEVATED" ? (
                <>
                  Mild structural features are forming. L2 at {data.l2Norm.toFixed(4)} is above normal but below crisis.
                  The topology is transitioning from dispersed to clustered — early signs of regime convergence.
                  {data.beta0 >= 2 && ` With β₀=${data.beta0}, multiple pricing narratives coexist — watch for L2 to keep rising.`}
                  {data.l2Trend.trend.includes("RISING") && " L2 trend is rising — monitor closely."}
                </>
              ) : (
                <>
                  Topology is clean. L2 at {data.l2Norm.toFixed(4)} shows dispersed, low-stress structure.
                  No topological mismatch detected. Normal diversification benefits hold.
                  {data.beta0 === 1 && " Single pricing regime — market consensus is stable."}
                </>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between text-xs" style={{ color: "var(--muted)" }}>
            <span>
              Computed {new Date(data.computedAt).toLocaleString()}
              {data.source === "cache" && " (cached)"}
            </span>
            <span>Based on Gidea &amp; Katz (2017), MDPI (2025)</span>
          </div>
        </>
      )}
    </div>
  );
}
