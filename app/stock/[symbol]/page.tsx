import { notFound } from "next/navigation";
import Link from "next/link";
import Markdown from "react-markdown";
import { fetchStock, fetchStockHistory } from "@/lib/db";

export const dynamic = "force-dynamic";

function WallCard({
  label,
  text,
  color,
}: {
  label: string;
  text: string;
  color: "green" | "yellow" | "red" | "muted";
}) {
  const cls =
    color === "green"
      ? "wall-green"
      : color === "yellow"
        ? "wall-yellow"
        : color === "red"
          ? "wall-red"
          : "";
  return (
    <div
      className={`rounded-lg p-4 ${cls}`}
      style={
        color === "muted"
          ? { background: "var(--card)", border: "1px solid var(--border)" }
          : {}
      }
    >
      <div className="text-xs font-semibold uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="mt-1 text-sm">{text || "—"}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      <div className="font-mono text-sm mt-0.5">{value ?? "—"}</div>
    </div>
  );
}

function wallColor(text: string | null): "green" | "yellow" | "red" | "muted" {
  if (!text) return "muted";
  const t = text.toUpperCase();
  if (t.includes("GREEN")) return "green";
  if (t.includes("YELLOW")) return "yellow";
  if (t.includes("RED")) return "red";
  return "muted";
}

export default async function StockDetail({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: rawSymbol } = await params;
  const symbol = decodeURIComponent(rawSymbol);
  const stock = await fetchStock(symbol);

  if (!stock) notFound();

  const history = await fetchStockHistory(symbol, 10);

  const geoLabels: Record<number, string> = {
    0: "Anchor",
    1: "Velocity",
    2: "Acceleration",
    3: "Jerk",
  };

  return (
    <main className="max-w-[1200px] mx-auto px-4 py-8">
      <Link
        href="/"
        className="text-sm hover:underline mb-6 inline-block"
        style={{ color: "var(--blue)" }}
      >
        ← Back to Dashboard
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">{stock.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="font-mono text-lg" style={{ color: "var(--blue)" }}>
              {stock.symbol}
            </span>
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              {stock.sector}
            </span>
          </div>
        </div>
        <div className="sm:ml-auto text-right">
          <div className="text-3xl font-mono font-bold">
            {stock.price ? stock.price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}
          </div>
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            {stock.distance_from_ath || ""}
          </div>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-4 p-5 rounded-lg mb-8"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <Metric label="Market Cap" value={stock.market_cap ? `${stock.market_cap}B` : null} />
        <Metric label="PE Ratio" value={stock.pe_ratio?.toFixed(1)} />
        <Metric label="P/B" value={stock.price_to_book?.toFixed(2)} />
        <Metric label="EV/EBITDA" value={stock.ev_ebitda?.toFixed(1)} />
        <Metric label="ROIC" value={stock.roic ? `${stock.roic}%` : null} />
        <Metric label="ROE" value={stock.roe ? `${stock.roe}%` : null} />
        <Metric label="Op. Margin" value={stock.operating_margin ? `${stock.operating_margin}%` : null} />
        <Metric label="Net Margin" value={stock.net_margin ? `${stock.net_margin}%` : null} />
        <Metric label="FCF" value={stock.fcf ? `${stock.fcf}B` : null} />
        <Metric label="D/E" value={stock.debt_to_equity?.toFixed(2)} />
        <Metric label="52W Low" value={stock.low_52w?.toFixed(2)} />
        <Metric label="52W High" value={stock.high_52w?.toFixed(2)} />
      </div>

      {/* Analysis Summary Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Clock Position
          </div>
          <div className="text-xl font-bold mt-1">{stock.clock_position || "—"}</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
            {stock.phase}
          </div>
        </div>
        <div className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Extreme Score
          </div>
          <div className="text-xl font-bold mt-1">{stock.extreme_score ?? "—"}/20</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
            {stock.corporate_stage}
          </div>
        </div>
        <div className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Geometric Order
          </div>
          <div className="text-xl font-bold mt-1">
            {stock.geometric_order ?? 0} {geoLabels[stock.geometric_order ?? 0]}
          </div>
          <div className="text-xs mt-0.5 font-mono" style={{ color: "var(--muted)" }}>
            {stock.geometric_details}
          </div>
        </div>
        <div className="rounded-lg p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            TrendWise
          </div>
          <div className={`text-xl font-bold mt-1 ${stock.trend_signal === "Open" ? "signal-open" : "signal-closed"}`}>
            {stock.trend_signal || "No Signal"}
          </div>
          {stock.trend_entry_date && (
            <div className="text-xs mt-0.5 font-mono" style={{ color: "var(--muted)" }}>
              Entry: {stock.trend_entry_date} @ {stock.trend_entry_price}
            </div>
          )}
        </div>
      </div>

      {/* Walls */}
      <h2 className="text-lg font-bold mb-3">Gravity Walls (Damodaran)</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <WallCard label="Revenue Growth" text={stock.wall_revenue} color={wallColor(stock.wall_revenue)} />
        <WallCard label="Operating Margins" text={stock.wall_margins} color={wallColor(stock.wall_margins)} />
        <WallCard label="Capital Efficiency" text={stock.wall_capital} color={wallColor(stock.wall_capital)} />
        <WallCard label="Discount Rates" text={stock.wall_discount} color={wallColor(stock.wall_discount)} />
      </div>

      {/* Sector Context */}
      {(stock.sector_rank || stock.industry_rank) && (
        <>
          <h2 className="text-lg font-bold mb-3">Sector Context</h2>
          <div
            className="p-5 rounded-lg mb-8 grid grid-cols-1 sm:grid-cols-2 gap-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <Metric label="Sector Rank" value={stock.sector_rank} />
            <Metric label="Industry Rank" value={stock.industry_rank} />
            <Metric label="Sector Momentum" value={stock.sector_momentum?.toFixed(1)} />
            <Metric label="Industry Momentum" value={stock.industry_momentum?.toFixed(1)} />
          </div>
        </>
      )}

      {/* Action */}
      <div
        className="rounded-lg p-5 mb-8"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Action
            </div>
            <div className="text-lg font-bold mt-1">{stock.action || "—"}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Buy Reason
            </div>
            <div className="text-sm mt-1">{stock.buy_reason || "—"}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Notes
            </div>
            <div className="text-sm mt-1">{stock.notes || "—"}</div>
          </div>
        </div>
      </div>

      {/* Narrative */}
      {stock.narrative && (
        <div
          className="rounded-lg p-5 mb-8"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h2 className="text-lg font-bold mb-2">Narrative</h2>
          <p className="text-sm leading-relaxed">{stock.narrative}</p>
        </div>
      )}

      {/* Full Analysis Report */}
      {stock.analysis_report && (
        <div
          className="rounded-lg p-6 mb-8"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h2 className="text-lg font-bold mb-4">Full Analysis Report</h2>
          <div className="prose max-w-none">
            <Markdown>{stock.analysis_report}</Markdown>
          </div>
        </div>
      )}

      {/* Snapshot History */}
      {history.length > 1 && (
        <>
          <h2 className="text-lg font-bold mb-3">Snapshot History</h2>
          <div className="overflow-x-auto rounded-lg mb-8" style={{ border: "1px solid var(--border)" }}>
            <table className="w-full text-sm">
              <thead style={{ background: "var(--card)" }}>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Date</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--muted)" }}>Price</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Walls</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--muted)" }}>Extreme</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Clock</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Signal</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {new Date(h.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{h.price?.toFixed(2)}</td>
                    <td className="px-3 py-2 text-xs">
                      {h.green_walls || 0}G/{h.yellow_walls || 0}Y/{h.red_walls || 0}R
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{h.extreme_score}/20</td>
                    <td className="px-3 py-2 text-xs">{h.clock_position}</td>
                    <td className="px-3 py-2 text-xs">{h.trend_signal}</td>
                    <td className="px-3 py-2 text-xs">{h.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <footer className="pb-8 text-center text-xs" style={{ color: "var(--muted)" }}>
        <Link href="/" className="hover:underline" style={{ color: "var(--blue)" }}>
          ← Dashboard
        </Link>
        <span className="mx-2">&middot;</span>
        Last analyzed: {new Date(stock.created_at).toLocaleString()}
        <span className="mx-2">&middot;</span>
        Sources: {stock.data_sources}
      </footer>
    </main>
  );
}
