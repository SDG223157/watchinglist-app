"use client";

import { useState, useEffect, useCallback } from "react";

interface BounceRow {
  ticker: string;
  name: string;
  bucket: string;
  troughClose: number;
  day1Close: number;
  latestClose: number;
  day1Pct: number;
  sinceDay1Pct: number;
  totalPct: number;
  dailyPct: number;
  days: number;
  latestDate: string;
  tier: "Alpha Leader" | "Beta Leader" | "Market" | "Laggard";
}

interface Leaderboard {
  market: "us" | "china";
  benchmarkTicker: string;
  benchmarkTotalPct: number;
  troughDate: string;
  day1Date: string;
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
  detectedAutomatically: boolean;
  us?: Leaderboard;
  china?: Leaderboard;
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
  return (
    <section className="mb-8">
      <h2 className="text-xl font-bold mb-2">{title}</h2>
      <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
        Trough {board.troughDate} → Day-1 {board.day1Date} → Latest {board.latestDate}
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
              <th className="px-3 py-2 text-right">Since D1</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Daily</th>
              <th className="px-3 py-2 text-center">Tier</th>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Playbook({ board }: { board: Leaderboard }) {
  const alpha = board.rows.filter((r) => r.tier === "Alpha Leader").slice(0, 5);
  const laggards = [...board.rows].sort((a, b) => a.totalPct - b.totalPct).slice(0, 4);

  return (
    <section className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div
        className="rounded-md p-4"
        style={{ background: "#22c55e15", border: "1px solid #22c55e40" }}
      >
        <h3 className="font-semibold mb-2" style={{ color: "#22c55e" }}>
          Overweight — Alpha Leaders
        </h3>
        {alpha.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No clear alpha leaders yet — bounce is still beta-driven.
          </p>
        ) : (
          <ul className="space-y-1 text-sm font-mono">
            {alpha.map((r) => (
              <li key={r.ticker} className="flex justify-between">
                <span>
                  <strong>{r.ticker}</strong> {r.name}
                </span>
                <span style={{ color: "#22c55e" }}>{fmtPct(r.totalPct)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        className="rounded-md p-4"
        style={{ background: "#ef444415", border: "1px solid #ef444440" }}
      >
        <h3 className="font-semibold mb-2" style={{ color: "#ef4444" }}>
          Avoid — Laggards
        </h3>
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

export function BounceDashboard() {
  const [data, setData] = useState<BounceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [trough, setTrough] = useState("");
  const [day1, setDay1] = useState("");
  const [market, setMarket] = useState<"us" | "china" | "both">("both");

  const load = useCallback(
    async (t?: string, d?: string, m?: string, refresh = false) => {
      setLoading(true);
      setErr(null);
      try {
        const p = new URLSearchParams();
        if (t) p.set("trough", t);
        if (d) p.set("day1", d);
        if (m) p.set("market", m);
        if (refresh) p.set("refresh", "1");
        const res = await fetch(`/api/bounce?${p.toString()}`);
        const j = await res.json();
        if (j.error) throw new Error(j.error);
        setData(j);
        if (j.detectedAutomatically) {
          setTrough(j.troughDate);
          setDay1(j.day1Date);
        }
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    load(undefined, undefined, "both");
  }, [load]);

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
              Market
            </label>
            <select
              value={market}
              onChange={(e) => setMarket(e.target.value as "us" | "china" | "both")}
              className="px-2 py-1 text-sm rounded-md bg-transparent"
              style={{ border: "1px solid var(--border)", color: "var(--fg)" }}
            >
              <option value="both">Both</option>
              <option value="us">US</option>
              <option value="china">China</option>
            </select>
          </div>
          <button
            onClick={() => load(trough || undefined, day1 || undefined, market)}
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
              load(undefined, undefined, market, true);
            }}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-md"
            style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            Auto-detect
          </button>
        </div>
        <p className="text-xs mt-3" style={{ color: "var(--muted)" }}>
          Leave dates blank and click Auto-detect to scan the last 45 trading days for the SPY low and first &gt;1% bounce day.
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

          <section
            className="mt-8 p-4 rounded-md text-sm"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            <h3 className="font-semibold mb-2" style={{ color: "var(--fg)" }}>
              How to read this
            </h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Alpha Leader</strong>: Day-1 return ≥1.5× benchmark or Total ≥1.5× benchmark — narrative flow, core overweight.
              </li>
              <li>
                <strong>Beta Leader</strong>: outperforming but at roughly index-beta, no alpha premium.
              </li>
              <li>
                <strong>Laggard</strong>: negative or &lt;0.5× benchmark — defensive or distribution, avoid.
              </li>
              <li>
                <strong>Cross-market sync</strong>: when US and China leaders share the same bucket (e.g. both Tech/Semis), the narrative is global = high durability.
              </li>
              <li>
                Historical analog: April 2025 Liberation Day rebound, SMH led Day-1 (+17%) AND phase (+138% through Feb 2026). Spearman rank correlation 0.79.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
