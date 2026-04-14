"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Holding {
  symbol: string;
  name: string;
  sector: string;
  shares: number;
  entry_price: number;
  current_price: number;
  weight_pct: number;
  amount: number;
  pnl: number;
  pnl_pct: number;
  composite_score: number;
  hmm_regime: string;
  green_walls: number;
}

interface Portfolio {
  id: string;
  name: string;
  universe: string;
  currency: string;
  initial_capital: number;
  current_value: number;
  cash: number;
  return_pct: number;
  holdings: Holding[];
  last_rebalance: string;
}

interface Snapshot {
  snapshot_date: string;
  total_value: number;
  return_pct: number;
  cumulative_return_pct: number;
  holdings_count: number;
}

function formatCurrency(val: number, currency: string): string {
  const sym = currency === "CNY" ? "¥" : "$";
  if (Math.abs(val) >= 1_000_000) return `${sym}${(val / 1_000_000).toFixed(2)}M`;
  if (Math.abs(val) >= 1_000) return `${sym}${(val / 1_000).toFixed(1)}K`;
  return `${sym}${val.toFixed(0)}`;
}

function ReturnBadge({ pct }: { pct: number }) {
  const color = pct >= 0 ? "#10b981" : "#ef4444";
  return (
    <span className="font-mono font-bold" style={{ color }}>
      {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
    </span>
  );
}

function EquityCurve({ snapshots, currency }: { snapshots: Snapshot[]; currency: string }) {
  if (snapshots.length < 2) return null;
  const W = 600, H = 140, PAD = { top: 10, right: 10, bottom: 25, left: 50 };
  const cw = W - PAD.left - PAD.right, ch = H - PAD.top - PAD.bottom;
  const vals = snapshots.map((s) => s.total_value);
  const min = Math.min(...vals) * 0.99, max = Math.max(...vals) * 1.01;
  const range = max - min || 1;

  const points = vals.map((v, i) => ({
    x: PAD.left + (i / (vals.length - 1)) * cw,
    y: PAD.top + ch - ((v - min) / range) * ch,
  }));
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const latest = vals[vals.length - 1];
  const initial = vals[0];
  const color = latest >= initial ? "#10b981" : "#ef4444";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 140 }}>
      <defs>
        <linearGradient id="eqGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + ch - ((initial - min) / range) * ch}
        y2={PAD.top + ch - ((initial - min) / range) * ch} stroke="rgba(255,255,255,0.1)" strokeDasharray="4,4" />
      <polygon points={`${points[0].x},${PAD.top + ch} ${pathD.replace(/[ML]/g, "")} ${points[points.length - 1].x},${PAD.top + ch}`}
        fill="url(#eqGrad)" />
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill={color} />
      <text x={PAD.left - 4} y={PAD.top + 10} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="9">
        {formatCurrency(max, currency)}
      </text>
      <text x={PAD.left - 4} y={PAD.top + ch} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="9">
        {formatCurrency(min, currency)}
      </text>
    </svg>
  );
}

function PortfolioCard({ portfolio, snapshots, onRebalance, rebalancing }: {
  portfolio: Portfolio; snapshots: Snapshot[];
  onRebalance: () => void; rebalancing: boolean;
}) {
  const curr = portfolio.currency;
  const totalPnl = portfolio.current_value - portfolio.initial_capital;
  const winners = portfolio.holdings.filter((h) => h.pnl > 0).length;
  const losers = portfolio.holdings.filter((h) => h.pnl < 0).length;

  const sectorWeights: Record<string, number> = {};
  for (const h of portfolio.holdings) {
    sectorWeights[h.sector] = (sectorWeights[h.sector] || 0) + h.weight_pct;
  }
  const topSectors = Object.entries(sectorWeights).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      <div className="px-5 py-4 flex items-center justify-between" style={{ background: "var(--card)" }}>
        <div>
          <h2 className="text-lg font-bold">{portfolio.name}</h2>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {portfolio.holdings.length} stocks · {curr} · Last rebalance: {portfolio.last_rebalance ? new Date(portfolio.last_rebalance).toLocaleDateString() : "Never"}
          </span>
        </div>
        <button onClick={onRebalance} disabled={rebalancing}
          className="px-3 py-1.5 rounded text-xs font-medium transition-colors hover:brightness-125 disabled:opacity-50"
          style={{ background: "rgba(59,130,246,0.15)", color: "var(--blue)" }}>
          {rebalancing ? "Rebalancing..." : "Rebalance Now"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-5 py-4" style={{ background: "var(--card)", borderTop: "1px solid var(--border)" }}>
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>Total Value</div>
          <div className="text-xl font-mono font-bold">{formatCurrency(portfolio.current_value, curr)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>Total P&L</div>
          <div className="text-xl font-mono font-bold" style={{ color: totalPnl >= 0 ? "#10b981" : "#ef4444" }}>
            {totalPnl >= 0 ? "+" : ""}{formatCurrency(totalPnl, curr)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>Return</div>
          <div className="text-xl"><ReturnBadge pct={portfolio.return_pct} /></div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>W / L</div>
          <div className="text-xl font-mono">
            <span style={{ color: "#10b981" }}>{winners}</span>
            <span style={{ color: "var(--muted)" }}> / </span>
            <span style={{ color: "#ef4444" }}>{losers}</span>
          </div>
        </div>
      </div>

      {snapshots.length > 1 && (
        <div className="px-5 py-3" style={{ background: "var(--card)", borderTop: "1px solid var(--border)" }}>
          <EquityCurve snapshots={snapshots} currency={curr} />
        </div>
      )}

      <div className="px-5 py-3 flex flex-wrap gap-2" style={{ background: "var(--card)", borderTop: "1px solid var(--border)" }}>
        {topSectors.map(([sector, weight]) => (
          <span key={sector} className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "var(--muted)" }}>
            {sector} {weight.toFixed(1)}%
          </span>
        ))}
      </div>

      <div style={{ background: "var(--card)", borderTop: "1px solid var(--border)" }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th className="px-3 py-2 text-left" style={{ color: "var(--muted)" }}>#</th>
              <th className="px-3 py-2 text-left" style={{ color: "var(--muted)" }}>Symbol</th>
              <th className="px-3 py-2 text-left" style={{ color: "var(--muted)" }}>Sector</th>
              <th className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>Shares</th>
              <th className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>Entry</th>
              <th className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>Current</th>
              <th className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>Weight</th>
              <th className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>P&L</th>
              <th className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>Return</th>
              <th className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>Score</th>
              <th className="px-3 py-2 text-left" style={{ color: "var(--muted)" }}>HMM</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.holdings.sort((a, b) => b.amount - a.amount).map((h, i) => (
              <tr key={h.symbol} style={{ borderBottom: "1px solid var(--border)" }} className="hover:brightness-110">
                <td className="px-3 py-1.5 text-[10px]" style={{ color: "var(--muted)" }}>{i + 1}</td>
                <td className="px-3 py-1.5">
                  <Link href={`/stock/${encodeURIComponent(h.symbol)}`} className="font-mono font-bold hover:underline" style={{ color: "var(--blue)" }}>
                    {h.symbol}
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-[10px]" style={{ color: "var(--muted)" }}>{h.sector}</td>
                <td className="px-3 py-1.5 text-right font-mono">{h.shares.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right font-mono">{h.entry_price.toFixed(2)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{h.current_price.toFixed(2)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{h.weight_pct.toFixed(1)}%</td>
                <td className="px-3 py-1.5 text-right font-mono" style={{ color: h.pnl >= 0 ? "#10b981" : "#ef4444" }}>
                  {h.pnl >= 0 ? "+" : ""}{formatCurrency(h.pnl, curr)}
                </td>
                <td className="px-3 py-1.5 text-right"><ReturnBadge pct={h.pnl_pct} /></td>
                <td className="px-3 py-1.5 text-right font-mono">{h.composite_score}</td>
                <td className="px-3 py-1.5" style={{
                  color: h.hmm_regime === "Bull" ? "#10b981" : h.hmm_regime === "Bear" ? "#ef4444" : "var(--muted)"
                }}>{h.hmm_regime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SimDashboard() {
  const [usPortfolio, setUs] = useState<Portfolio | null>(null);
  const [cnPortfolio, setCn] = useState<Portfolio | null>(null);
  const [usSnapshots, setUsSnap] = useState<Snapshot[]>([]);
  const [cnSnapshots, setCnSnap] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [rebalancing, setRebalancing] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const r1 = await fetch("/api/sim-portfolio?id=sim-us");
      if (r1.ok) {
        const d = await r1.json();
        setUs(d.portfolio); setUsSnap(d.snapshots || []);
      }
      const r2 = await fetch("/api/sim-portfolio?id=sim-china");
      if (r2.ok) {
        const d = await r2.json();
        setCn(d.portfolio); setCnSnap(d.snapshots || []);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleInit = async () => {
    setInitializing(true);
    await fetch("/api/sim-portfolio", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "init" }),
    });
    await loadData();
    setInitializing(false);
  };

  const handleRebalance = async (id: string) => {
    setRebalancing(id);
    await fetch("/api/sim-portfolio", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rebalance", id }),
    });
    await loadData();
    setRebalancing(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="inline-block w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "var(--blue)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  if (!usPortfolio && !cnPortfolio) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl font-bold mb-3">No Simulation Portfolios Yet</h2>
        <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
          Initialize two portfolios: US ($1M) and China (¥1M), each with 30 stocks ranked by composite score.
        </p>
        <button onClick={handleInit} disabled={initializing}
          className="px-6 py-3 rounded-lg text-sm font-bold transition-colors hover:brightness-125 disabled:opacity-50"
          style={{ background: "var(--blue)", color: "#fff" }}>
          {initializing ? "Initializing..." : "Create Portfolios"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {usPortfolio && (
        <PortfolioCard portfolio={usPortfolio} snapshots={usSnapshots}
          onRebalance={() => handleRebalance("sim-us")} rebalancing={rebalancing === "sim-us"} />
      )}
      {cnPortfolio && (
        <PortfolioCard portfolio={cnPortfolio} snapshots={cnSnapshots}
          onRebalance={() => handleRebalance("sim-china")} rebalancing={rebalancing === "sim-china"} />
      )}
    </div>
  );
}
