"use client";

import { useState } from "react";
import Link from "next/link";
import type { WatchlistStock, HeatmapRow } from "@/lib/db";
import type { StockHeatmapContext } from "@/lib/heatmap-match";

type SortKey =
  | "symbol"
  | "price"
  | "market_cap"
  | "extreme_score"
  | "green_walls"
  | "geometric_order"
  | "clock_position"
  | "trend_signal"
  | "pe_ratio";

interface Props {
  stocks: WatchlistStock[];
  heatmapContext?: Record<string, StockHeatmapContext>;
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

function retColor(val: number | null | undefined): string {
  if (val == null) return "var(--muted)";
  return val >= 0 ? "var(--green)" : "var(--red)";
}

function retText(val: number | null | undefined): string {
  if (val == null) return "";
  const sign = val >= 0 ? "+" : "";
  return `${sign}${val.toFixed(1)}`;
}

function HeatmapMini({ row }: { row: HeatmapRow | null }) {
  if (!row) return <span className="text-[10px]" style={{ color: "var(--muted)" }}>—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium truncate max-w-28" title={row.name}>
        {row.name}
      </span>
      <div className="flex gap-1.5 font-mono text-[10px]">
        <span style={{ color: retColor(row.return_3m) }}>{retText(row.return_3m)}</span>
        <span style={{ color: retColor(row.return_6m) }}>{retText(row.return_6m)}</span>
        <span style={{ color: retColor(row.return_12m) }} className="font-semibold">
          {retText(row.return_12m)}
        </span>
      </div>
    </div>
  );
}

function MoatBadge({ width }: { width: string | null | undefined }) {
  if (!width) return <span className="text-[10px]" style={{ color: "var(--muted)" }}>—</span>;
  const w = width.toUpperCase();
  const cfg = w === "WIDE"
    ? { icon: "🏰", color: "var(--green)" }
    : w === "NARROW"
      ? { icon: "🛡️", color: "var(--yellow)" }
      : { icon: "⚠️", color: "var(--red)" };
  return (
    <span className="text-xs font-medium" style={{ color: cfg.color }}>
      {cfg.icon} {w}
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

function timeText(created: string): string {
  if (!created) return "—";
  const d = new Date(created);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

const PAGE_SIZES = [10, 20, 50, 100];

export function WatchlistTable({ stocks: initial, heatmapContext }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("extreme_score");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const signalOrder: Record<string, number> = { Open: 2, Closed: 1 };

  function clockNum(s: string | null | undefined): number {
    if (!s) return -1;
    const m = s.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  }

  const stocks = [...initial].sort((a, b) => {
    if (sortKey === "clock_position") {
      const av = clockNum(a.clock_position);
      const bv = clockNum(b.clock_position);
      return sortAsc ? av - bv : bv - av;
    }
    if (sortKey === "trend_signal") {
      const av = signalOrder[a.trend_signal] ?? 0;
      const bv = signalOrder[b.trend_signal] ?? 0;
      return sortAsc ? av - bv : bv - av;
    }
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    if (typeof av === "string" && typeof bv === "string")
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
  });

  const totalPages = Math.ceil(stocks.length / pageSize);
  const paged = stocks.slice(page * pageSize, (page + 1) * pageSize);

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
    <>
    <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
      <table className="w-full text-[15px]">
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
            <SortHeader k="clock_position">Clock</SortHeader>
            <SortHeader k="geometric_order">Geo</SortHeader>
            <SortHeader k="trend_signal">TrendWise</SortHeader>
            {heatmapContext && (
              <>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                  Sector
                  <span className="block text-[9px] font-normal opacity-60">3M / 6M / 12M</span>
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                  Industry
                  <span className="block text-[9px] font-normal opacity-60">3M / 6M / 12M</span>
                </th>
              </>
            )}
            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Moat
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
          {paged.map((s) => {
            const hm = heatmapContext?.[s.symbol];
            return (
              <tr
                key={s.symbol}
                className="border-t transition-colors hover:bg-zinc-900/60"
                style={{ borderColor: "var(--border)" }}
              >
                <td className="px-3 py-4">
                  <Link
                    href={`/stock/${encodeURIComponent(s.symbol)}`}
                    className="font-semibold font-mono hover:underline"
                    style={{ color: "var(--blue)" }}
                  >
                    {s.symbol}
                  </Link>
                </td>
                <td className="px-3 py-4 max-w-48 truncate" style={{ color: "var(--muted)" }}>
                  {s.name}
                </td>
                <td className="px-3 py-4 text-right font-mono">{formatPrice(s.price)}</td>
                <td className="px-3 py-4 text-right font-mono">{formatMcap(s.market_cap)}</td>
                <td className="px-3 py-4">
                  <WallPills g={s.green_walls || 0} y={s.yellow_walls || 0} r={s.red_walls || 0} />
                </td>
                <td className="px-3 py-4 min-w-28">
                  <ExtremeBar score={s.extreme_score || 0} />
                </td>
                <td className="px-3 py-4 text-sm font-mono">{s.clock_position || "—"}</td>
                <td className="px-3 py-4">
                  <GeoLabel order={s.geometric_order || 0} />
                </td>
                <td className="px-3 py-4">
                  <SignalBadge signal={s.trend_signal || ""} />
                </td>
                {heatmapContext && (
                  <>
                    <td className="px-3 py-4">
                      <HeatmapMini row={hm?.sector ?? null} />
                    </td>
                    <td className="px-3 py-4">
                      <HeatmapMini row={hm?.industry ?? null} />
                    </td>
                  </>
                )}
                <td className="px-3 py-4">
                  <MoatBadge width={s.moat_width} />
                </td>
                <td className="px-3 py-4 text-sm max-w-32 truncate">{s.action || "—"}</td>
                <td className="px-3 py-4 text-right font-mono text-sm">
                  {s.pe_ratio ? s.pe_ratio.toFixed(1) : "—"}
                </td>
                <td className="px-3 py-4 text-right text-sm" style={{ color: "var(--muted)" }}>
                  {timeText(s.created_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {/* Pagination */}
    <div className="flex items-center justify-between mt-3 text-xs" style={{ color: "var(--muted)" }}>
      <div className="flex items-center gap-2">
        <span>{stocks.length} stocks</span>
        <span>·</span>
        <select
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
          className="rounded px-2 py-1 text-xs cursor-pointer outline-none"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>{s} per page</option>
          ))}
        </select>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="px-2 py-1 rounded cursor-pointer disabled:opacity-30"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            ← Prev
          </button>
          <span>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="px-2 py-1 rounded cursor-pointer disabled:opacity-30"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
    </>
  );
}
