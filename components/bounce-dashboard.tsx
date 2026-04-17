"use client";

import { useState, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface BounceRow {
  ticker: string;
  name: string;
  bucket: string;
  troughClose: number;
  day1Close: number;
  week1Close: number | null;
  latestClose: number;
  day1Pct: number;
  week1Pct: number | null;
  sinceDay1Pct: number;
  totalPct: number;
  dailyPct: number;
  days: number;
  latestDate: string;
  tier: "Alpha Leader" | "Beta Leader" | "Market" | "Laggard";
  agreement?: "BOTH" | "DAY1_ONLY" | "WEEK1_ONLY" | "NEITHER";
}

interface Leaderboard {
  market: "us" | "china" | "qdii";
  benchmarkTicker: string;
  benchmarkTotalPct: number;
  troughDate: string;
  day1Date: string;
  week1Date: string | null;
  latestDate: string;
  rows: BounceRow[];
}

interface CrossSync {
  usLeader: string;
  chinaLeader: string;
  usLaggard: string;
  chinaLaggard: string;
  synchronized: boolean;
  narrative: string;
}

interface BounceResult {
  troughDate: string;
  day1Date: string;
  endDate?: string;
  daysRequested?: number;
  detectedAutomatically: boolean;
  us?: Leaderboard;
  china?: Leaderboard;
  qdii?: Leaderboard;
  crossMarketSync?: CrossSync;
  computedAt: string;
  source?: string;
}

const TIER_COLORS: Record<string, string> = {
  "Alpha Leader": "#22c55e",
  "Beta Leader": "#84cc16",
  Market: "#a1a1aa",
  Laggard: "#ef4444",
};

// Agreement badge — DESCRIPTIVE, NOT PREDICTIVE.
// FAJ paper (paper_v2.md) tests this intersection rule explicitly and finds
// BOTH does NOT produce higher forward returns than DAY1_ONLY (Δ = −0.66pp at
// fwd-60d, p = 0.66). Labels retained because they are useful for regime
// description — but the badge is no longer framed as a conviction multiplier.
const AGREEMENT_STYLE: Record<string, { bg: string; fg: string; label: string; title: string }> = {
  BOTH: {
    bg: "#3b82f6",
    fg: "#fff",
    label: "D1+W1",
    title:
      "Top-tercile by both Day-1 and Week-1. DESCRIPTIVE of structural hierarchy intact — NOT an alpha signal. FAJ paper v2 Section 7 falsifies the claim that this intersection produces higher forward returns than Day-1 alone.",
  },
  DAY1_ONLY: {
    bg: "#eab308",
    fg: "#000",
    label: "D1 only",
    title:
      "Led on Day-1 but not in Week-1 top tercile. Descriptive of short-cover-driven Day-1 moves; forward returns empirically no worse than BOTH tag (paper v2 Section 7.2).",
  },
  WEEK1_ONLY: {
    bg: "#8b5cf6",
    fg: "#fff",
    label: "W1 only",
    title:
      "Not in Day-1 top but entered Week-1 top. Descriptive of late-cycle leadership consolidation; no statistically significant forward alpha.",
  },
  NEITHER: {
    bg: "transparent",
    fg: "transparent",
    label: "",
    title: "",
  },
};

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function returnColor(n: number): string {
  if (n >= 15) return "#22c55e";
  if (n >= 5) return "#84cc16";
  if (n >= 0) return "#a1a1aa";
  if (n >= -5) return "#f97316";
  return "#ef4444";
}

function LeaderboardTable({ board, title }: { board: Leaderboard; title: string }) {
  const hasWeek1 = board.rows.some((r) => r.week1Pct != null);
  return (
    <section className="mb-8">
      <h2 className="text-xl font-bold mb-2">{title}</h2>
      <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
        Trough {board.troughDate} → Day-1 {board.day1Date}
        {board.week1Date && ` → Week-1 ${board.week1Date}`}
        &nbsp;→ Latest {board.latestDate}
        &nbsp;·&nbsp; Benchmark: {board.benchmarkTicker} ({fmtPct(board.benchmarkTotalPct)})
      </p>
      <div
        className="overflow-x-auto rounded-md"
        style={{ border: "1px solid var(--border)" }}
      >
        <table className="w-full text-sm" style={{ fontFamily: "JetBrains Mono, monospace" }}>
          <thead style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
            <tr style={{ color: "var(--muted)" }}>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Ticker</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Bucket</th>
              <th className="px-3 py-2 text-right">Day1</th>
              {hasWeek1 && <th className="px-3 py-2 text-right">Week1</th>}
              <th className="px-3 py-2 text-right">Since D1</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Daily</th>
              <th className="px-3 py-2 text-center">Tier</th>
              {hasWeek1 && <th className="px-3 py-2 text-center">Agreement</th>}
            </tr>
          </thead>
          <tbody>
            {board.rows.map((r, i) => (
              <tr
                key={r.ticker}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <td className="px-3 py-2" style={{ color: "var(--muted)" }}>{i + 1}</td>
                <td className="px-3 py-2 font-semibold">{r.ticker}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2" style={{ color: "var(--muted)" }}>{r.bucket}</td>
                <td className="px-3 py-2 text-right" style={{ color: returnColor(r.day1Pct) }}>
                  {fmtPct(r.day1Pct)}
                </td>
                {hasWeek1 && (
                  <td
                    className="px-3 py-2 text-right"
                    style={{ color: r.week1Pct == null ? "var(--muted)" : returnColor(r.week1Pct) }}
                  >
                    {r.week1Pct == null ? "—" : fmtPct(r.week1Pct)}
                  </td>
                )}
                <td className="px-3 py-2 text-right" style={{ color: returnColor(r.sinceDay1Pct) }}>
                  {fmtPct(r.sinceDay1Pct)}
                </td>
                <td
                  className="px-3 py-2 text-right font-bold"
                  style={{ color: returnColor(r.totalPct) }}
                >
                  {fmtPct(r.totalPct)}
                </td>
                <td className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>
                  {fmtPct(r.dailyPct)}
                </td>
                <td className="px-3 py-2 text-center">
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded"
                    style={{
                      background: `${TIER_COLORS[r.tier]}20`,
                      color: TIER_COLORS[r.tier],
                      border: `1px solid ${TIER_COLORS[r.tier]}40`,
                    }}
                  >
                    {r.tier}
                  </span>
                </td>
                {hasWeek1 && (
                  <td className="px-3 py-2 text-center">
                    {r.agreement && r.agreement !== "NEITHER" && (
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded"
                        title={AGREEMENT_STYLE[r.agreement].title}
                        style={{
                          background: AGREEMENT_STYLE[r.agreement].bg,
                          color: AGREEMENT_STYLE[r.agreement].fg,
                        }}
                      >
                        {AGREEMENT_STYLE[r.agreement].label}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Playbook({ board }: { board: Leaderboard }) {
  // Structural winners (descriptive): top 5 by Total return, not a forward-alpha claim
  const structural = [...board.rows].sort((a, b) => b.totalPct - a.totalPct).slice(0, 5);
  const laggards = [...board.rows].sort((a, b) => a.totalPct - b.totalPct).slice(0, 4);

  return (
    <section className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div
        className="rounded-md p-4"
        style={{ background: "#3b82f615", border: "1px solid #3b82f640" }}
      >
        <h3 className="font-semibold mb-2" style={{ color: "#3b82f6" }}>
          Structural Winners (descriptive)
        </h3>
        <p className="text-xs mb-2" style={{ color: "var(--muted)" }}>
          Top sectors by total return. <strong>Descriptive of beta/growth hierarchy</strong>,
          not a forward-return alpha claim. FAJ paper v2 shows no event-level predictive
          power out-of-sample — use as passive tilt input, not as active signal.
        </p>
        <ul className="space-y-1 text-sm font-mono">
          {structural.map((r) => (
            <li key={r.ticker} className="flex justify-between">
              <span>
                <strong>{r.ticker}</strong> {r.name}
                {r.agreement && r.agreement !== "NEITHER" && (
                  <span
                    className="ml-2 text-[10px] px-1 rounded"
                    style={{
                      background: AGREEMENT_STYLE[r.agreement].bg,
                      color: AGREEMENT_STYLE[r.agreement].fg,
                    }}
                  >
                    {AGREEMENT_STYLE[r.agreement].label}
                  </span>
                )}
              </span>
              <span style={{ color: "#3b82f6" }}>
                {r.week1Pct != null
                  ? `D1 ${fmtPct(r.day1Pct)} · W1 ${fmtPct(r.week1Pct)}`
                  : fmtPct(r.totalPct)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div
        className="rounded-md p-4"
        style={{ background: "#ef444415", border: "1px solid #ef444440" }}
      >
        <h3 className="font-semibold mb-2" style={{ color: "#ef4444" }}>
          Laggards (descriptive)
        </h3>
        <p className="text-xs mb-2" style={{ color: "var(--muted)" }}>
          Bottom sectors by total return. Typically defensives in bull regimes; structural
          winners in bear regimes. Avoid as passive underweights, not as active shorts.
        </p>
        <ul className="space-y-1 text-sm font-mono">
          {laggards.map((r) => (
            <li key={r.ticker} className="flex justify-between">
              <span>
                <strong>{r.ticker}</strong> {r.name}
              </span>
              <span style={{ color: "#ef4444" }}>{fmtPct(r.totalPct)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SyncCard({ sync }: { sync: CrossSync }) {
  const color = sync.synchronized ? "#22c55e" : "#eab308";
  return (
    <section
      className="mb-8 rounded-md p-4"
      style={{ background: `${color}15`, border: `1px solid ${color}40` }}
    >
      <h3 className="font-semibold mb-2" style={{ color }}>
        Cross-Market Leadership {sync.synchronized ? "✓ Synchronized" : "⚠ Diverged"}
      </h3>
      <p className="text-sm mb-3 italic" style={{ color: "var(--muted)" }}>
        {sync.narrative}
      </p>
      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
        <div>
          <div className="opacity-60 mb-1">US Leader</div>
          <div className="font-semibold">{sync.usLeader}</div>
        </div>
        <div>
          <div className="opacity-60 mb-1">China Leader</div>
          <div className="font-semibold">{sync.chinaLeader}</div>
        </div>
        <div>
          <div className="opacity-60 mb-1">US Laggard</div>
          <div className="font-semibold">{sync.usLaggard}</div>
        </div>
        <div>
          <div className="opacity-60 mb-1">China Laggard</div>
          <div className="font-semibold">{sync.chinaLaggard}</div>
        </div>
      </div>
    </section>
  );
}

interface InsightsResponse {
  report: string;
  parsed?: {
    narrative?: string;
    durability?: "HIGH" | "MEDIUM" | "LOW";
    top_picks?: Array<{ ticker: string; thesis: string; conviction: string; size_hint?: string }>;
    avoid?: string[];
    divergences?: string[];
    risk_flags?: string[];
  };
  model?: string;
  provider?: string;
  generatedAt?: string;
  troughDate?: string;
  day1Date?: string;
  source?: string;
}

export function BounceDashboard() {
  const [data, setData] = useState<BounceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [trough, setTrough] = useState("");
  const [day1, setDay1] = useState("");
  const [endDate, setEndDate] = useState("");
  const [days, setDays] = useState<string>(""); // as string for input control
  const [market, setMarket] = useState<"us" | "china" | "qdii" | "all">("all");
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsErr, setInsightsErr] = useState<string | null>(null);

  const load = useCallback(
    async (
      t?: string,
      d?: string,
      m?: string,
      refresh = false,
      end?: string,
      dys?: string
    ) => {
      setLoading(true);
      setErr(null);
      try {
        const p = new URLSearchParams();
        if (t) p.set("trough", t);
        if (d) p.set("day1", d);
        if (m) p.set("market", m);
        if (end) p.set("end", end);
        if (dys) p.set("days", dys);
        if (refresh) p.set("refresh", "1");
        const res = await fetch(`/api/bounce?${p.toString()}`);
        const j = await res.json();
        if (j.error) throw new Error(j.error);
        setData(j);
        if (j.detectedAutomatically) {
          setTrough(j.troughDate);
          setDay1(j.day1Date);
        }
        // reflect effective endDate in input if server computed it from days
        if (j.endDate && !end) setEndDate(j.endDate);
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    load(undefined, undefined, "all");
  }, [load]);

  const generateInsights = useCallback(async (refresh = false) => {
    if (!data) return;
    setInsightsLoading(true);
    setInsightsErr(null);
    try {
      const res = await fetch("/api/bounce/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trough: data.troughDate,
          day1: data.day1Date,
          refresh,
        }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setInsights(j);
    } catch (e) {
      setInsightsErr(String(e));
    } finally {
      setInsightsLoading(false);
    }
  }, [data]);

  return (
    <div>
      <section className="mb-6 rounded-md p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--muted)" }}>
              Trough Date
            </label>
            <input
              type="date"
              value={trough}
              onChange={(e) => setTrough(e.target.value)}
              className="px-2 py-1 text-sm rounded-md bg-transparent"
              style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--muted)" }}>
              Day-1 Date
            </label>
            <input
              type="date"
              value={day1}
              onChange={(e) => setDay1(e.target.value)}
              className="px-2 py-1 text-sm rounded-md bg-transparent"
              style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--muted)" }}>
              End Date (optional)
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                if (e.target.value) setDays("");
              }}
              className="px-2 py-1 text-sm rounded-md bg-transparent"
              style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--muted)" }}>
              Days since trough
            </label>
            <input
              type="number"
              min={1}
              max={500}
              placeholder="e.g. 10"
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
                if (e.target.value) setEndDate("");
              }}
              className="px-2 py-1 text-sm rounded-md bg-transparent w-24"
              style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--muted)" }}>
              Market
            </label>
            <select
              value={market}
              onChange={(e) => setMarket(e.target.value as "us" | "china" | "qdii" | "all")}
              className="px-2 py-1 text-sm rounded-md bg-transparent"
              style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
            >
              <option value="all">All (US + China + QDII)</option>
              <option value="us">US</option>
              <option value="china">China Domestic</option>
              <option value="qdii">QDII Global Access</option>
            </select>
          </div>
          <button
            onClick={() =>
              load(
                trough || undefined,
                day1 || undefined,
                market,
                false,
                endDate || undefined,
                days || undefined
              )
            }
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-md"
            style={{ background: "var(--blue)", color: "#fff", opacity: loading ? 0.5 : 1 }}
          >
            {loading ? "Loading..." : "Run Analysis"}
          </button>
          <button
            onClick={() => {
              setTrough("");
              setDay1("");
              setEndDate("");
              setDays("");
              load(undefined, undefined, market, true);
            }}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-md"
            style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            Auto-detect
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Quick windows:
          </span>
          {[1, 5, 10, 20, 60].map((n) => (
            <button
              key={n}
              onClick={() => {
                setDays(String(n));
                setEndDate("");
                load(
                  trough || undefined,
                  day1 || undefined,
                  market,
                  false,
                  undefined,
                  String(n)
                );
              }}
              disabled={loading}
              className="px-2 py-0.5 text-xs rounded-md"
              style={{
                background:
                  days === String(n) ? "var(--blue)" : "var(--card)",
                border: "1px solid var(--border)",
                color: days === String(n) ? "#fff" : "var(--muted)",
              }}
            >
              {n}d
            </button>
          ))}
          <button
            onClick={() => {
              setDays("");
              setEndDate("");
              load(trough || undefined, day1 || undefined, market, false);
            }}
            disabled={loading}
            className="px-2 py-0.5 text-xs rounded-md"
            style={{
              background: !days && !endDate ? "var(--blue)" : "var(--card)",
              border: "1px solid var(--border)",
              color: !days && !endDate ? "#fff" : "var(--muted)",
            }}
          >
            Latest
          </button>
        </div>
        <p className="text-xs mt-3" style={{ color: "var(--muted)" }}>
          Leave dates blank and click Auto-detect to scan the last 45 trading days for the SPY low and first &gt;1% bounce day.
          Use End Date or Days-since-trough to scope the period return (e.g. &quot;first 10 days of the bounce&quot;).
        </p>
      </section>

      {err && (
        <div
          className="mb-4 p-3 rounded-md text-sm"
          style={{ background: "#ef444415", border: "1px solid #ef444440", color: "#ef4444" }}
        >
          {err}
        </div>
      )}

      {loading && !data && (
        <div className="text-center py-12" style={{ color: "var(--muted)" }}>
          Loading bounce analysis...
        </div>
      )}

      {data && (
        <>
          <section className="mb-6 flex flex-wrap gap-4 text-sm" style={{ color: "var(--muted)" }}>
            <div>
              <span className="opacity-60">Trough:</span>{" "}
              <span className="font-mono font-semibold" style={{ color: "var(--fg)" }}>
                {data.troughDate}
              </span>
            </div>
            <div>
              <span className="opacity-60">Day-1:</span>{" "}
              <span className="font-mono font-semibold" style={{ color: "var(--fg)" }}>
                {data.day1Date}
              </span>
            </div>
            {data.endDate && (
              <div>
                <span className="opacity-60">End:</span>{" "}
                <span className="font-mono font-semibold" style={{ color: "var(--fg)" }}>
                  {data.endDate}
                </span>
                {data.daysRequested && (
                  <span className="opacity-60 ml-1">({data.daysRequested}d window)</span>
                )}
              </div>
            )}
            {data.detectedAutomatically && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--blue)", color: "#fff" }}>
                Auto-detected
              </span>
            )}
            {data.source && (
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  background: data.source === "cache" ? "#a1a1aa20" : "#22c55e20",
                  color: data.source === "cache" ? "#a1a1aa" : "#22c55e",
                }}
              >
                {data.source}
              </span>
            )}
          </section>

          {data.crossMarketSync && <SyncCard sync={data.crossMarketSync} />}

          {data.us && (
            <>
              <LeaderboardTable board={data.us} title="US Sector Leaderboard" />
              <Playbook board={data.us} />
            </>
          )}

          {data.china && (
            <>
              <LeaderboardTable board={data.china} title="China Sector Leaderboard" />
              <Playbook board={data.china} />
            </>
          )}

          {data.qdii && (
            <>
              <LeaderboardTable
                board={data.qdii}
                title="QDII Global Access — A-share listed ETFs tracking US/Global sectors"
              />
              <Playbook board={data.qdii} />
              <section
                className="mb-8 p-4 rounded-md text-sm"
                style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
              >
                <h3 className="font-semibold mb-2" style={{ color: "var(--fg)" }}>
                  Why QDII?
                </h3>
                <p>
                  Chinese mainland investors cannot directly buy SMH, XLK, QQQ, or other US-listed ETFs due to
                  capital controls. QDII (Qualified Domestic Institutional Investor) funds wrap foreign assets
                  into A-share tradable ETFs denominated in RMB. Use this table to find the A-share equivalent of
                  any US sector leader. Benchmark here is <strong>513500 标普500</strong> (S&P 500 QDII).
                </p>
                <p className="mt-2">
                  <strong>Examples:</strong> SMH → <code>513310</code> (中韩半导体) + <code>501225</code> (全球芯片) ·
                  XLK → <code>159509</code> (纳指科技) · XLE → <code>159518</code> (标普油气) ·
                  XBI → <code>159502</code> (标普生物科技) · GLD → <code>164701</code> (黄金LOF).
                </p>
                <p className="mt-2 text-xs opacity-75">
                  Note: QDII ETFs often trade at premiums (场内价 &gt; IOPV) due to outbound capital quotas.
                  Check IOPV premium on jisilu.cn before entering. LOF products may have sparse Yahoo data and
                  can be skipped in the ranking.
                </p>
              </section>
            </>
          )}

          <section
            className="mt-8 p-5 rounded-md"
            style={{
              background: "linear-gradient(135deg, #6366f115, #8b5cf615)",
              border: "1px solid #8b5cf640",
            }}
          >
            <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
              <div>
                <h3 className="font-bold text-lg" style={{ color: "var(--fg)" }}>
                  Cross-Market Bounce Insights
                </h3>
                <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                  GPT-5.4 analyzes US → China lead-lag patterns and produces a concrete playbook
                  for Chinese mainland investors to trade QDII + A-share sectors based on US
                  Day-1 leadership.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => generateInsights(false)}
                  disabled={insightsLoading || !data}
                  className="px-4 py-2 text-sm font-semibold rounded-md transition-colors"
                  style={{
                    background: "#8b5cf6",
                    color: "#fff",
                    opacity: insightsLoading || !data ? 0.5 : 1,
                    cursor: insightsLoading || !data ? "not-allowed" : "pointer",
                  }}
                >
                  {insightsLoading ? "Generating..." : insights ? "Regenerate" : "Generate AI Insights"}
                </button>
                {insights && (
                  <button
                    onClick={() => generateInsights(true)}
                    disabled={insightsLoading}
                    className="px-3 py-2 text-xs rounded-md"
                    style={{
                      border: "1px solid var(--border)",
                      color: "var(--muted)",
                      background: "transparent",
                    }}
                    title="Force fresh GPT-5.4 call, bypassing the 6-hour cache"
                  >
                    Refresh
                  </button>
                )}
              </div>
            </div>

            {insightsErr && (
              <div
                className="p-3 rounded-md text-sm mb-3"
                style={{
                  background: "#ef444415",
                  border: "1px solid #ef444440",
                  color: "#ef4444",
                }}
              >
                {insightsErr}
              </div>
            )}

            {insights && (
              <>
                <div className="flex flex-wrap gap-3 text-xs mb-4" style={{ color: "var(--muted)" }}>
                  {insights.model && (
                    <span
                      className="px-2 py-0.5 rounded-full"
                      style={{ background: "#8b5cf620", color: "#a78bfa" }}
                    >
                      {insights.model}
                    </span>
                  )}
                  {insights.provider && (
                    <span className="opacity-60">via {insights.provider}</span>
                  )}
                  {insights.parsed?.narrative && (
                    <span
                      className="px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: "#22c55e20", color: "#22c55e" }}
                    >
                      Narrative: {insights.parsed.narrative}
                    </span>
                  )}
                  {insights.parsed?.durability && (
                    <span
                      className="px-2 py-0.5 rounded-full font-semibold"
                      style={{
                        background:
                          insights.parsed.durability === "HIGH"
                            ? "#22c55e20"
                            : insights.parsed.durability === "MEDIUM"
                              ? "#eab30820"
                              : "#ef444420",
                        color:
                          insights.parsed.durability === "HIGH"
                            ? "#22c55e"
                            : insights.parsed.durability === "MEDIUM"
                              ? "#eab308"
                              : "#ef4444",
                      }}
                    >
                      Durability: {insights.parsed.durability}
                    </span>
                  )}
                  {insights.source && (
                    <span
                      className="px-2 py-0.5 rounded-full"
                      style={{
                        background: insights.source === "cache" ? "#a1a1aa20" : "#22c55e20",
                        color: insights.source === "cache" ? "#a1a1aa" : "#22c55e",
                      }}
                    >
                      {insights.source}
                    </span>
                  )}
                  {insights.generatedAt && (
                    <span className="opacity-60">
                      {new Date(insights.generatedAt).toLocaleString()}
                    </span>
                  )}
                </div>

                {/* Quick-scan top picks card */}
                {insights.parsed?.top_picks && insights.parsed.top_picks.length > 0 && (
                  <div
                    className="mb-4 p-3 rounded-md"
                    style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                  >
                    <h4 className="font-semibold text-sm mb-2" style={{ color: "var(--fg)" }}>
                      Top Picks (quick scan)
                    </h4>
                    <ul className="space-y-1 text-sm font-mono">
                      {insights.parsed.top_picks.slice(0, 5).map((pick, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2">
                          <span
                            className="text-xs px-1.5 py-0.5 rounded font-semibold"
                            style={{
                              background:
                                pick.conviction === "High"
                                  ? "#22c55e20"
                                  : pick.conviction === "Medium"
                                    ? "#eab30820"
                                    : "#a1a1aa20",
                              color:
                                pick.conviction === "High"
                                  ? "#22c55e"
                                  : pick.conviction === "Medium"
                                    ? "#eab308"
                                    : "#a1a1aa",
                            }}
                          >
                            {pick.conviction}
                          </span>
                          <strong>{pick.ticker}</strong>
                          <span style={{ color: "var(--muted)" }}>— {pick.thesis}</span>
                          {pick.size_hint && (
                            <span
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{ background: "var(--border)", color: "var(--muted)" }}
                            >
                              {pick.size_hint}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <article
                  className="prose prose-invert max-w-none text-sm"
                  style={{ color: "var(--fg)" }}
                >
                  <Markdown remarkPlugins={[remarkGfm]}>{insights.report}</Markdown>
                </article>
              </>
            )}

            {!insights && !insightsLoading && !insightsErr && (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                Click <strong>Generate AI Insights</strong> to have GPT-5.4 analyze the bounce
                data and produce a concrete US→China translation table, high-conviction trade
                ideas with specific A-share/QDII tickers, divergence opportunities, risk flags,
                and a day-by-day execution calendar. Results are cached for 6 hours.
              </p>
            )}
          </section>

          <section
            className="mt-8 p-4 rounded-md text-sm"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            <h3 className="font-semibold mb-2" style={{ color: "var(--fg)" }}>
              How to read this (updated per FAJ paper v2)
            </h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Day-1 %</strong>: return from trough to Day-1 close. Fast reactivity
                signal; useful for regime narrative but <strong>not a forward-return alpha
                signal at event level</strong> (paper v2 §5).
              </li>
              <li>
                <strong>Week-1 %</strong>: return from trough to 5th session. Stable
                confirmation; filters Day-1 short-cover noise. Also no forward alpha at event
                level.
              </li>
              <li>
                <strong>D1+W1 / D1 only / W1 only tags</strong>: top-tercile memberships.
                <em> Descriptive</em> of cross-sectional hierarchy — <strong>NOT a conviction
                multiplier</strong>. Paper v2 §7 tests whether D1+W1 intersection beats D1 alone
                for forward returns and finds Δ = −0.66pp (p = 0.66) — the falsification
                result. All tags show similar forward returns (~1.5–3.5% at 60d).
              </li>
              <li>
                <strong>Alpha Leader tier</strong>: identifies narrative flow at observation;
                not an actionable predictor of future alpha.
              </li>
              <li>
                <strong>Structural winners</strong> (SMH, XLK, QQQ, IWM across 67 events
                1999-2026): higher average Day-1 AND higher average 60d return. Reflects the
                known beta/growth risk premium — defensible as a passive tilt.
              </li>
              <li>
                <strong>Analog</strong>: April 2025 Liberation Day (SMH Day-1 +17%, phase
                +138%) is one of 67 events. In-sample persistence is strong, out-of-sample
                collapses. Use as anecdote, not proof of repeatable alpha.
              </li>
            </ul>
            <div
              className="mt-3 pt-3 text-xs"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <strong style={{ color: "#ef4444" }}>HONEST CAVEATS (FAJ paper v2):</strong>
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                <li>
                  <strong>In-sample ≠ out-of-sample.</strong> "From-trough" persistence (ρ̄ =
                  0.54 at 5d, 4.3% 60d L-S) collapses to the noise floor (ρ̄ ≈ 0.02–0.07) once
                  the formation return is removed from the prediction horizon. The in-sample
                  result is a mechanical artifact — the formation day&apos;s return is
                  arithmetically contained in the &ldquo;subsequent&rdquo; period.
                </li>
                <li>
                  <strong>Regime-confirmation hypothesis falsified.</strong> Only 3/67 events
                  are defensive-led; those 3 had <em>higher</em> subsequent SPY returns, not
                  lower. The &ldquo;defensives leading = bear rally&rdquo; intuition does not
                  hold at these sample sizes. Paper v2 §6.
                </li>
                <li>
                  <strong>Agreement hypothesis falsified.</strong> D1+W1 intersection does not
                  produce stronger forward returns than D1 alone (Δ = −0.66pp at fwd-60d,
                  p = 0.66). Paper v2 §7.
                </li>
                <li>
                  <strong>Cross-market transmission fails multiple-testing correction.</strong>
                  Raw T+5 p = 0.056 inflates to BH-adjusted p = 0.10 across 25 tests. Not
                  tradeable on its own.
                </li>
                <li>
                  <strong>What does survive:</strong> cross-sectional risk hierarchy (semis,
                  large-cap tech, small caps lead on average; defensives lag on average). This
                  is a known Fama-French factor story, defensible as a passive tilt — not a
                  new alpha.
                </li>
                <li>
                  Full empirical treatment at{" "}
                  <code>media/reports/papers/day1-bounce-faj/paper_v2.md</code>.
                </li>
              </ul>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
