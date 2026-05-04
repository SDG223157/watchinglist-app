"use client";

import { useState } from "react";
import Link from "next/link";

interface Item {
  variety_code: string;
  variety_name: string;
  exchange: string;
  multiplier: number | null;
  latest_price: number | null;
  analysis_report: string | null;
  analysis_date: string | null;
}

type SortKey = "variety_code" | "exchange" | "latest_price" | "analysis_date";

export function FuturesWatchlistTable({ items }: { items: Item[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("variety_code");
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = [...items].sort((a, b) => {
    const dir = sortAsc ? 1 : -1;
    if (sortKey === "latest_price") {
      return ((a.latest_price ?? 0) - (b.latest_price ?? 0)) * dir;
    }
    const av = String(a[sortKey] ?? "");
    const bv = String(b[sortKey] ?? "");
    return av.localeCompare(bv) * dir;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  async function handleRemove(code: string) {
    if (!confirm(`Remove ${code} from watchlist?`)) return;
    await fetch(`/api/futures/watchlist?code=${code}`, { method: "DELETE" });
    window.location.reload();
  }

  const thClass =
    "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide cursor-pointer select-none hover:brightness-125";

  if (!items.length) {
    return (
      <div className="text-center py-12" style={{ color: "var(--muted)" }}>
        No futures tracked yet. Use the search above to add varieties.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ background: "var(--card)" }}>
            <th className={thClass} onClick={() => toggleSort("variety_code")}>
              Code {sortKey === "variety_code" ? (sortAsc ? "↑" : "↓") : ""}
            </th>
            <th className={thClass}>Name</th>
            <th className={thClass} onClick={() => toggleSort("exchange")}>
              Exchange {sortKey === "exchange" ? (sortAsc ? "↑" : "↓") : ""}
            </th>
            <th className={thClass}>Multiplier</th>
            <th className={thClass} onClick={() => toggleSort("latest_price")}>
              Price {sortKey === "latest_price" ? (sortAsc ? "↑" : "↓") : ""}
            </th>
            <th className={thClass}>Analysis</th>
            <th className={thClass}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => (
            <tr
              key={item.variety_code}
              className="transition-colors hover:brightness-110"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <td className="px-3 py-3 font-bold" style={{ color: "#ffd700" }}>
                {item.variety_code}
              </td>
              <td className="px-3 py-3">{item.variety_name}</td>
              <td className="px-3 py-3 text-xs font-mono" style={{ color: "var(--muted)" }}>
                {item.exchange}
              </td>
              <td className="px-3 py-3 text-right font-mono">{item.multiplier ?? "—"}</td>
              <td className="px-3 py-3 text-right font-mono">
                {item.latest_price != null ? item.latest_price.toLocaleString() : "—"}
              </td>
              <td className="px-3 py-3 text-center">
                {item.analysis_report ? (
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: "#4CAF50" }}
                    title={`Analyzed ${item.analysis_date ?? ""}`}
                  />
                ) : (
                  <span style={{ color: "var(--muted)" }}>—</span>
                )}
              </td>
              <td className="px-3 py-3">
                <div className="flex gap-2">
                  <Link
                    href={`/futures/${item.variety_code}`}
                    className="text-xs px-2 py-1 rounded"
                    style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                  >
                    Chart
                  </Link>
                  <button
                    onClick={() => {
                      const cmd = `/futures-price-structure-analysis ${item.variety_code}`;
                      navigator.clipboard.writeText(cmd);
                      alert(`Copied to clipboard:\n\n${cmd}\n\nPaste into Claude Code to analyze ${item.variety_code}.`);
                    }}
                    className="text-xs px-2 py-1 rounded"
                    style={{ background: "#d97706", color: "#fff" }}
                  >
                    Analyze
                  </button>
                  <Link
                    href={`/futures/${item.variety_code}/analysis`}
                    className="text-xs px-2 py-1 rounded"
                    style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                  >
                    Analysis
                  </Link>
                  <button
                    onClick={() => handleRemove(item.variety_code)}
                    className="text-xs px-2 py-1 rounded hover:brightness-125"
                    style={{ color: "#ef5350" }}
                  >
                    Remove
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
