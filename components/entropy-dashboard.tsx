"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface EntropyProfile {
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

interface PortfolioEntropy {
  crossEntropy: number;
  correlationEntropy: number;
  concentrated: boolean;
  detail: string;
}

interface ApiResponse {
  profiles: EntropyProfile[];
  portfolio: PortfolioEntropy;
  computed_at: string;
}

function EntropyBar({ value, label, sublabel }: { value: number; label: string; sublabel?: string }) {
  const pct = Math.min(value * 100, 100);
  const color =
    pct <= 25 ? "#ef4444" : pct <= 45 ? "#f97316" : pct <= 70 ? "#f59e0b" : "#10b981";
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs w-16 shrink-0 text-right" style={{ color: "var(--muted)" }}>
        {label}
      </span>
      <div
        className="flex-1 h-2.5 rounded-full overflow-hidden"
        style={{ background: "rgba(255,255,255,0.06)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-xs font-mono w-12 text-right" style={{ color }}>
        {value.toFixed(2)}
      </span>
      {sublabel && (
        <span className="text-[10px] w-20 text-right" style={{ color: "var(--muted)" }}>
          {sublabel}
        </span>
      )}
    </div>
  );
}

function MiniSparkline({ history, width = 120, height = 32 }: { history: { date: string; entropy: number }[]; width?: number; height?: number }) {
  if (history.length < 2) return null;
  const values = history.map((h) => h.entropy);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 0.01;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  const latest = values[values.length - 1];
  const latestColor =
    latest <= 0.5 ? "#ef4444" : latest <= 0.7 ? "#f59e0b" : "#10b981";

  return (
    <svg width={width} height={height} className="inline-block">
      <defs>
        <linearGradient id="sparkGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={latestColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={latestColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={points}
        fill="none"
        stroke={latestColor}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill="url(#sparkGrad)"
      />
    </svg>
  );
}

function CogGapMeter({ score }: { score: number }) {
  const segments = 10;
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: segments }, (_, i) => {
        const active = i < score;
        let color = "#10b981";
        if (i >= 7) color = "#ef4444";
        else if (i >= 5) color = "#f97316";
        else if (i >= 3) color = "#f59e0b";
        return (
          <div
            key={i}
            className="rounded-sm transition-all"
            style={{
              width: 6,
              height: 14,
              background: active ? color : "rgba(255,255,255,0.06)",
              opacity: active ? 1 : 0.3,
            }}
          />
        );
      })}
    </div>
  );
}

function RegimeBadge({ regime, regimeColor }: { regime: string; regimeColor: string }) {
  const icon = regime === "compressed" ? "⚠" : regime === "diverse" ? "✓" : "—";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: `${regimeColor}15`, color: regimeColor }}
    >
      {icon} {regime}
    </span>
  );
}

function PortfolioCard({ portfolio }: { portfolio: PortfolioEntropy }) {
  const borderColor = portfolio.concentrated ? "#ef4444" : "#10b981";
  return (
    <div
      className="rounded-lg p-5"
      style={{ background: "var(--card)", border: `1px solid ${borderColor}30` }}
    >
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--blue)" }}>
          Portfolio Entropy
        </h3>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{
            background: portfolio.concentrated ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)",
            color: portfolio.concentrated ? "#ef4444" : "#10b981",
          }}
        >
          {portfolio.concentrated ? "CONCENTRATED" : "DIVERSIFIED"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Cross-Stock Entropy
          </div>
          <div className="text-lg font-mono font-bold">{portfolio.crossEntropy.toFixed(3)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Correlation Entropy
          </div>
          <div className="text-lg font-mono font-bold">{portfolio.correlationEntropy.toFixed(3)}</div>
        </div>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        {portfolio.detail}
      </p>
    </div>
  );
}

export function EntropyDashboard() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "compressed" | "anchors">("table");

  useEffect(() => {
    fetch("/api/entropy")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div
            className="inline-block w-8 h-8 rounded-full border-2 border-t-transparent animate-spin mb-3"
            style={{ borderColor: "var(--blue)", borderTopColor: "transparent" }}
          />
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Computing Shannon entropy for all watchlist stocks...
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            This may take 30-60 seconds on first load
          </p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg p-6 text-center" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}>
        <p className="text-sm" style={{ color: "#ef4444" }}>
          {error || "Failed to load entropy data"}
        </p>
      </div>
    );
  }

  const { profiles, portfolio } = data;
  const compressed = profiles.filter((p) => p.regime === "compressed");
  const anchors = profiles.filter((p) => p.anchorFailure);
  const avgEntropy = profiles.reduce((s, p) => s + p.current60d, 0) / profiles.length;
  const avgPercentile = profiles.reduce((s, p) => s + p.percentile, 0) / profiles.length;

  const displayed =
    view === "compressed"
      ? compressed
      : view === "anchors"
        ? anchors
        : profiles;

  return (
    <div className="space-y-6">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Avg Entropy (60d)
          </div>
          <div className="text-2xl font-mono font-bold mt-1">{avgEntropy.toFixed(3)}</div>
          <div className="text-[10px]" style={{ color: "var(--muted)" }}>
            Normalized [0,1]
          </div>
        </div>
        <div className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Avg Percentile
          </div>
          <div className="text-2xl font-mono font-bold mt-1">{avgPercentile.toFixed(0)}%</div>
          <div className="text-[10px]" style={{ color: "var(--muted)" }}>
            vs 3yr rolling history
          </div>
        </div>
        <div className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "#ef4444" }}>
            Compressed
          </div>
          <div className="text-2xl font-mono font-bold mt-1" style={{ color: "#ef4444" }}>
            {compressed.length}
          </div>
          <div className="text-[10px]" style={{ color: "var(--muted)" }}>
            Stocks with low entropy (&le;20th pctile)
          </div>
        </div>
        <div className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "#f97316" }}>
            Anchor Failures
          </div>
          <div className="text-2xl font-mono font-bold mt-1" style={{ color: "#f97316" }}>
            {anchors.length}
          </div>
          <div className="text-[10px]" style={{ color: "var(--muted)" }}>
            Low entropy + valuation divergence
          </div>
        </div>
      </div>

      {/* Portfolio entropy */}
      <PortfolioCard portfolio={portfolio} />

      {/* Concept explainer */}
      <div
        className="rounded-lg p-5"
        style={{ background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.15)" }}
      >
        <div className="flex items-start gap-3">
          <span className="text-lg mt-0.5">H</span>
          <div>
            <p className="text-sm leading-relaxed mb-2">
              <strong>Shannon Entropy</strong> measures the informational diversity of return distributions.
              Low entropy means one dominant force drives prices (panic, policy, narrative crowding).
              The edge is not in finding order — it is in finding <em>who mistakes compressed order for complete understanding</em>.
            </p>
            <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
              H = −Σ p(x)·log₂(p(x)), normalized to [0,1]. Percentile ranks current 60-day entropy against
              3-year rolling history. &quot;Cognitive Gap&quot; combines low entropy + falling trend + volume concentration
              + geometric order + regime stress.
            </p>
          </div>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex gap-2">
        {([
          ["table", `All (${profiles.length})`],
          ["compressed", `Compressed (${compressed.length})`],
          ["anchors", `Anchor Failures (${anchors.length})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className="text-xs px-3 py-1.5 rounded-md transition-colors cursor-pointer"
            style={{
              background: view === key ? "var(--blue)" : "var(--card)",
              color: view === key ? "#fff" : "var(--muted)",
              border: `1px solid ${view === key ? "var(--blue)" : "var(--border)"}`,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Main table */}
      <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead style={{ background: "var(--card)" }}>
            <tr>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Symbol
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Regime
              </th>
              <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                H(60d)
              </th>
              <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                H(252d)
              </th>
              <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Pctile
              </th>
              <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Trend
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Vol H
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Cog Gap
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                60d History
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((p) => (
              <tr
                key={p.symbol}
                className="border-t transition-colors hover:bg-zinc-900/60"
                style={{
                  borderColor: "var(--border)",
                  background: p.anchorFailure ? "rgba(249,115,22,0.04)" : undefined,
                }}
              >
                <td className="px-3 py-3">
                  <Link
                    href={`/stock/${encodeURIComponent(p.symbol)}`}
                    className="font-mono font-semibold text-xs hover:underline"
                    style={{ color: "var(--blue)" }}
                  >
                    {p.symbol}
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <RegimeBadge regime={p.regime} regimeColor={p.regimeColor} />
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs">
                  <span style={{ color: p.current60d <= 0.5 ? "#ef4444" : p.current60d <= 0.7 ? "#f59e0b" : "var(--text)" }}>
                    {p.current60d.toFixed(3)}
                  </span>
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs">
                  {p.current252d.toFixed(3)}
                </td>
                <td className="px-3 py-3 text-right">
                  <span
                    className="font-mono text-xs font-bold"
                    style={{ color: p.percentile <= 20 ? "#ef4444" : p.percentile >= 80 ? "#10b981" : "var(--text)" }}
                  >
                    {p.percentile.toFixed(0)}%
                  </span>
                </td>
                <td className="px-3 py-3 text-right">
                  <span
                    className="font-mono text-xs"
                    style={{ color: p.trend < -0.0005 ? "#ef4444" : p.trend > 0.0005 ? "#10b981" : "var(--muted)" }}
                  >
                    {p.trend >= 0 ? "+" : ""}{(p.trend * 1000).toFixed(2)}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <EntropyBar value={p.volumeEntropy60d} label="" />
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <CogGapMeter score={p.cogGap} />
                    <span className="text-[10px] font-mono">{p.cogGap}/10</span>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <MiniSparkline history={p.history} />
                </td>
                <td className="px-3 py-3">
                  {p.anchorFailure ? (
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(249,115,22,0.15)", color: "#f97316" }}
                    >
                      ANCHOR FAIL
                    </span>
                  ) : (
                    <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                      {p.anchorDetail.length > 40 ? p.anchorDetail.slice(0, 38) + "…" : p.anchorDetail}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {displayed.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-8 text-center text-sm"
                  style={{ color: "var(--muted)" }}
                >
                  {view === "compressed"
                    ? "No stocks in compressed entropy regime"
                    : view === "anchors"
                      ? "No anchor failure signals detected"
                      : "No entropy data available"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div
        className="rounded-lg p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div>
          <div className="font-semibold mb-1">Entropy Regimes</div>
          <div className="flex flex-col gap-1" style={{ color: "var(--muted)" }}>
            <span><span style={{ color: "#ef4444" }}>Compressed</span> — Percentile &le; 20th. One dominant force.</span>
            <span><span style={{ color: "#f59e0b" }}>Normal</span> — 20th-80th. Standard market dynamics.</span>
            <span><span style={{ color: "#10b981" }}>Diverse</span> — &ge; 80th. Rich informational environment.</span>
          </div>
        </div>
        <div>
          <div className="font-semibold mb-1">Cognitive Gap (0-10)</div>
          <div className="flex flex-col gap-1" style={{ color: "var(--muted)" }}>
            <span>Low entropy + falling trend + volume concentration</span>
            <span>+ high geometric order + bear HMM regime</span>
            <span>Higher = more &quot;bits&quot; left unprocessed by the market</span>
          </div>
        </div>
        <div>
          <div className="font-semibold mb-1">Anchor Failure</div>
          <div className="flex flex-col gap-1" style={{ color: "var(--muted)" }}>
            <span>Low entropy + price far from valuation anchors</span>
            <span>ATH &ge; -40%, PE &gt; 50x, DCF divergence &gt; 30%</span>
            <span>Red walls &ge; 2: fundamental stress under compression</span>
          </div>
        </div>
      </div>

      <div className="text-right text-[10px]" style={{ color: "var(--muted)" }}>
        Computed: {new Date(data.computed_at).toLocaleString()}
      </div>
    </div>
  );
}
