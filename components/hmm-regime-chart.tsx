"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface RegimeStat {
  label: string;
  color: string;
  muAnn: number;
  sigmaAnn: number;
  duration: number;
  pctTime: number;
}

interface StrategyResult {
  label: string;
  cagr: number;
  sharpe: number;
  maxDrawdown: number;
  totalReturn: number;
  equity: number[];
}

interface HmmData {
  params: {
    nStates: number;
    transmat: number[][];
  };
  states: number[];
  stateLabels: string[];
  stateColors: string[];
  persistence: number[];
  avgPersistence: number;
  stationaryDist: number[];
  expectedDurations: number[];
  regimeStats: RegimeStat[];
  backtest: {
    momentum: StrategyResult;
    meanrev: StrategyResult;
    buyhold: StrategyResult;
  };
  prices: number[];
  dates: string[];
  signal: "MOMENTUM" | "MEAN_REVERSION" | "MIXED";
  totalDays: number;
}

function PersistenceBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(value * 100, 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs w-12 shrink-0 font-mono" style={{ color }}>{label}</span>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-mono w-14 text-right">{(value * 100).toFixed(1)}%</span>
    </div>
  );
}

function RegimeTimeline({ states, colors, dates }: { states: number[]; colors: string[]; dates: string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const barW = w / states.length;

    for (let i = 0; i < states.length; i++) {
      ctx.fillStyle = colors[states[i]] || "#64748b";
      ctx.fillRect(i * barW, 0, barW + 0.5, h);
    }

    // Year labels
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "10px monospace";
    let lastYear = "";
    for (let i = 0; i < dates.length; i++) {
      const yr = dates[i]?.substring(0, 4);
      if (yr && yr !== lastYear) {
        ctx.fillText(yr, i * barW + 2, h - 3);
        lastYear = yr;
      }
    }
  }, [states, colors, dates]);

  return <canvas ref={canvasRef} className="w-full rounded" style={{ height: 32 }} />;
}

function PriceWithRegimes({ prices, states, colors, dates }: { prices: number[]; states: number[]; colors: string[]; dates: string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const pad = { top: 10, bottom: 20, left: 0, right: 0 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    const logPrices = prices.map(p => Math.log(p));
    const minP = Math.min(...logPrices);
    const maxP = Math.max(...logPrices);
    const range = maxP - minP || 1;

    const xScale = (i: number) => pad.left + (i / (prices.length - 1)) * plotW;
    const yScale = (lp: number) => pad.top + (1 - (lp - minP) / range) * plotH;

    // Regime background bands
    for (let i = 0; i < states.length; i++) {
      ctx.fillStyle = colors[states[i]]?.replace(")", ",0.12)").replace("rgb", "rgba") || "rgba(100,100,100,0.1)";
      const x1 = xScale(i);
      const x2 = i < states.length - 1 ? xScale(i + 1) : x1 + plotW / states.length;
      ctx.fillRect(x1, pad.top, x2 - x1 + 0.5, plotH);
    }

    // Price line
    ctx.beginPath();
    ctx.strokeStyle = "rgba(226,232,240,0.85)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < prices.length; i++) {
      const x = xScale(i);
      const y = yScale(logPrices[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Year labels
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "10px monospace";
    let lastYear = "";
    for (let i = 0; i < dates.length; i++) {
      const yr = dates[i]?.substring(0, 4);
      if (yr && yr !== lastYear) {
        ctx.fillText(yr, xScale(i) + 2, h - 4);
        lastYear = yr;
      }
    }

    // Price labels on right
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.textAlign = "right";
    const nTicks = 4;
    for (let i = 0; i <= nTicks; i++) {
      const lp = minP + (i / nTicks) * range;
      const price = Math.exp(lp);
      ctx.fillText(price >= 1000 ? `${(price / 1000).toFixed(0)}K` : price.toFixed(0), w - 4, yScale(lp) + 3);
    }
    ctx.textAlign = "left";
  }, [prices, states, colors, dates]);

  return <canvas ref={canvasRef} className="w-full rounded" style={{ height: 180 }} />;
}

export function HmmRegimeChart({ symbol }: { symbol: string }) {
  const [data, setData] = useState<HmmData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [years, setYears] = useState(5);
  const [nStates, setNStates] = useState(3);

  const fetchHmm = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hmm?symbol=${encodeURIComponent(symbol)}&years=${years}&states=${nStates}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [symbol, years, nStates]);

  useEffect(() => {
    fetchHmm();
  }, [fetchHmm]);

  const signalColor = data?.signal === "MOMENTUM" ? "var(--blue)" : data?.signal === "MEAN_REVERSION" ? "#ec4899" : "var(--yellow)";
  const signalLabel = data?.signal === "MOMENTUM" ? "Favors Momentum" : data?.signal === "MEAN_REVERSION" ? "Favors Mean Reversion" : "Mixed Signal";

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Markov Regime Model (HMM)</h2>
        <div className="flex items-center gap-3">
          <select
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
            className="text-xs font-mono px-2 py-1 rounded"
            style={{ background: "var(--background)", border: "1px solid var(--border)", color: "var(--foreground)" }}
          >
            <option value={3}>3Y</option>
            <option value={5}>5Y</option>
            <option value={10}>10Y</option>
            <option value={15}>15Y</option>
          </select>
          <select
            value={nStates}
            onChange={(e) => setNStates(Number(e.target.value))}
            className="text-xs font-mono px-2 py-1 rounded"
            style={{ background: "var(--background)", border: "1px solid var(--border)", color: "var(--foreground)" }}
          >
            <option value={2}>2 States</option>
            <option value={3}>3 States</option>
          </select>
          <button
            onClick={fetchHmm}
            disabled={loading}
            className="text-xs font-mono px-3 py-1 rounded"
            style={{ background: "var(--blue)", color: "#fff", opacity: loading ? 0.5 : 1 }}
          >
            {loading ? "Fitting..." : "Re-fit"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg p-3 text-sm mb-4" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444" }}>
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="text-sm py-8 text-center" style={{ color: "var(--muted)" }}>
          Fitting {nStates}-state HMM on {years}Y of daily returns...
        </div>
      )}

      {data && (
        <div className="space-y-5">
          {/* Signal Badge */}
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold"
              style={{ background: `${signalColor}20`, color: signalColor }}
            >
              {data.signal === "MOMENTUM" ? "📈" : data.signal === "MEAN_REVERSION" ? "🔄" : "⚖️"} {signalLabel}
            </span>
            <span className="text-xs font-mono" style={{ color: "var(--muted)" }}>
              Avg persistence: {(data.avgPersistence * 100).toFixed(1)}% | {data.totalDays} trading days
            </span>
          </div>

          {/* Price with Regime Background */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              Price with Regime Classification (log scale)
            </div>
            <PriceWithRegimes
              prices={data.prices}
              states={data.states}
              colors={data.stateColors}
              dates={data.dates}
            />
            <div className="flex items-center gap-4 mt-1.5 justify-center">
              {data.stateLabels.map((label, i) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: data.stateColors[i] }} />
                  <span className="text-[10px] font-mono" style={{ color: "var(--muted)" }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Regime Timeline */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              Regime Timeline
            </div>
            <RegimeTimeline states={data.states} colors={data.stateColors} dates={data.dates} />
          </div>

          {/* Regime Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {data.regimeStats.map((rs) => (
              <div
                key={rs.label}
                className="rounded-lg p-4"
                style={{ background: `${rs.color}10`, border: `1px solid ${rs.color}30` }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: rs.color }} />
                  <span className="text-sm font-bold" style={{ color: rs.color }}>{rs.label}</span>
                </div>
                <div className="grid grid-cols-2 gap-y-1.5 text-xs">
                  <div>
                    <span style={{ color: "var(--muted)" }}>Return </span>
                    <span className="font-mono font-semibold">{rs.muAnn >= 0 ? "+" : ""}{rs.muAnn.toFixed(1)}%</span>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)" }}>Vol </span>
                    <span className="font-mono font-semibold">{rs.sigmaAnn.toFixed(1)}%</span>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)" }}>Duration </span>
                    <span className="font-mono font-semibold">{rs.duration < 1000 ? `~${rs.duration.toFixed(0)}d` : "∞"}</span>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)" }}>Time </span>
                    <span className="font-mono font-semibold">{rs.pctTime.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Persistence Bars */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              Regime Persistence (diagonal of P)
            </div>
            <div className="space-y-2">
              {data.persistence.map((p, i) => (
                <PersistenceBar key={i} label={data.stateLabels[i]} value={p} color={data.stateColors[i]} />
              ))}
            </div>
          </div>

          {/* Transition Matrix */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              Transition Matrix
            </div>
            <div className="overflow-x-auto">
              <table className="text-xs font-mono">
                <thead>
                  <tr>
                    <th className="px-3 py-1.5 text-left" style={{ color: "var(--muted)" }}>From \ To</th>
                    {data.stateLabels.map((l, i) => (
                      <th key={l} className="px-3 py-1.5 text-center font-bold" style={{ color: data.stateColors[i] }}>{l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.params.transmat.map((row, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 font-bold" style={{ color: data.stateColors[i] }}>{data.stateLabels[i]}</td>
                      {row.map((val, j) => (
                        <td
                          key={j}
                          className="px-3 py-1.5 text-center rounded"
                          style={{
                            background: i === j ? `${data.stateColors[i]}25` : "transparent",
                            fontWeight: i === j ? 700 : 400,
                          }}
                        >
                          {val.toFixed(3)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Stationary Distribution */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              Stationary Distribution π (long-run)
            </div>
            <div className="flex gap-4">
              {data.stationaryDist.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: data.stateColors[i] }} />
                  <span className="text-xs font-mono">
                    <span style={{ color: data.stateColors[i] }}>{data.stateLabels[i]}</span>{" "}
                    {(p * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Strategy Backtest */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              Strategy Backtest (in-sample)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th className="px-3 py-2 text-left" style={{ color: "var(--muted)" }}>Strategy</th>
                    <th className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>CAGR</th>
                    <th className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>Sharpe</th>
                    <th className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>Max DD</th>
                    <th className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(["momentum", "meanrev", "buyhold"] as const).map((key) => {
                    const s = data.backtest[key];
                    const color = key === "momentum" ? "var(--blue)" : key === "meanrev" ? "#ec4899" : "var(--muted)";
                    return (
                      <tr key={key} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td className="px-3 py-2 font-semibold" style={{ color }}>{s.label}</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: s.cagr >= 0 ? "var(--green)" : "var(--red)" }}>
                          {s.cagr >= 0 ? "+" : ""}{s.cagr.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{s.sharpe.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: "var(--red)" }}>{s.maxDrawdown.toFixed(1)}%</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: s.totalReturn >= 0 ? "var(--green)" : "var(--red)" }}>
                          {s.totalReturn >= 0 ? "+" : ""}{s.totalReturn.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[10px]" style={{ color: "var(--muted)" }}>
              Momentum = long in Bull, short in Bear, cash in Flat. Mean Reversion = opposite. In-sample backtest — not a prediction.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
