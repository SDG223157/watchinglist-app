"use client";

import { useEffect, useState, useCallback } from "react";

type Regime = "COLLAPSE" | "COMPRESSED" | "NORMAL" | "DIVERSE" | "MAX_DISPERSION";
type Tilt = "MOMENTUM" | "MOMENTUM_FADING" | "MILD_MOMENTUM" | "NEUTRAL_DEFENSIVE" | "REVERSION";

interface Tilts {
  date: string;
  entropy_regime: Regime;
  entropy_pctile: number;
  dispersion_pctile: number;
  regime_streak_days: number;
  mean_30d_return_pct: number;
  dispersion_pct: number;
  frac_positive: number;
  tilt: Tilt;
  rationale: string;
  conditional_expected_spread_pct: number | null;
  conditional_hit_rate_pct: number | null;
  conditional_n_observations: number;
}

interface ConditionalRow {
  regime: Regime;
  count: number;
  mean_spread: number;
  median_spread: number;
  hit_rate: number;
  mean_rho: number;
}

interface DecileStock { symbol: string; past_return_pct: number; last_price: number; }

interface AnnotatedRow {
  date: string;
  n_stocks: number;
  mean: number;
  std: number;
  entropy: number;
  entropy_pctile: number;
  regime: Regime;
  regime_streak: number;
}

interface RegimeResult {
  universe_label: string;
  signal_window: number;
  horizon: number;
  years: number;
  n_requested: number;
  n_resolved: number;
  computed_at: string;
  tilt: Tilts;
  conditional: ConditionalRow[];
  top_decile: DecileStock[];
  bot_decile: DecileStock[];
  last10: AnnotatedRow[];
  source?: string;
  error?: string;
  detail?: string;
}

type MarketKey = "us" | "hk" | "cn" | "all";

const MARKETS: { key: MarketKey; label: string }[] = [
  { key: "us", label: "US" },
  { key: "hk", label: "HK" },
  { key: "cn", label: "CN" },
  { key: "all", label: "All" },
];

const REGIME_COLOR: Record<Regime, string> = {
  COLLAPSE: "#ef4444",
  COMPRESSED: "#10b981",
  NORMAL: "#64748b",
  DIVERSE: "#f59e0b",
  MAX_DISPERSION: "#e11d48",
};

const TILT_COLOR: Record<Tilt, string> = {
  MOMENTUM: "#10b981",
  MOMENTUM_FADING: "#f59e0b",
  MILD_MOMENTUM: "#60a5fa",
  NEUTRAL_DEFENSIVE: "#94a3b8",
  REVERSION: "#e11d48",
};

function fmtDate(d: string): string {
  return d.split("T")[0];
}
function sign(v: number): string { return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2); }

export function RegimeDashboard() {
  const [market, setMarket] = useState<MarketKey>("us");
  const [data, setData] = useState<RegimeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (m: MarketKey, refresh = false) => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ market: m });
      if (refresh) qs.set("refresh", "1");
      const r = await fetch(`/api/regime?${qs.toString()}`);
      const j: RegimeResult = await r.json();
      if (!r.ok || j.error) {
        setErr(j.error || `HTTP ${r.status}`);
        setData(null);
      } else {
        setData(j);
      }
    } catch (e) {
      setErr(String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(market); }, [market, load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 p-1 rounded-md" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          {MARKETS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMarket(m.key)}
              className="px-3 py-1.5 text-xs font-medium rounded transition-colors"
              style={{
                background: market === m.key ? "#2563eb" : "transparent",
                color: market === m.key ? "#fff" : "var(--muted)",
              }}
            >{m.label}</button>
          ))}
        </div>
        <button
          onClick={() => load(market, true)}
          disabled={loading}
          className="px-3 py-1.5 text-xs rounded-md disabled:opacity-50"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
        >{loading ? "Loading…" : "Refresh"}</button>
        {data && (
          <span className="text-[11px]" style={{ color: "var(--muted)" }}>
            {data.n_resolved}/{data.n_requested} resolved · {data.signal_window}d signal · {data.horizon}d horizon ·
            as of {fmtDate(data.tilt.date)} · source: {data.source ?? "live"}
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
          Computing cross-sectional entropy + momentum across the watchlist…
        </div>
      )}

      {data && (
        <>
          <RegimeCard tilt={data.tilt} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ConditionalTable rows={data.conditional} currentRegime={data.tilt.entropy_regime} />
            <RecentTable rows={data.last10} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DecileTable title="Top decile — 30d winners" rows={data.top_decile} positive />
            <DecileTable title="Bottom decile — 30d losers" rows={data.bot_decile} positive={false} />
          </div>
        </>
      )}
    </div>
  );
}

function RegimeCard({ tilt }: { tilt: Tilts }) {
  const rColor = REGIME_COLOR[tilt.entropy_regime];
  const tColor = TILT_COLOR[tilt.tilt];
  return (
    <section
      className="rounded-lg p-6 grid grid-cols-1 md:grid-cols-4 gap-6"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div>
        <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Entropy Regime</div>
        <div className="text-2xl font-bold" style={{ color: rColor }}>{tilt.entropy_regime}</div>
        <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>
          {tilt.regime_streak_days}d streak · {tilt.entropy_pctile.toFixed(0)}th pctile
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Tilt</div>
        <div className="text-2xl font-bold" style={{ color: tColor }}>{tilt.tilt.replace(/_/g, " ")}</div>
        {tilt.conditional_expected_spread_pct != null && (
          <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>
            {tilt.conditional_n_observations}-obs base rate:
            {" "}E[spread] {sign(tilt.conditional_expected_spread_pct)}% · hit {tilt.conditional_hit_rate_pct?.toFixed(0)}%
          </div>
        )}
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>30d Mean Return</div>
        <div className="text-2xl font-bold" style={{ color: tilt.mean_30d_return_pct >= 0 ? "#10b981" : "#ef4444" }}>
          {sign(tilt.mean_30d_return_pct)}%
        </div>
        <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>
          {tilt.frac_positive.toFixed(0)}% positive · dispersion {tilt.dispersion_pct.toFixed(2)}%
        </div>
      </div>

      <div className="md:col-span-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Rationale</div>
        <div className="text-sm">{tilt.rationale}</div>
      </div>
    </section>
  );
}

function ConditionalTable({ rows, currentRegime }: { rows: ConditionalRow[]; currentRegime: Regime }) {
  return (
    <section className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <h2 className="text-sm font-semibold mb-3">Conditional Base Rates — {rows[0]?.count || 0}d momentum lookback</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left" style={{ color: "var(--muted)" }}>
              <th className="py-2 pr-3">Regime</th>
              <th className="py-2 pr-3 text-right">N</th>
              <th className="py-2 pr-3 text-right">E[spread]</th>
              <th className="py-2 pr-3 text-right">Median</th>
              <th className="py-2 pr-3 text-right">Hit Rate</th>
              <th className="py-2 pr-3 text-right">Spearman ρ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const highlight = r.regime === currentRegime;
              return (
                <tr key={r.regime} style={{ borderTop: "1px solid var(--border)", background: highlight ? "rgba(37,99,235,0.06)" : undefined }}>
                  <td className="py-2 pr-3 font-medium" style={{ color: REGIME_COLOR[r.regime] }}>{r.regime}</td>
                  <td className="py-2 pr-3 text-right font-mono">{r.count}</td>
                  <td className="py-2 pr-3 text-right font-mono" style={{ color: r.mean_spread >= 0 ? "#10b981" : "#ef4444" }}>
                    {sign(r.mean_spread * 100)}%
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">{sign(r.median_spread * 100)}%</td>
                  <td className="py-2 pr-3 text-right font-mono">{(r.hit_rate * 100).toFixed(0)}%</td>
                  <td className="py-2 pr-3 text-right font-mono">{r.mean_rho.toFixed(3)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px]" style={{ color: "var(--muted)" }}>
        Spread = mean forward return of top decile winners minus bottom decile losers. Positive = momentum; negative = reversion.
      </p>
    </section>
  );
}

function RecentTable({ rows }: { rows: AnnotatedRow[] }) {
  return (
    <section className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <h2 className="text-sm font-semibold mb-3">Recent 10 Days</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left" style={{ color: "var(--muted)" }}>
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3 text-right">Mean 30d</th>
              <th className="py-2 pr-3 text-right">Disp</th>
              <th className="py-2 pr-3 text-right">Entropy</th>
              <th className="py-2 pr-3 text-right">Pctile</th>
              <th className="py-2 pr-3">Regime</th>
              <th className="py-2 pr-3 text-right">Streak</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="py-2 pr-3 font-mono">{fmtDate(r.date)}</td>
                <td className="py-2 pr-3 text-right font-mono" style={{ color: r.mean >= 0 ? "#10b981" : "#ef4444" }}>
                  {sign(r.mean * 100)}%
                </td>
                <td className="py-2 pr-3 text-right font-mono">{(r.std * 100).toFixed(2)}%</td>
                <td className="py-2 pr-3 text-right font-mono">{r.entropy.toFixed(3)}</td>
                <td className="py-2 pr-3 text-right font-mono">{r.entropy_pctile.toFixed(0)}</td>
                <td className="py-2 pr-3 text-[11px] font-medium" style={{ color: REGIME_COLOR[r.regime] }}>{r.regime}</td>
                <td className="py-2 pr-3 text-right font-mono">{r.regime_streak}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DecileTable({ title, rows, positive }: { title: string; rows: DecileStock[]; positive: boolean }) {
  const color = positive ? "#10b981" : "#ef4444";
  return (
    <section className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <h2 className="text-sm font-semibold mb-3">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left" style={{ color: "var(--muted)" }}>
              <th className="py-2 pr-3">Symbol</th>
              <th className="py-2 pr-3 text-right">30d Return</th>
              <th className="py-2 pr-3 text-right">Last Px</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="py-2 pr-3 font-medium">
                  <a href={`/stock/${encodeURIComponent(r.symbol)}`} className="hover:underline">{r.symbol}</a>
                </td>
                <td className="py-2 pr-3 text-right font-mono" style={{ color }}>{sign(r.past_return_pct)}%</td>
                <td className="py-2 pr-3 text-right font-mono">{r.last_price.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
