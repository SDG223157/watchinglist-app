"use client";

import { useState } from "react";
import Link from "next/link";
import type { PortfolioResult, PortfolioHolding } from "@/lib/portfolio-builder";

const MARKETS = [
  { value: "ALL", label: "All Markets" },
  { value: "US", label: "US (S&P 500)" },
  { value: "China", label: "China (HK + CSI300)" },
  { value: "HK", label: "Hong Kong" },
  { value: "CN", label: "A-Shares (CSI300)" },
];

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? "#16a34a" : score >= 65 ? "#22c55e" : score >= 50 ? "#b45309" : score >= 35 ? "#ea580c" : "#dc2626";
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold"
      style={{ background: `${color}20`, color }}
    >
      {score}
    </span>
  );
}

function MomentumBadge({ type, sw }: { type: string; sw: boolean }) {
  if (!type || type === "None") return <span className="text-zinc-500">—</span>;
  const color =
    type === "Structural" ? "#16a34a" : type === "Factor-only" ? "#b45309" : "#3b82f6";
  return (
    <span className="text-[11px] font-medium" style={{ color }}>
      {type}
      {sw && " ★"}
    </span>
  );
}

function WallComboBadge({ combo }: { combo: string }) {
  if (!combo || combo === "Mixed") return null;
  const color =
    combo === "Best Quadrant" ? "#16a34a" : combo === "Worst Quadrant" ? "#dc2626" : "#b45309";
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={{ background: `${color}15`, color }}
    >
      {combo}
    </span>
  );
}

export default function PortfolioPage() {
  const [capital, setCapital] = useState(1_000_000);
  const [market, setMarket] = useState("ALL");
  const [maxHoldings, setMaxHoldings] = useState(25);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PortfolioResult | null>(null);
  const [error, setError] = useState("");

  async function build() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capital, market, maxHoldings }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || `Failed (${res.status})`);
        return;
      }
      setResult(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  const s = result?.summary;

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-sm">
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-bold tracking-tight mt-1">Portfolio Builder</h1>
          <p className="text-xs text-zinc-500 mt-1">
            FAJ-enhanced position sizing · 5 Gravity Walls · Momentum decomposition · CAPEX quality · Transfer entropy
          </p>
        </div>
      </header>

      {/* Controls */}
      <div
        className="rounded-lg p-4 mb-6 flex flex-wrap items-end gap-4"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Capital ($)</label>
          <input
            type="number"
            value={capital}
            onChange={(e) => setCapital(Number(e.target.value))}
            className="w-40 px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white"
          />
        </div>
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Market</label>
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            className="px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white"
          >
            {MARKETS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Max Holdings</label>
          <input
            type="number"
            value={maxHoldings}
            onChange={(e) => setMaxHoldings(Number(e.target.value))}
            className="w-20 px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white"
          />
        </div>
        <button
          onClick={build}
          disabled={loading}
          className="px-5 py-2 rounded-md text-sm font-semibold transition-colors cursor-pointer hover:brightness-125 disabled:opacity-50"
          style={{ background: "#2563eb", color: "#fff" }}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Building...
            </span>
          ) : (
            "Build Portfolio"
          )}
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>

      {/* Summary Cards */}
      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
          {[
            { label: "Holdings", value: s.count },
            { label: "Invested", value: `$${fmt(s.invested)}` },
            { label: "Cash", value: `$${fmt(s.cash)} (${s.cash_pct}%)` },
            { label: "Avg Score", value: s.avg_score },
            { label: "Structural ★", value: s.structural_winners },
            { label: "Best Quadrant", value: s.best_quadrant },
            { label: "Excluded", value: s.excluded_count },
            { label: "Capital", value: `$${fmt(s.capital)}` },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-lg p-3"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            >
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{card.label}</div>
              <div className="text-lg font-bold mt-0.5">{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Sector Breakdown */}
      {s && Object.keys(s.sectors).length > 0 && (
        <div
          className="rounded-lg p-4 mb-6"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Sector Allocation</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(s.sectors).map(([sec, wt]) => (
              <div key={sec} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: "#2563eb" }} />
                <span className="text-xs">
                  {sec}: <strong>{wt.toFixed(1)}%</strong>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Holdings Table */}
      {result && result.holdings.length > 0 && (
        <div
          className="rounded-lg overflow-hidden"
          style={{ border: "1px solid var(--border)" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--card)" }}>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Symbol</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Weight</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Amount</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Shares</th>
                <th className="text-right px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Price</th>
                <th className="text-center px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Score</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Walls</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Momentum</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Wall Combo</th>
                <th className="text-left px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider">Sector</th>
              </tr>
            </thead>
            <tbody>
              {result.holdings.map((h: PortfolioHolding, i: number) => (
                <tr
                  key={h.symbol}
                  className="border-t transition-colors hover:brightness-125"
                  style={{ borderColor: "var(--border)", background: i % 2 === 0 ? "transparent" : "var(--card)" }}
                >
                  <td className="px-3 py-2 font-mono font-bold">
                    <Link href={`/stock/${h.symbol}`} className="hover:text-blue-400">
                      {h.symbol}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-400 max-w-[180px] truncate">{h.name}</td>
                  <td className="px-3 py-2 text-right font-semibold">{h.weight_pct.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right text-zinc-400">${fmt(h.amount)}</td>
                  <td className="px-3 py-2 text-right text-zinc-400">{fmt(h.shares)}</td>
                  <td className="px-3 py-2 text-right">${h.price.toFixed(2)}</td>
                  <td className="px-3 py-2 text-center"><ScoreBadge score={h.score} /></td>
                  <td className="px-3 py-2 text-xs">{h.green_walls}G</td>
                  <td className="px-3 py-2"><MomentumBadge type={h.momentum_type} sw={h.structural_winner} /></td>
                  <td className="px-3 py-2"><WallComboBadge combo={h.wall_combo} /></td>
                  <td className="px-3 py-2 text-xs text-zinc-500">{h.sector}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && result.holdings.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          No stocks passed the hard gates. Try relaxing criteria or adding more analyzed stocks.
        </div>
      )}
    </main>
  );
}
