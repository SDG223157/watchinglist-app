"use client";

import { useEffect, useState } from "react";
import type { Tier, RecipePosition, RotationDiff } from "@/lib/recipe-portfolio";

type MarketKey = "US" | "CHINA" | "HK" | "CN";

interface AllocationResponse {
  asOf: string;
  market: string;
  universeSize: number;
  topN: number;
  invested: number;
  cashReserve: number;
  leaderThreshold: number;
  capital: number;
  positions: (RecipePosition & {
    price: number;
    amount: number;
    shares: number;
  })[];
  sectorSummary: { sector: string; weight: number }[];
  tierSummary: { tier: Tier | "cash"; count: number; weight: number }[];
  rotation: RotationDiff | null;
  polymarketOverlay?: {
    lambda: number;
    symbolsWithTilt: number;
    maxAbsZ: number;
    sumAbsZWeightedPct: number;
  };
  error?: string;
}

const STORAGE_KEY_PREFIX = "recipe-portfolio-prev:";

function pct(n: number, d = 2): string {
  return `${(n * 100).toFixed(d)}%`;
}

function money(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function PolymarketBadge({
  z,
  reason,
}: {
  z: number | undefined;
  reason: string | null | undefined;
}) {
  if (z === undefined || Math.abs(z) < 0.05) return null;
  const bullish = z > 0;
  const bg = bullish ? "#15803d20" : "#b9122620";
  const fg = bullish ? "#4ade80" : "#f87171";
  const label = `${bullish ? "+" : ""}${z.toFixed(2)}`;
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold"
      style={{ background: bg, color: fg }}
      title={reason || "Polymarket tilt"}
    >
      Poly {label}
    </span>
  );
}

function PolymarketOverlayPanel({
  overlay,
}: {
  overlay: AllocationResponse["polymarketOverlay"];
}) {
  if (!overlay || overlay.symbolsWithTilt === 0) return null;
  const shadow = overlay.lambda === 0;
  const tone = shadow
    ? { border: "border-zinc-800", bg: "bg-zinc-900/40", fg: "text-zinc-400" }
    : { border: "border-sky-900", bg: "bg-sky-950/30", fg: "text-sky-300" };
  return (
    <div
      className={`rounded border ${tone.border} ${tone.bg} p-3 text-[12px] ${tone.fg} flex flex-wrap gap-x-6 gap-y-1 items-center`}
    >
      <span className="font-semibold tracking-wider uppercase text-[11px]">
        Polymarket overlay
      </span>
      <span>
        λ = <span className="font-mono">{overlay.lambda.toFixed(2)}</span>
        {shadow ? " (shadow, ignored)" : " (live)"}
      </span>
      <span>
        Tilted names:{" "}
        <span className="font-mono">{overlay.symbolsWithTilt}</span>
      </span>
      <span>
        Max |z|: <span className="font-mono">{overlay.maxAbsZ.toFixed(2)}</span>
      </span>
      <span>
        Σ |z|·w:{" "}
        <span className="font-mono">
          {overlay.sumAbsZWeightedPct.toFixed(2)}
        </span>
      </span>
    </div>
  );
}

function TierBadge({ tier }: { tier: Tier | "cash" }) {
  const map: Record<Tier | "cash", { bg: string; fg: string; label: string }> =
    {
      anchor: { bg: "#15803d20", fg: "#15803d", label: "Anchor" },
      follower: { bg: "#0369a120", fg: "#0369a1", label: "Follower" },
      tactical: { bg: "#b4530920", fg: "#b45309", label: "Tactical" },
      trim: { bg: "#71717a20", fg: "#71717a", label: "Trim" },
      cash: { bg: "#52525b20", fg: "#52525b", label: "Cash" },
    };
  const s = map[tier];
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

function RotationPanel({ rotation }: { rotation: RotationDiff | null }) {
  if (!rotation) {
    return (
      <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3 text-sm text-zinc-400">
        First run for this market — no prior allocation cached. Next run will
        show entries, exits, and drift.
      </div>
    );
  }
  const { added, retired, resized } = rotation;
  const hasChanges =
    added.length > 0 || retired.length > 0 || resized.length > 0;
  if (!hasChanges) {
    return (
      <div className="rounded border border-emerald-900 bg-emerald-950/30 p-3 text-sm text-emerald-300">
        No meaningful drift vs previous run. No rebalance action required.
      </div>
    );
  }
  return (
    <div className="rounded border border-amber-900 bg-amber-950/30 p-4 space-y-3">
      <div className="text-amber-300 text-sm font-bold tracking-wide">
        REBALANCE ALERT
      </div>
      {retired.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-amber-400/80 mb-1">
            Retire ({retired.length})
          </div>
          <div className="space-y-1 text-[13px]">
            {retired.map((r) => (
              <div key={r.ticker} className="flex gap-2">
                <span className="font-mono text-amber-300 w-20 truncate">
                  {r.ticker}
                </span>
                <span className="text-zinc-400">
                  prev {pct(r.prevWeight, 1)} →
                </span>
                <span className="text-red-400">0%</span>
                <span className="text-zinc-500 text-xs">({r.reason})</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {added.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-amber-400/80 mb-1">
            Add ({added.length})
          </div>
          <div className="flex flex-wrap gap-2 text-[13px] font-mono">
            {added.map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-200"
              >
                +{t}
              </span>
            ))}
          </div>
        </div>
      )}
      {resized.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-amber-400/80 mb-1">
            Resize (|Δ| ≥ 1pp) ({resized.length})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
            {resized.map((r) => (
              <div key={r.ticker} className="flex gap-2 items-center">
                <span className="font-mono text-zinc-200 w-20 truncate">
                  {r.ticker}
                </span>
                <span className="text-zinc-500">{pct(r.prevWeight, 1)}</span>
                <span className="text-zinc-500">→</span>
                <span className="text-zinc-200">{pct(r.newWeight, 1)}</span>
                <span
                  className={`text-xs font-semibold ${
                    r.deltaPp >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {r.deltaPp >= 0 ? "+" : ""}
                  {r.deltaPp.toFixed(1)}pp
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AllocationTable({
  data,
}: {
  data: AllocationResponse;
}) {
  return (
    <div className="overflow-x-auto rounded border border-zinc-800">
      <table className="w-full text-[12px]">
        <thead className="bg-zinc-900 text-zinc-300 text-[11px] uppercase tracking-wider">
          <tr>
            <th className="px-2 py-2 text-right">#</th>
            <th className="px-2 py-2 text-left">Ticker</th>
            <th className="px-2 py-2 text-left">Name</th>
            <th className="px-2 py-2 text-left">Sector</th>
            <th className="px-2 py-2 text-right">Score</th>
            <th className="px-2 py-2 text-right">μ post</th>
            <th className="px-2 py-2 text-right">60d</th>
            <th className="px-2 py-2 text-right">TE</th>
            <th className="px-2 py-2 text-left">Tier</th>
            <th className="px-2 py-2 text-left">Poly</th>
            <th className="px-2 py-2 text-right">Weight</th>
            <th className="px-2 py-2 text-right">$</th>
            <th className="px-2 py-2 text-right">Sh</th>
          </tr>
        </thead>
        <tbody>
          {data.positions.map((p, i) => (
            <tr
              key={p.ticker}
              className="border-t border-zinc-800 hover:bg-zinc-900/50"
            >
              <td className="px-2 py-1.5 text-right text-zinc-500">{i + 1}</td>
              <td className="px-2 py-1.5 font-mono text-zinc-200">
                {p.ticker}
              </td>
              <td className="px-2 py-1.5 text-zinc-300 max-w-[200px] truncate">
                {p.name}
              </td>
              <td className="px-2 py-1.5 text-zinc-400 text-[11px]">
                {p.sector}
              </td>
              <td className="px-2 py-1.5 text-right text-zinc-300">
                {p.score}
              </td>
              <td
                className={`px-2 py-1.5 text-right ${
                  p.posteriorMu >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {p.posteriorMu >= 0 ? "+" : ""}
                {(p.posteriorMu * 100).toFixed(1)}%
              </td>
              <td
                className={`px-2 py-1.5 text-right ${
                  p.trailing60d >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {p.trailing60d >= 0 ? "+" : ""}
                {(p.trailing60d * 100).toFixed(1)}%
              </td>
              <td className="px-2 py-1.5 text-right text-zinc-300">
                {p.leaderScore.toFixed(3)}
              </td>
              <td className="px-2 py-1.5">
                <TierBadge tier={p.tier} />
              </td>
              <td className="px-2 py-1.5">
                <PolymarketBadge
                  z={p.polymarketZ}
                  reason={p.polymarketTopReason}
                />
              </td>
              <td className="px-2 py-1.5 text-right font-semibold text-zinc-100">
                {p.weight > 0 ? pct(p.weight, 2) : "—"}
              </td>
              <td className="px-2 py-1.5 text-right text-zinc-400">
                {p.amount > 0 ? money(p.amount) : "—"}
              </td>
              <td className="px-2 py-1.5 text-right text-zinc-500">
                {p.shares > 0 ? p.shares : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectorSummary({
  data,
}: {
  data: AllocationResponse;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-zinc-400 mb-2">
          Tier mix
        </div>
        <div className="space-y-1 text-[13px]">
          {data.tierSummary.map((t) => (
            <div key={t.tier} className="flex justify-between items-center">
              <TierBadge tier={t.tier} />
              <span className="text-zinc-400">
                {t.count > 0 ? `${t.count} names · ` : ""}
                {pct(t.weight)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-zinc-400 mb-2">
          Sector mix
        </div>
        <div className="space-y-1 text-[13px]">
          {data.sectorSummary.map((s) => (
            <div key={s.sector} className="flex justify-between items-center">
              <span className="text-zinc-300">{s.sector}</span>
              <span className="text-zinc-400">{pct(s.weight)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function RecipePortfolioDashboard() {
  const [market, setMarket] = useState<MarketKey>("US");
  const [capital, setCapital] = useState(1_000_000);
  const [topN, setTopN] = useState(30);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AllocationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const storageKey = STORAGE_KEY_PREFIX + market;
      let previousHoldings: { ticker: string; weight: number; trailing60d?: number }[] | undefined;
      try {
        const cached = localStorage.getItem(storageKey);
        if (cached) previousHoldings = JSON.parse(cached);
      } catch {
        // ignore
      }
      const res = await fetch("/api/recipe-portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market, capital, topN, previousHoldings }),
      });
      if (!res.ok) {
        throw new Error(`API error ${res.status}`);
      }
      const json: AllocationResponse = await res.json();
      setData(json);
      if (json.positions.length > 0) {
        try {
          localStorage.setItem(
            storageKey,
            JSON.stringify(
              json.positions.map((p) => ({
                ticker: p.ticker,
                weight: p.weight,
                trailing60d: p.trailing60d,
              }))
            )
          );
        } catch {
          // ignore
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setData(null);
  }, [market]);

  return (
    <div className="space-y-6">
      <div className="rounded border border-zinc-800 bg-zinc-950 p-4">
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div>
            <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-1">
              Market
            </label>
            <div className="inline-flex rounded border border-zinc-700 overflow-hidden">
              {(["US", "CHINA", "HK", "CN"] as MarketKey[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMarket(m)}
                  className={`px-3 py-1.5 text-sm transition ${
                    market === m
                      ? "bg-zinc-200 text-zinc-900 font-semibold"
                      : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-1">
              Capital
            </label>
            <input
              type="number"
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value) || 0)}
              className="w-40 px-2 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-1">
              Top N
            </label>
            <input
              type="number"
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value) || 30)}
              className="w-20 px-2 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-100"
              min={10}
              max={60}
            />
          </div>
          <button
            onClick={run}
            disabled={loading}
            className="px-4 py-1.5 rounded bg-emerald-700 text-emerald-50 text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50"
          >
            {loading ? "Running…" : "Run allocation"}
          </button>
        </div>
        <div className="mt-3 text-[11px] text-zinc-500">
          Recipe-Portfolio = Bayesian prior (composite score) + Transfer
          Entropy leader score + vector Kelly with Ledoit-Wolf-shrunk
          covariance, quarter-Kelly fractionation, caps (per-name 7%, sector
          30%, correlation-cluster 20%). Previous run for this market is
          cached in your browser to compute the rotation diff.
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {data && data.positions.length === 0 && (
        <div className="rounded border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
          {data.error ||
            `No actionable allocation for ${market}. Universe size: ${data.universeSize}.`}
        </div>
      )}

      {data && data.positions.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
            <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500">
                Universe
              </div>
              <div className="text-zinc-100 text-lg font-semibold">
                {data.universeSize}
              </div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500">
                Selected
              </div>
              <div className="text-zinc-100 text-lg font-semibold">
                {data.positions.length}
              </div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500">
                Invested
              </div>
              <div className="text-emerald-400 text-lg font-semibold">
                {pct(data.invested, 1)}
              </div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500">
                Cash
              </div>
              <div className="text-zinc-300 text-lg font-semibold">
                {pct(data.cashReserve, 1)}
              </div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500">
                TE threshold
              </div>
              <div className="text-zinc-300 text-lg font-semibold">
                {data.leaderThreshold.toFixed(3)}
              </div>
            </div>
          </div>

          <PolymarketOverlayPanel overlay={data.polymarketOverlay} />
          <RotationPanel rotation={data.rotation} />
          <SectorSummary data={data} />
          <AllocationTable data={data} />
        </>
      )}
    </div>
  );
}
