"use client";

import { useState } from "react";
import Link from "next/link";
import type { WatchlistStock } from "@/lib/db";

type SortKey =
  | "symbol"
  | "price"
  | "market_cap"
  | "extreme_score"
  | "green_walls"
  | "geometric_order"
  | "pe_ratio";

interface Props {
  stocks: WatchlistStock[];
}

function WallPills({ g, y, r }: { g: number; y: number; r: number }) {
  return (
    <div className="flex gap-1">
      {g > 0 && (
        <span className="wall-green rounded-md px-1.5 py-0.5 text-xs font-semibold">
          {g}G
        </span>
      )}
      {y > 0 && (
        <span className="wall-yellow rounded-md px-1.5 py-0.5 text-xs font-semibold">
          {y}Y
        </span>
      )}
      {r > 0 && (
        <span className="wall-red rounded-md px-1.5 py-0.5 text-xs font-semibold">
          {r}R
        </span>
      )}
      {g === 0 && y === 0 && r === 0 && (
        <span className="text-xs" style={{ color: "var(--muted)" }}>—</span>
      )}
    </div>
  );
}

function ExtremeBar({ score }: { score: number }) {
  const pct = Math.min((score / 20) * 100, 100);
  let color = "var(--green)";
  if (score >= 14) color = "var(--red)";
  else if (score >= 10) color = "var(--yellow)";

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono w-8 text-right">{score}</span>
      <div className="extreme-bar flex-1 min-w-12">
        <div
          className="extreme-bar-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function GeoLabel({ order }: { order: number }) {
  const labels: Record<number, { text: string; color: string }> = {
    0: { text: "Anchor", color: "var(--muted)" },
    1: { text: "Velocity", color: "var(--blue)" },
    2: { text: "Accel", color: "var(--yellow)" },
    3: { text: "Jerk", color: "var(--red)" },
  };
  const l = labels[order] || labels[0];
  return (
    <span className="text-xs font-medium" style={{ color: l.color }}>
      {order} {l.text}
    </span>
  );
}

function SignalBadge({ signal }: { signal: string }) {
  if (signal === "Open") {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold signal-open">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        Open
      </span>
    );
  }
  if (signal === "Closed") {
    return <span className="text-xs signal-closed">Closed</span>;
  }
  return (
    <span className="text-xs" style={{ color: "var(--muted)" }}>
      —
    </span>
  );
}

function formatPrice(p: number | null | undefined): string {
  if (!p) return "—";
  return p >= 1000 ? p.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : p.toFixed(2);
}

function formatMcap(m: number | null | undefined): string {
  if (!m) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(1)}T`;
  return `${m.toFixed(0)}B`;
}

function ageText(created: string): string {
  if (!created) return "—";
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}

export function WatchlistTable({ stocks: initial }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("extreme_score");
  const [sortAsc, setSortAsc] = useState(false);

  const stocks = [...initial].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    if (typeof av === "string" && typeof bv === "string")
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  function SortHeader({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) {
    const active = sortKey === k;
    return (
      <th
        className={`px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors ${className ?? ""}`}
        style={{ color: active ? "var(--text)" : "var(--muted)" }}
        onClick={() => toggleSort(k)}
      >
        {children}
        {active && <span className="ml-1">{sortAsc ? "↑" : "↓"}</span>}
      </th>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
      <table className="w-full text-sm">
        <thead style={{ background: "var(--card)" }}>
          <tr>
            <SortHeader k="symbol">Symbol</SortHeader>
            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Name
            </th>
            <SortHeader k="price" className="text-right">Price</SortHeader>
            <SortHeader k="market_cap" className="text-right">MCap</SortHeader>
            <SortHeader k="green_walls">Walls</SortHeader>
            <SortHeader k="extreme_score">Extreme</SortHeader>
            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Clock
            </th>
            <SortHeader k="geometric_order">Geo</SortHeader>
            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              TrendWise
            </th>
            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Action
            </th>
            <SortHeader k="pe_ratio" className="text-right">PE</SortHeader>
            <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Time
            </th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((s) => (
            <tr
              key={s.symbol}
              className="border-t transition-colors hover:bg-zinc-900/60"
              style={{ borderColor: "var(--border)" }}
            >
              <td className="px-3 py-3">
                <Link
                  href={`/stock/${encodeURIComponent(s.symbol)}`}
                  className="font-semibold font-mono hover:underline"
                  style={{ color: "var(--blue)" }}
                >
                  {s.symbol}
                </Link>
              </td>
              <td className="px-3 py-3 max-w-48 truncate" style={{ color: "var(--muted)" }}>
                {s.name}
              </td>
              <td className="px-3 py-3 text-right font-mono">{formatPrice(s.price)}</td>
              <td className="px-3 py-3 text-right font-mono">{formatMcap(s.market_cap)}</td>
              <td className="px-3 py-3">
                <WallPills g={s.green_walls || 0} y={s.yellow_walls || 0} r={s.red_walls || 0} />
              </td>
              <td className="px-3 py-3 min-w-28">
                <ExtremeBar score={s.extreme_score || 0} />
              </td>
              <td className="px-3 py-3 text-xs font-mono">{s.clock_position || "—"}</td>
              <td className="px-3 py-3">
                <GeoLabel order={s.geometric_order || 0} />
              </td>
              <td className="px-3 py-3">
                <SignalBadge signal={s.trend_signal || ""} />
              </td>
              <td className="px-3 py-3 text-xs max-w-32 truncate">{s.action || "—"}</td>
              <td className="px-3 py-3 text-right font-mono text-xs">
                {s.pe_ratio ? s.pe_ratio.toFixed(1) : "—"}
              </td>
              <td className="px-3 py-3 text-right text-xs" style={{ color: "var(--muted)" }}>
                {ageText(s.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
