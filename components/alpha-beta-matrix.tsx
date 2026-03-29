"use client";

import { useState, useMemo, useRef } from "react";
import Link from "next/link";
import type { WatchlistStock } from "@/lib/db";
import { diagnoseCapm, CLOCK_FRAMEWORK, type DiagnosticVerdict } from "@/lib/capm-diagnostic";

interface Props {
  stocks: WatchlistStock[];
}

type AxisKey = "capm_alpha" | "capm_beta" | "capm_r2" | "composite_score" | "extreme_score";

const AXIS_OPTIONS: { value: AxisKey; label: string }[] = [
  { value: "capm_beta", label: "Beta" },
  { value: "capm_alpha", label: "Alpha %" },
  { value: "capm_r2", label: "R²" },
  { value: "composite_score", label: "Composite" },
  { value: "extreme_score", label: "Extreme" },
];

const CLOCK_COLORS: Record<string, string> = {
  "1": "#1e3a5f", "2": "#1e40af", "3": "#2563eb",
  "4": "#3b82f6", "5": "#60a5fa", "6": "#22c55e",
  "7": "#16a34a", "8": "#65a30d", "9": "#eab308",
  "10": "#f59e0b", "11": "#f97316", "12": "#ef4444",
};

function clockColor(cp: string | null): string {
  if (!cp) return "#6b7280";
  const m = cp.match(/(\d+)/);
  if (m) return CLOCK_COLORS[m[1]] || "#6b7280";
  return "#6b7280";
}

function diagnose(s: WatchlistStock): string {
  const a = s.capm_alpha, b = s.capm_beta, r = s.capm_r2;
  if (a == null || b == null) return "—";
  if (a > 20 && (r ?? 1) < 0.3) return "PURE IDIOSYNCRATIC — narrative-driven";
  if (a > 10 && b < 1) return "SKILL ALPHA — excess return, low risk";
  if (a > 10 && b >= 1.5) return "LEVERAGED ALPHA — outperforming, high exposure";
  if (a > 0 && a <= 10 && b > 1) return "MODERATE — slight edge, high beta";
  if (a >= -5 && a <= 5 && (r ?? 0) > 0.7) return "MARKET PROXY — tracks index";
  if (a < -10 && b > 1) return "NEGATIVE ALPHA — underperforming + high risk";
  if (a < -10 && (b ?? 0) < 0.5) return "DISTRESSED — falling behind";
  if (a < 0) return "NEGATIVE ALPHA — lagging benchmark";
  return "NEUTRAL";
}

const W = 900, H = 500, PAD = { top: 30, right: 30, bottom: 45, left: 60 };

export function AlphaBetaMatrix({ stocks }: Props) {
  const [xKey, setXKey] = useState<AxisKey>("capm_beta");
  const [yKey, setYKey] = useState<AxisKey>("capm_alpha");
  const [sizeKey, setSizeKey] = useState<AxisKey>("capm_r2");
  const [market, setMarket] = useState("");
  const [hover, setHover] = useState<WatchlistStock | null>(null);
  const [sortCol, setSortCol] = useState("capm_alpha");
  const [sortDir, setSortDir] = useState(-1);
  const svgRef = useRef<SVGSVGElement>(null);

  const filtered = useMemo(
    () => market ? stocks.filter((s) => s.market === market) : stocks,
    [stocks, market]
  );

  const { xMin, xMax, yMin, yMax, sMin, sMax } = useMemo(() => {
    const xs = filtered.map((s) => num(s, xKey)).filter((v) => v != null) as number[];
    const ys = filtered.map((s) => num(s, yKey)).filter((v) => v != null) as number[];
    const ss = filtered.map((s) => Math.abs(num(s, sizeKey) ?? 1));
    return {
      xMin: Math.min(...xs, 0), xMax: Math.max(...xs, 1),
      yMin: Math.min(...ys, 0), yMax: Math.max(...ys, 1),
      sMin: Math.min(...ss), sMax: Math.max(...ss) || 1,
    };
  }, [filtered, xKey, yKey, sizeKey]);

  function sx(v: number) {
    return PAD.left + ((v - xMin) / (xMax - xMin || 1)) * (W - PAD.left - PAD.right);
  }
  function sy(v: number) {
    return H - PAD.bottom - ((v - yMin) / (yMax - yMin || 1)) * (H - PAD.top - PAD.bottom);
  }
  function sr(v: number) {
    return 4 + ((Math.abs(v) - sMin) / (sMax - sMin || 1)) * 18;
  }

  // Stats
  const alphas = filtered.map((s) => s.capm_alpha).filter((v): v is number => v != null);
  const betas = filtered.map((s) => s.capm_beta).filter((v): v is number => v != null);
  const r2s = filtered.map((s) => s.capm_r2).filter((v): v is number => v != null);
  const avgAlpha = alphas.length ? (alphas.reduce((a, b) => a + b, 0) / alphas.length) : 0;
  const avgBeta = betas.length ? (betas.reduce((a, b) => a + b, 0) / betas.length) : 0;
  const avgR2 = r2s.length ? (r2s.reduce((a, b) => a + b, 0) / r2s.length) : 0;
  const posAlpha = alphas.filter((a) => a > 0).length;
  const highR2 = r2s.filter((r) => r > 0.5).length;

  // Sorted table
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const va = (a as unknown as Record<string, unknown>)[sortCol];
      const vb = (b as unknown as Record<string, unknown>)[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") return sortDir * (va as string).localeCompare(vb as string);
      return sortDir * ((va as number) - (vb as number));
    });
  }, [filtered, sortCol, sortDir]);

  function handleSort(col: string) {
    if (sortCol === col) setSortDir((d) => d * -1);
    else { setSortCol(col); setSortDir(-1); }
  }

  // Zero lines for default axes
  const showQuadrants = xKey === "capm_beta" && yKey === "capm_alpha";

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
        <label style={{ color: "var(--muted)" }}>Market</label>
        <select value={market} onChange={(e) => setMarket(e.target.value)} className="ctrl-select">
          <option value="">All ({stocks.length})</option>
          <option value="US">US</option>
          <option value="HK">HK</option>
          <option value="CHINA">China</option>
        </select>
        <label style={{ color: "var(--muted)" }}>X</label>
        <select value={xKey} onChange={(e) => setXKey(e.target.value as AxisKey)} className="ctrl-select">
          {AXIS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label style={{ color: "var(--muted)" }}>Y</label>
        <select value={yKey} onChange={(e) => setYKey(e.target.value as AxisKey)} className="ctrl-select">
          {AXIS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label style={{ color: "var(--muted)" }}>Size</label>
        <select value={sizeKey} onChange={(e) => setSizeKey(e.target.value as AxisKey)} className="ctrl-select">
          {AXIS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Stat cards */}
      {(() => {
        const verdicts = filtered.map((s) => diagnoseCapm(s).verdict);
        const validates = verdicts.filter((v) => v === "VALIDATES").length;
        const contradicts = verdicts.filter((v) => v === "CONTRADICTS").length;
        const mixed = verdicts.filter((v) => v === "MIXED").length;
        return (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-3 mb-5">
            {[
              { label: "Stocks", value: filtered.length.toString(), sub: "with CAPM", color: undefined },
              { label: "Avg α (6M)", value: `${avgAlpha >= 0 ? "+" : ""}${avgAlpha.toFixed(1)}%`, sub: "annualized", color: undefined },
              { label: "Avg β", value: avgBeta.toFixed(2), sub: "market sensitivity", color: undefined },
              { label: "Avg R²", value: avgR2.toFixed(2), sub: "market explains", color: undefined },
              { label: "α > 0", value: `${posAlpha}/${filtered.length}`, sub: "positive alpha", color: undefined },
              { label: "R² > 0.5", value: `${highR2}/${filtered.length}`, sub: "market-driven", color: undefined },
              { label: "✓ Validates", value: `${validates}`, sub: "α confirms clock", color: "var(--green)" },
              { label: "⚠ Mixed", value: `${mixed}`, sub: "partial match", color: "var(--yellow)" },
              { label: "✗ Contradicts", value: `${contradicts}`, sub: "α vs clock mismatch", color: "var(--red)" },
            ].map((c) => (
              <div key={c.label} className="rounded-lg p-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: c.color ?? "var(--muted)" }}>{c.label}</div>
                <div className="mt-0.5 text-xl font-bold font-mono" style={c.color ? { color: c.color } : undefined}>{c.value}</div>
                <div className="text-[10px]" style={{ color: "var(--muted)" }}>{c.sub}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Scatter plot */}
      <div className="rounded-lg p-4 mb-5 overflow-x-auto" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ maxHeight: 520, fontFamily: "Inter, sans-serif" }}
        >
          {/* Grid lines */}
          {Array.from({ length: 6 }).map((_, i) => {
            const yVal = yMin + (i / 5) * (yMax - yMin);
            const y = sy(yVal);
            return (
              <g key={`gy${i}`}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--border)" strokeWidth={0.5} />
                <text x={PAD.left - 6} y={y + 3} textAnchor="end" fontSize={9} fill="var(--muted)">{yVal.toFixed(yKey === "capm_r2" ? 2 : 0)}</text>
              </g>
            );
          })}
          {Array.from({ length: 6 }).map((_, i) => {
            const xVal = xMin + (i / 5) * (xMax - xMin);
            const x = sx(xVal);
            return (
              <g key={`gx${i}`}>
                <line x1={x} x2={x} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--border)" strokeWidth={0.5} />
                <text x={x} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={9} fill="var(--muted)">{xVal.toFixed(xKey === "capm_r2" ? 2 : 1)}</text>
              </g>
            );
          })}

          {/* Zero lines */}
          {yMin < 0 && yMax > 0 && (
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(0)} y2={sy(0)} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4,3" opacity={0.5} />
          )}
          {xMin < 0 && xMax > 0 && (
            <line x1={sx(0)} x2={sx(0)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4,3" opacity={0.5} />
          )}
          {/* β=1 reference line */}
          {showQuadrants && xMin < 1 && xMax > 1 && (
            <line x1={sx(1)} x2={sx(1)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth={1} strokeDasharray="2,4" opacity={0.3} />
          )}

          {/* Quadrant labels */}
          {showQuadrants && (
            <>
              <text x={PAD.left + 8} y={PAD.top + 16} fontSize={10} fontWeight={700} fill="#22c55e" opacity={0.2}>SKILL ALPHA</text>
              <text x={PAD.left + 8} y={PAD.top + 28} fontSize={8} fill="#22c55e" opacity={0.15}>Low beta, high return</text>
              <text x={W - PAD.right - 8} y={PAD.top + 16} fontSize={10} fontWeight={700} fill="#f59e0b" opacity={0.2} textAnchor="end">LEVERAGED ALPHA</text>
              <text x={W - PAD.right - 8} y={PAD.top + 28} fontSize={8} fill="#f59e0b" opacity={0.15} textAnchor="end">High beta, high return</text>
              <text x={PAD.left + 8} y={H - PAD.bottom - 10} fontSize={10} fontWeight={700} fill="#6b7280" opacity={0.2}>DEFENSIVE</text>
              <text x={W - PAD.right - 8} y={H - PAD.bottom - 10} fontSize={10} fontWeight={700} fill="#ef4444" opacity={0.2} textAnchor="end">PURE BETA</text>
            </>
          )}

          {/* Axis labels */}
          <text x={W / 2} y={H - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text)">
            {AXIS_OPTIONS.find((o) => o.value === xKey)?.label}
          </text>
          <text x={14} y={H / 2} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text)" transform={`rotate(-90,14,${H / 2})`}>
            {AXIS_OPTIONS.find((o) => o.value === yKey)?.label}
          </text>

          {/* Data points */}
          {filtered.map((s) => {
            const xv = num(s, xKey), yv = num(s, yKey), sv = num(s, sizeKey);
            if (xv == null || yv == null) return null;
            const cx = sx(xv), cy = sy(yv), r = sr(sv ?? 0);
            const col = clockColor(s.clock_position);
            const isHover = hover?.symbol === s.symbol;
            return (
              <g
                key={s.symbol}
                onMouseEnter={() => setHover(s)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: "pointer" }}
              >
                <circle cx={cx} cy={cy} r={isHover ? r + 3 : r} fill={col} opacity={isHover ? 0.95 : 0.7} stroke={isHover ? "#fff" : col} strokeWidth={isHover ? 2 : 1} />
                {(isHover || r > 10) && (
                  <text x={cx} y={cy - r - 3} textAnchor="middle" fontSize={8} fontWeight={600} fill="var(--text)">{s.symbol}</text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip */}
        {hover && (
          <div className="mt-2 p-3 rounded-lg text-xs" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: clockColor(hover.clock_position) }} />
              <strong>{hover.symbol}</strong>
              <span style={{ color: "var(--muted)" }}>{hover.name}</span>
              <span style={{ color: "var(--muted)" }}>| Clock: {hover.clock_position || "?"}</span>
            </div>
            <div className="font-mono flex flex-wrap gap-4" style={{ color: "var(--text)" }}>
              <span>α(6M): <strong style={{ color: (hover.capm_alpha ?? 0) > 0 ? "var(--green)" : "var(--red)" }}>{hover.capm_alpha?.toFixed(1)}%</strong></span>
              <span>α(1Y): <strong style={{ color: (hover.capm_alpha_1y ?? 0) > 0 ? "var(--green)" : "var(--red)" }}>{hover.capm_alpha_1y?.toFixed(1)}%</strong></span>
              <span>β: <strong>{hover.capm_beta?.toFixed(2)}</strong></span>
              <span>R²: <strong>{hover.capm_r2?.toFixed(2)}</strong></span>
              <span>Bench: {hover.capm_benchmark}</span>
              <span>Trend: <TrendBadge trend={hover.capm_alpha_trend} /></span>
              <span>Score: {hover.composite_score}/100</span>
            </div>
            <div className="mt-1" style={{ color: "var(--muted)" }}>{diagnose(hover)}</div>
            {(() => {
              const d = diagnoseCapm(hover);
              if (d.verdict === "NO_DATA") return null;
              const vc = d.verdict === "VALIDATES" ? "var(--green)" : d.verdict === "CONTRADICTS" ? "var(--red)" : "var(--yellow)";
              return <div className="mt-1" style={{ color: vc }}>Clock: {d.verdict} — {d.summary}</div>;
            })()}
          </div>
        )}
      </div>

      {/* Clock legend */}
      <div className="flex flex-wrap gap-2 mb-5 text-[10px]" style={{ color: "var(--muted)" }}>
        <span className="font-semibold mr-1">Clock:</span>
        {Object.entries(CLOCK_COLORS).map(([h, c]) => (
          <span key={h} className="flex items-center gap-0.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: c }} />
            {h}:00
          </span>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg overflow-x-auto" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: "var(--card)" }}>
              {[
                { col: "symbol", label: "Symbol" },
                { col: "name", label: "Name" },
                { col: "clock_position", label: "Clock" },
                { col: "capm_alpha", label: "α 6M%" },
                { col: "capm_alpha_1y", label: "α 1Y%" },
                { col: "capm_alpha_trend", label: "Trend" },
                { col: "capm_beta", label: "β" },
                { col: "capm_r2", label: "R²" },
                { col: "capm_benchmark", label: "Bench" },
                { col: "_verdict", label: "Clock Valid." },
                { col: "composite_score", label: "Score" },
                { col: "action", label: "Action" },
                { col: "_diag", label: "Diagnosis" },
              ].map((h) => (
                <th
                  key={h.col}
                  className="px-2 py-2 text-left font-semibold whitespace-nowrap cursor-pointer select-none hover:underline"
                  style={{ borderBottom: "2px solid var(--border)", color: sortCol === h.col ? "var(--text)" : "var(--muted)" }}
                  onClick={() => !h.col.startsWith("_") && handleSort(h.col)}
                >
                  {h.label}
                  {sortCol === h.col && <span className="ml-0.5">{sortDir > 0 ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const diag = diagnoseCapm(s);
              const vc = diag.verdict === "VALIDATES" ? "var(--green)" : diag.verdict === "CONTRADICTS" ? "var(--red)" : diag.verdict === "MIXED" ? "var(--yellow)" : "var(--muted)";
              const vi = diag.verdict === "VALIDATES" ? "✓" : diag.verdict === "CONTRADICTS" ? "✗" : diag.verdict === "MIXED" ? "⚠" : "—";
              return (
                <tr key={s.symbol + s.id} className="hover:brightness-110 transition-colors" style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-2 py-1.5 font-semibold">
                    <Link href={`/stock/${encodeURIComponent(s.symbol)}`} className="hover:underline" style={{ color: "var(--blue)" }}>{s.symbol}</Link>
                  </td>
                  <td className="px-2 py-1.5 max-w-[140px] truncate">{s.name}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: clockColor(s.clock_position) }} />
                    {s.clock_position || "?"}
                  </td>
                  <td className="px-2 py-1.5 font-mono font-semibold" style={{ color: (s.capm_alpha ?? 0) > 0 ? "var(--green)" : "var(--red)" }}>
                    {s.capm_alpha != null ? `${s.capm_alpha > 0 ? "+" : ""}${s.capm_alpha.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-2 py-1.5 font-mono" style={{ color: (s.capm_alpha_1y ?? 0) > 0 ? "var(--green)" : "var(--red)" }}>
                    {s.capm_alpha_1y != null ? `${s.capm_alpha_1y > 0 ? "+" : ""}${s.capm_alpha_1y.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-2 py-1.5"><TrendBadge trend={s.capm_alpha_trend} /></td>
                  <td className="px-2 py-1.5 font-mono">{s.capm_beta?.toFixed(2) ?? "—"}</td>
                  <td className="px-2 py-1.5 font-mono">{s.capm_r2?.toFixed(2) ?? "—"}</td>
                  <td className="px-2 py-1.5" style={{ color: "var(--muted)" }}>{s.capm_benchmark ?? "—"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap" title={diag.summary}>
                    <span className="font-semibold" style={{ color: vc }}>{vi} {diag.verdict !== "NO_DATA" ? diag.verdict : "—"}</span>
                  </td>
                  <td className="px-2 py-1.5 font-mono">{s.composite_score ?? "—"}</td>
                  <td className="px-2 py-1.5 max-w-[120px] truncate">{s.action || "—"}</td>
                  <td className="px-2 py-1.5 max-w-[200px] truncate" style={{ color: "var(--muted)" }}>{diagnose(s)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Clock-by-Clock Framework Reference */}
      <div className="mt-8 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-4 py-3" style={{ background: "var(--card)" }}>
          <h3 className="text-sm font-bold">Clock-by-Clock α/β/R² Framework</h3>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
            What alpha, beta, and R² should look like at each narrative stage — and warning signs that the clock position may be wrong.
          </p>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: "var(--card)", borderTop: "1px solid var(--border)" }}>
              <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--muted)" }}>Clock</th>
              <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--muted)" }}>Phase</th>
              <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--green)" }}>Expected α</th>
              <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--blue)" }}>Expected β</th>
              <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--muted)" }}>Expected R²</th>
              <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--muted)" }}>Signature</th>
              <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--red)" }}>Warning Signs</th>
            </tr>
          </thead>
          <tbody>
            {CLOCK_FRAMEWORK.map((row) => (
              <tr key={row.hours} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="px-3 py-2 font-bold whitespace-nowrap">{row.hours}</td>
                <td className="px-3 py-2 font-semibold whitespace-nowrap">{row.phase}</td>
                <td className="px-3 py-2">{row.alphaRange}</td>
                <td className="px-3 py-2">{row.betaRange}</td>
                <td className="px-3 py-2">{row.r2Range}</td>
                <td className="px-3 py-2" style={{ color: "var(--muted)" }}>{row.signature}</td>
                <td className="px-3 py-2" style={{ color: "var(--red)" }}>{row.warnings}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .ctrl-select {
          padding: 4px 8px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--card);
          color: var(--text);
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}

function TrendBadge({ trend }: { trend: string | null }) {
  if (!trend) return <span style={{ color: "var(--muted)" }}>—</span>;
  const cls =
    trend === "accelerating"
      ? "bg-green-900/30 text-green-400"
      : trend === "decelerating"
        ? "bg-red-900/30 text-red-400"
        : "bg-gray-800/30 text-gray-400";
  const label = trend === "accelerating" ? "↗ acc" : trend === "decelerating" ? "↘ dec" : "— stb";
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>{label}</span>;
}

function num(s: WatchlistStock, key: AxisKey): number | null {
  const v = s[key as keyof WatchlistStock];
  if (v == null) return null;
  return typeof v === "number" ? v : null;
}
