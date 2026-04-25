"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { CTAAssetClass, CTADashboard, CTARow } from "@/lib/cta-positioning";

type AssetFilter = CTAAssetClass | "All";
type Period = "1y" | "2y" | "3y" | "5y" | "max";

const ASSET_CLASSES: AssetFilter[] = ["All", "Equities", "Rates", "FX", "Commodities"];
const PERIODS: Period[] = ["1y", "2y", "3y", "5y", "max"];

function exposureColor(value: number): string {
  if (value >= 0.7) return "var(--green)";
  if (value >= 0.25) return "#4ade80";
  if (value <= -0.7) return "var(--red)";
  if (value <= -0.25) return "#f97316";
  return "var(--muted)";
}

function flowColor(value: number | null): string {
  if (value == null) return "var(--muted)";
  if (value > 0.2) return "var(--green)";
  if (value < -0.2) return "var(--red)";
  return "var(--muted)";
}

function pct(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const v = value * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function signed(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {detail && <div className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>{detail}</div>}
    </div>
  );
}

function ExposureBar({ value }: { value: number }) {
  const width = Math.min(50, Math.abs(value) * 50);
  const positive = value >= 0;
  return (
    <div className="h-2 rounded-full overflow-hidden relative" style={{ background: "var(--border)" }}>
      <div
        className="h-full rounded-full absolute"
        style={{
          width: `${width}%`,
          left: positive ? "50%" : `${50 - width}%`,
          background: exposureColor(value),
        }}
      />
    </div>
  );
}

function ShockCell({ row, shock }: { row: CTARow; shock: string }) {
  const v = row.shockGrid[shock]?.flow ?? null;
  return <td className="py-2 px-2 text-right font-mono" style={{ color: flowColor(v) }}>{signed(v)}</td>;
}

function RowDetail({ row }: { row: CTARow }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <section className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
        <h3 className="text-sm font-semibold mb-3">Trend Stack</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left" style={{ color: "var(--muted)" }}>
              <th className="py-2">Lookback</th>
              <th className="py-2 text-right">Return</th>
              <th className="py-2 text-right">Z</th>
              <th className="py-2 text-right">Weight</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(row.components).map(([k, c]) => (
              <tr key={k} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="py-2">{k}</td>
                <td className="py-2 text-right font-mono" style={{ color: flowColor(c.return) }}>{pct(c.return)}</td>
                <td className="py-2 text-right font-mono">{signed(c.z)}</td>
                <td className="py-2 text-right font-mono">{(c.weight * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
        <h3 className="text-sm font-semibold mb-3">Shock Map</h3>
        <div className="grid grid-cols-4 gap-2 text-xs">
          {Object.entries(row.shockGrid).map(([shock, s]) => (
            <div key={shock} className="rounded-md p-2" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div style={{ color: "var(--muted)" }}>{shock}</div>
              <div className="font-mono font-bold" style={{ color: flowColor(s.flow) }}>{signed(s.flow)}</div>
              <div className="font-mono text-[11px]" style={{ color: exposureColor(s.exposure) }}>exp {signed(s.exposure)}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function CTADashboard() {
  const [assetClass, setAssetClass] = useState<AssetFilter>("All");
  const [period, setPeriod] = useState<Period>("3y");
  const [targetVol, setTargetVol] = useState(0.15);
  const [data, setData] = useState<CTADashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({
        assetClass,
        period,
        targetVol: String(targetVol),
      });
      const resp = await fetch(`/api/cta-positioning?${qs.toString()}`);
      const json = await resp.json();
      if (!resp.ok || json.error) {
        setErr(json.error || `HTTP ${resp.status}`);
        setData(null);
      } else {
        setData(json);
      }
    } catch (e) {
      setErr(String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [assetClass, period, targetVol]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const out = new Map<string, CTARow[]>();
    for (const row of data?.rows ?? []) {
      const rows = out.get(row.assetClass) ?? [];
      rows.push(row);
      out.set(row.assetClass, rows);
    }
    return Array.from(out.entries());
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 p-1 rounded-md" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          {ASSET_CLASSES.map((a) => (
            <button
              key={a}
              onClick={() => setAssetClass(a)}
              className="px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer"
              style={{
                background: assetClass === a ? "#2563eb" : "transparent",
                color: assetClass === a ? "#fff" : "var(--muted)",
              }}
            >
              {a}
            </button>
          ))}
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
          className="px-3 py-1.5 text-xs rounded-md"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
        >
          {PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <label className="text-xs flex items-center gap-2" style={{ color: "var(--muted)" }}>
          Target vol
          <input
            type="number"
            min="0.02"
            max="0.60"
            step="0.01"
            value={targetVol}
            onChange={(e) => setTargetVol(Number(e.target.value))}
            className="w-20 px-2 py-1.5 rounded-md font-mono"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
        </label>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 text-xs rounded-md disabled:opacity-50 cursor-pointer"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
        {data && (
          <span className="text-[11px]" style={{ color: "var(--muted)" }}>
            {data.rows.length} markets · as of {data.generatedAt.slice(0, 10)} · {data.method}
          </span>
        )}
      </div>

      {err && (
        <div className="p-4 rounded-md text-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid #ef4444", color: "#fca5a5" }}>
          {err}
        </div>
      )}

      {loading && !data && (
        <div className="p-8 text-center text-sm" style={{ color: "var(--muted)" }}>
          Computing model-implied CTA exposure and trigger levels...
        </div>
      )}

      {data && (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label="Markets" value={String(data.summary.markets)} />
            <StatCard label="Net Exposure" value={signed(data.summary.netExposure)} detail="-1 short / +1 long" />
            <StatCard label="Gross Exposure" value={data.summary.grossExposure.toFixed(2)} detail="average absolute exposure" />
            <StatCard label="Crowded" value={String(data.summary.crowded)} detail="abs exposure >= 0.70" />
            <StatCard label="Fragile" value={String(data.summary.fragile)} detail="+/-2% shock changes flow > 0.25" />
          </section>

          {grouped.map(([group, rows]) => (
            <section key={group} className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h2 className="text-sm font-semibold mb-3">{group}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left" style={{ color: "var(--muted)" }}>
                      <th className="py-2 pr-3">Market</th>
                      <th className="py-2 px-2 text-right">Price</th>
                      <th className="py-2 px-2 text-right">CTA</th>
                      <th className="py-2 px-2">Exposure</th>
                      <th className="py-2 px-2 text-right">1D</th>
                      <th className="py-2 px-2 text-right">5D</th>
                      <th className="py-2 px-2 text-right">-2% Flow</th>
                      <th className="py-2 px-2 text-right">+2% Flow</th>
                      <th className="py-2 px-2 text-right">De-risk</th>
                      <th className="py-2 px-2 text-right">Flip</th>
                      <th className="py-2 px-2">Classification</th>
                      <th className="py-2 px-2 text-right">-5%</th>
                      <th className="py-2 px-2 text-right">-3%</th>
                      <th className="py-2 px-2 text-right">+3%</th>
                      <th className="py-2 px-2 text-right">+5%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <Fragment key={row.code}>
                        <tr
                          onClick={() => setExpanded(expanded === row.code ? null : row.code)}
                          className="cursor-pointer"
                          style={{ borderTop: "1px solid var(--border)" }}
                        >
                          <td className="py-2 pr-3">
                            <div className="font-semibold">{row.code}</div>
                            <div className="text-[11px]" style={{ color: "var(--muted)" }}>{row.name} · {row.asOf}</div>
                          </td>
                          <td className="py-2 px-2 text-right font-mono">{row.price.toFixed(row.price > 100 ? 1 : 3)}</td>
                          <td className="py-2 px-2 text-right font-mono font-bold" style={{ color: exposureColor(row.finalCta) }}>{signed(row.finalCta)}</td>
                          <td className="py-2 px-2 min-w-28"><ExposureBar value={row.finalCta} /></td>
                          <td className="py-2 px-2 text-right font-mono" style={{ color: flowColor(row.oneDayChange) }}>{signed(row.oneDayChange)}</td>
                          <td className="py-2 px-2 text-right font-mono" style={{ color: flowColor(row.fiveDayChange) }}>{signed(row.fiveDayChange)}</td>
                          <td className="py-2 px-2 text-right font-mono" style={{ color: flowColor(row.flowDown2Pct) }}>{signed(row.flowDown2Pct)}</td>
                          <td className="py-2 px-2 text-right font-mono" style={{ color: flowColor(row.flowUp2Pct) }}>{signed(row.flowUp2Pct)}</td>
                          <td className="py-2 px-2 text-right font-mono">{pct(row.deriskShock)}</td>
                          <td className="py-2 px-2 text-right font-mono">{pct(row.flipShock)}</td>
                          <td className="py-2 px-2">{row.classification}</td>
                          <ShockCell row={row} shock="-5%" />
                          <ShockCell row={row} shock="-3%" />
                          <ShockCell row={row} shock="+3%" />
                          <ShockCell row={row} shock="+5%" />
                        </tr>
                        {expanded === row.code && (
                          <tr style={{ borderTop: "1px solid var(--border)" }}>
                            <td colSpan={15} className="py-3">
                              <RowDetail row={row} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          {!!data.errors.length && (
            <section className="rounded-lg p-4 text-xs" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h2 className="text-sm font-semibold mb-2">Unavailable Markets</h2>
              {data.errors.map((e) => (
                <div key={e.code} style={{ color: "var(--muted)" }}>{e.code} ({e.ticker}): {e.error}</div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
