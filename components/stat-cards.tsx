import type { WatchlistStock } from "@/lib/db";

interface Props {
  stocks: WatchlistStock[];
}

export function StatCards({ stocks }: Props) {
  const total = stocks.length;
  const avgExtreme =
    total > 0
      ? (stocks.reduce((s, x) => s + (x.extreme_score || 0), 0) / total).toFixed(1)
      : "0";
  const openSignals = stocks.filter((s) => s.trend_signal === "Open").length;
  const strong = stocks.filter((s) => (s.green_walls || 0) >= 3).length;
  const avgGeo =
    total > 0
      ? (stocks.reduce((s, x) => s + (x.geometric_order ?? 0), 0) / total).toFixed(2)
      : "0.00";

  const darCandidates = stocks.filter(
    (s) => (s.green_walls || 0) >= 4 || ((s.green_walls || 0) >= 3 && (s.moat_width || "").toUpperCase() === "WIDE")
  ).length;

  const cards = [
    { label: "Stocks", value: total, sub: "tracked" },
    { label: "Avg Extreme", value: avgExtreme, sub: "/20" },
    { label: "TrendWise Open", value: openSignals, sub: `of ${total}` },
    { label: "Strong (≥3G)", value: strong, sub: "green walls" },
    { label: "Avg GEO", value: avgGeo, sub: "order" },
    { label: "DAR Eligible", value: darCandidates, sub: "4G or 3G+WIDE" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg p-4"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            {c.label}
          </div>
          <div className="mt-1 text-2xl font-bold font-mono">{c.value}</div>
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  );
}
