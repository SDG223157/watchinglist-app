"use client";

import { useState } from "react";
import type { HeatmapRow } from "@/lib/db";

function returnColor(val: number | null): string {
  if (val == null) return "var(--card)";
  if (val >= 30) return "#166534";
  if (val >= 15) return "#15803d";
  if (val >= 5) return "#22c55e33";
  if (val >= 0) return "#22c55e18";
  if (val >= -5) return "#ef444418";
  if (val >= -15) return "#ef444433";
  if (val >= -30) return "#dc2626";
  return "#991b1b";
}

function returnText(val: number | null): string {
  if (val == null) return "—";
  const sign = val >= 0 ? "+" : "";
  return `${sign}${val.toFixed(1)}%`;
}

function MomentumBadge({ m }: { m: string | null }) {
  if (!m) return null;
  const lower = m.toLowerCase();
  let color = "var(--muted)";
  if (lower.includes("accel")) color = "var(--green)";
  if (lower.includes("decel")) color = "var(--red)";
  return (
    <span className="text-[10px] font-medium" style={{ color }}>
      {m}
    </span>
  );
}

type Period = "return_3m" | "return_6m" | "return_12m";

interface Props {
  sectors: HeatmapRow[];
  industries: HeatmapRow[];
  universe: string;
  reportDate: string | null;
}

export function HeatmapGrid({ sectors, industries, universe, reportDate }: Props) {
  const [period, setPeriod] = useState<Period>("return_12m");
  const periodLabels: Record<Period, string> = {
    return_3m: "3M",
    return_6m: "6M",
    return_12m: "12M",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">
            {universe === "SP500" ? "S&P 500" : "HSI / HSCE / CSI 300"}
          </h2>
          {reportDate && (
            <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
              Report date: {reportDate}
            </p>
          )}
        </div>
        <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--card)" }}>
          {(["return_3m", "return_6m", "return_12m"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className="px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer"
              style={{
                background: period === p ? "var(--blue)" : "transparent",
                color: period === p ? "#fff" : "var(--muted)",
              }}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Sector Treemap Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-8">
        {sectors
          .sort((a, b) => (b[period] ?? -999) - (a[period] ?? -999))
          .map((s) => (
            <div
              key={s.name}
              className="rounded-lg p-3 transition-colors"
              style={{
                background: returnColor(s[period]),
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div className="text-xs font-bold truncate">{s.name}</div>
              <div className="text-lg font-mono font-bold mt-1">
                {returnText(s[period])}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>
                  3M:{returnText(s.return_3m)} 6M:{returnText(s.return_6m)} 12M:{returnText(s.return_12m)}
                </span>
              </div>
              <MomentumBadge m={s.momentum} />
            </div>
          ))}
      </div>

      {/* Industry Table */}
      <h3 className="text-sm font-bold mb-2 uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        Industries ({industries.length})
      </h3>
      <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-xs">
          <thead style={{ background: "var(--card)" }}>
            <tr>
              <th className="px-2 py-2 text-right w-8" style={{ color: "var(--muted)" }}>#</th>
              <th className="px-2 py-2 text-left" style={{ color: "var(--muted)" }}>Industry</th>
              <th
                className="px-2 py-2 text-right cursor-pointer"
                style={{ color: period === "return_3m" ? "var(--text)" : "var(--muted)" }}
                onClick={() => setPeriod("return_3m")}
              >
                3M {period === "return_3m" && "↓"}
              </th>
              <th
                className="px-2 py-2 text-right cursor-pointer"
                style={{ color: period === "return_6m" ? "var(--text)" : "var(--muted)" }}
                onClick={() => setPeriod("return_6m")}
              >
                6M {period === "return_6m" && "↓"}
              </th>
              <th
                className="px-2 py-2 text-right cursor-pointer"
                style={{ color: period === "return_12m" ? "var(--text)" : "var(--muted)" }}
                onClick={() => setPeriod("return_12m")}
              >
                12M {period === "return_12m" && "↓"}
              </th>
              <th className="px-2 py-2 text-right" style={{ color: "var(--muted)" }}>Shift</th>
            </tr>
          </thead>
          <tbody>
            {[...industries]
              .sort((a, b) => (b[period] ?? -999) - (a[period] ?? -999))
              .map((row, i) => (
                <tr
                  key={row.name}
                  className="border-t transition-colors hover:bg-zinc-900/60"
                  style={{ borderColor: "var(--border)" }}
                >
                  <td className="px-2 py-1.5 text-right font-mono" style={{ color: "var(--muted)" }}>
                    {i + 1}
                  </td>
                  <td className="px-2 py-1.5 max-w-64 truncate">{row.name}</td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    <span style={{ color: (row.return_3m ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
                      {returnText(row.return_3m)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    <span style={{ color: (row.return_6m ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
                      {returnText(row.return_6m)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    <span style={{ color: (row.return_12m ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
                      {returnText(row.return_12m)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono" style={{ color: "var(--muted)" }}>
                    {row.shift != null ? `${row.shift >= 0 ? "+" : ""}${row.shift.toFixed(1)}pp` : "—"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
