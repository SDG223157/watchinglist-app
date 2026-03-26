import { notFound } from "next/navigation";
import Link from "next/link";
import Markdown from "react-markdown";
import { fetchStock, fetchStockHistory, getCachedHeatmap } from "@/lib/db";
import { buildHeatmapLookup, matchStock } from "@/lib/heatmap-match";
import { AnalyzeButton } from "@/components/analyze-button";
import { computeCompositeScore, SCORE_MAXES } from "@/lib/composite-score";
import { detectTriggers, type Trigger } from "@/lib/reanalysis-triggers";

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

function fmtB(v: number | null | undefined): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}T`;
  return `$${v.toFixed(1)}B`;
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

function ScoreBar({ label, value, max, emoji }: { label: string; value: number; max: number; emoji: string }) {
  const pct = Math.min((value / max) * 100, 100);
  const color = pct >= 80 ? "var(--green)" : pct >= 50 ? "var(--yellow)" : "var(--red)";
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm w-20 shrink-0">{emoji} {label}</span>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-mono w-10 text-right" style={{ color }}>{value}/{max}</span>
    </div>
  );
}

function TriggerAlerts({ stock }: { stock: import("@/lib/db").WatchlistStock }) {
  const triggers = detectTriggers(stock);
  if (triggers.length === 0) return null;
  const levelColors: Record<string, { bg: string; border: string; dot: string }> = {
    critical: { bg: "rgba(239,68,68,0.08)", border: "#ef4444", dot: "#ef4444" },
    warning: { bg: "rgba(245,158,11,0.08)", border: "#f59e0b", dot: "#f59e0b" },
    info: { bg: "rgba(107,114,128,0.08)", border: "#6b7280", dot: "#6b7280" },
  };
  const worst = triggers.some((t) => t.level === "critical")
    ? "critical"
    : triggers.some((t) => t.level === "warning")
      ? "warning"
      : "info";
  const c = levelColors[worst];
  return (
    <div
      className="rounded-lg p-4 mb-6"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <div className="text-sm font-semibold mb-2" style={{ color: c.border }}>
        Re-analysis Recommended
      </div>
      <ul className="space-y-1">
        {triggers.map((t, i) => {
          const tc = levelColors[t.level];
          return (
            <li key={i} className="flex items-start gap-2 text-sm" style={{ color: "var(--foreground)" }}>
              <span
                className="inline-block rounded-full mt-1.5 shrink-0"
                style={{ width: 7, height: 7, backgroundColor: tc.dot }}
              />
              {t.reason}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ScoreBreakdownCard({ stock }: { stock: import("@/lib/db").WatchlistStock }) {
  const sc = computeCompositeScore(stock);
  const analyzed = !!(stock.analysis_report && stock.green_walls != null);
  return (
    <div className="rounded-lg p-5 mb-8" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Composite Score</h2>
        <div className="flex items-center gap-3">
          <span
            className="text-3xl font-bold font-mono"
            style={{ color: analyzed ? sc.gradeColor : "var(--muted)", opacity: analyzed ? 1 : 0.5 }}
          >
            {sc.total}
          </span>
          <span
            className="text-sm font-bold px-3 py-1 rounded-full"
            style={{
              background: analyzed ? `${sc.gradeColor}20` : "var(--border)",
              color: analyzed ? sc.gradeColor : "var(--muted)",
            }}
          >
            {analyzed ? sc.grade : "No Analysis"}
          </span>
        </div>
      </div>
      {!analyzed && (
        <div
          className="rounded-lg p-3 mb-4 text-sm"
          style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.3)", color: "var(--yellow)" }}
        >
          Score is incomplete — walls, moat, clock, and stage data require LLM analysis.
          Generate an analysis report below for an accurate score.
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        <ScoreBar label="Walls" value={sc.walls} max={SCORE_MAXES.walls} emoji="🧱" />
        <ScoreBar label="Trend" value={sc.trendwise} max={SCORE_MAXES.trendwise} emoji="📈" />
        <ScoreBar label="Clock" value={sc.clock} max={SCORE_MAXES.clock} emoji="🕐" />
        <ScoreBar label="Moat" value={sc.moat} max={SCORE_MAXES.moat} emoji="🏰" />
        <ScoreBar label="Stage" value={sc.stage} max={SCORE_MAXES.stage} emoji="🏢" />
        <ScoreBar label="Geo" value={sc.geo} max={SCORE_MAXES.geo} emoji="📐" />
        <ScoreBar label="Sector" value={sc.sector} max={SCORE_MAXES.sector} emoji="🌐" />
      </div>
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
  const [stock, heatmapRows] = await Promise.all([
    fetchStock(symbol),
    getCachedHeatmap(),
  ]);

  if (!stock) notFound();

  const history = await fetchStockHistory(symbol, 10);
  const lookup = buildHeatmapLookup(heatmapRows);
  const hm = matchStock(stock, lookup);

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
        <Metric label="Market Cap" value={stock.market_cap ? fmtB(stock.market_cap) : null} />
        <Metric label="PE Ratio" value={stock.pe_ratio?.toFixed(1)} />
        <Metric label="P/B" value={stock.price_to_book?.toFixed(2)} />
        <Metric label="EV/EBITDA" value={stock.ev_ebitda?.toFixed(1)} />
        <Metric label="ROIC" value={stock.roic ? `${stock.roic}%` : null} />
        <Metric label="ROE" value={stock.roe ? `${stock.roe}%` : null} />
        <Metric label="Gross Margin" value={stock.gross_margin ? `${stock.gross_margin}%` : null} />
        <Metric label="Op. Margin" value={stock.operating_margin ? `${stock.operating_margin}%` : null} />
        <Metric label="Net Margin" value={stock.net_margin ? `${stock.net_margin}%` : null} />
        <Metric label="EBITDA Margin" value={stock.ebitda_margin ? `${stock.ebitda_margin}%` : null} />
        <Metric label="FCF" value={stock.fcf ? fmtB(stock.fcf) : null} />
        <Metric label="FCF Yield" value={stock.fcf_yield ? `${stock.fcf_yield}%` : null} />
        <Metric label="Revenue" value={stock.revenue ? fmtB(stock.revenue) : null} />
        <Metric label="Rev Growth YoY" value={stock.revenue_growth_annual ? `${stock.revenue_growth_annual}%` : null} />
        <Metric label="Rev CAGR 3Y" value={stock.revenue_cagr_3y ? `${stock.revenue_cagr_3y}%` : null} />
        <Metric label="Rev CAGR 5Y" value={stock.revenue_cagr_5y ? `${stock.revenue_cagr_5y}%` : null} />
        <Metric label="D/E" value={stock.debt_to_equity?.toFixed(2)} />
        <Metric label="Current Ratio" value={stock.current_ratio?.toFixed(2)} />
        <Metric label="Beta" value={stock.beta?.toFixed(2)} />
        <Metric label="Div Yield" value={stock.dividend_yield ? `${stock.dividend_yield}%` : null} />
        <Metric label="52W Low" value={stock.low_52w?.toFixed(2)} />
        <Metric label="52W High" value={stock.high_52w?.toFixed(2)} />
      </div>

      {/* Re-analysis Triggers */}
      <TriggerAlerts stock={stock} />

      {/* Composite Score Breakdown */}
      <ScoreBreakdownCard stock={stock} />

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

      {/* Moat Analysis */}
      {(stock.moat_width || stock.moat_type) && (
        <>
          <h2 className="text-lg font-bold mb-3">Competitive Moat</h2>
          <div
            className="rounded-lg p-5 mb-8"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold"
                  style={{
                    background:
                      stock.moat_width === "WIDE" ? "rgba(34,197,94,0.15)" :
                      stock.moat_width === "NARROW" ? "rgba(234,179,8,0.15)" :
                      "rgba(239,68,68,0.15)",
                    color:
                      stock.moat_width === "WIDE" ? "var(--green)" :
                      stock.moat_width === "NARROW" ? "var(--yellow)" :
                      "var(--red)",
                  }}
                >
                  {stock.moat_width === "WIDE" ? "🏰" : stock.moat_width === "NARROW" ? "🛡️" : "⚠️"}
                  {stock.moat_width || "—"} Moat
                </span>
                {stock.moat_trend && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background:
                        stock.moat_trend === "EXPANDING" ? "rgba(34,197,94,0.1)" :
                        stock.moat_trend === "ERODING" ? "rgba(239,68,68,0.1)" :
                        "rgba(255,255,255,0.05)",
                      color:
                        stock.moat_trend === "EXPANDING" ? "var(--green)" :
                        stock.moat_trend === "ERODING" ? "var(--red)" :
                        "var(--muted)",
                    }}
                  >
                    {stock.moat_trend === "EXPANDING" ? "↑" : stock.moat_trend === "ERODING" ? "↓" : "→"} {stock.moat_trend}
                  </span>
                )}
              </div>
            </div>
            {stock.moat_type && (
              <div className="text-sm mb-2">
                <span className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                  Sources:{" "}
                </span>
                {stock.moat_type}
              </div>
            )}
            {stock.moat_sources && (
              <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
                {stock.moat_sources}
              </p>
            )}
          </div>
        </>
      )}

      {/* Walls */}
      <h2 className="text-lg font-bold mb-3">Gravity Walls (Damodaran)</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <WallCard label="Revenue Growth" text={stock.wall_revenue} color={wallColor(stock.wall_revenue)} />
        <WallCard label="Operating Margins" text={stock.wall_margins} color={wallColor(stock.wall_margins)} />
        <WallCard label="Capital Efficiency" text={stock.wall_capital} color={wallColor(stock.wall_capital)} />
        <WallCard label="Discount Rates" text={stock.wall_discount} color={wallColor(stock.wall_discount)} />
      </div>

      {/* Sector & Industry Heatmap */}
      {(hm.sector || hm.industry || stock.sector_rank) && (
        <>
          <h2 className="text-lg font-bold mb-3">Sector & Industry Heatmap</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
            {hm.sector && (
              <div
                className="rounded-lg p-4"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <div className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
                  Sector — {hm.sector.name}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[10px]" style={{ color: "var(--muted)" }}>3M</div>
                    <div
                      className="text-lg font-mono font-bold"
                      style={{ color: (hm.sector.return_3m ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}
                    >
                      {hm.sector.return_3m != null ? `${hm.sector.return_3m >= 0 ? "+" : ""}${hm.sector.return_3m.toFixed(1)}%` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px]" style={{ color: "var(--muted)" }}>6M</div>
                    <div
                      className="text-lg font-mono font-bold"
                      style={{ color: (hm.sector.return_6m ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}
                    >
                      {hm.sector.return_6m != null ? `${hm.sector.return_6m >= 0 ? "+" : ""}${hm.sector.return_6m.toFixed(1)}%` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px]" style={{ color: "var(--muted)" }}>12M</div>
                    <div
                      className="text-lg font-mono font-bold"
                      style={{ color: (hm.sector.return_12m ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}
                    >
                      {hm.sector.return_12m != null ? `${hm.sector.return_12m >= 0 ? "+" : ""}${hm.sector.return_12m.toFixed(1)}%` : "—"}
                    </div>
                  </div>
                </div>
                {hm.sector.momentum && (
                  <div className="mt-2 text-xs" style={{
                    color: hm.sector.momentum.toLowerCase().includes("accel") ? "var(--green)"
                      : hm.sector.momentum.toLowerCase().includes("decel") ? "var(--red)" : "var(--muted)"
                  }}>
                    {hm.sector.momentum} {hm.sector.shift != null && `(${hm.sector.shift >= 0 ? "+" : ""}${hm.sector.shift.toFixed(1)}pp)`}
                  </div>
                )}
              </div>
            )}
            {hm.industry && (
              <div
                className="rounded-lg p-4"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <div className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
                  Industry — {hm.industry.name}
                  {hm.industry.rank && (
                    <span className="ml-1 opacity-60">#{hm.industry.rank}</span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[10px]" style={{ color: "var(--muted)" }}>3M</div>
                    <div
                      className="text-lg font-mono font-bold"
                      style={{ color: (hm.industry.return_3m ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}
                    >
                      {hm.industry.return_3m != null ? `${hm.industry.return_3m >= 0 ? "+" : ""}${hm.industry.return_3m.toFixed(1)}%` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px]" style={{ color: "var(--muted)" }}>6M</div>
                    <div
                      className="text-lg font-mono font-bold"
                      style={{ color: (hm.industry.return_6m ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}
                    >
                      {hm.industry.return_6m != null ? `${hm.industry.return_6m >= 0 ? "+" : ""}${hm.industry.return_6m.toFixed(1)}%` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px]" style={{ color: "var(--muted)" }}>12M</div>
                    <div
                      className="text-lg font-mono font-bold"
                      style={{ color: (hm.industry.return_12m ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}
                    >
                      {hm.industry.return_12m != null ? `${hm.industry.return_12m >= 0 ? "+" : ""}${hm.industry.return_12m.toFixed(1)}%` : "—"}
                    </div>
                  </div>
                </div>
                {hm.industry.shift != null && (
                  <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                    Shift: {hm.industry.shift >= 0 ? "+" : ""}{hm.industry.shift.toFixed(1)}pp
                  </div>
                )}
              </div>
            )}
          </div>
          {(stock.sector_rank || stock.industry_rank) && (
            <div
              className="p-4 rounded-lg mb-8 grid grid-cols-1 sm:grid-cols-2 gap-4"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            >
              {stock.sector_rank && <Metric label="Sector Rank" value={stock.sector_rank} />}
              {stock.industry_rank && <Metric label="Industry Rank" value={stock.industry_rank} />}
            </div>
          )}
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
      <div
        className="rounded-lg p-6 mb-8"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Analysis Report</h2>
          <AnalyzeButton symbol={stock.symbol} />
        </div>
        {stock.analysis_report ? (
          <div className="prose max-w-none">
            <Markdown>{stock.analysis_report}</Markdown>
          </div>
        ) : (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No report yet. Click &quot;Generate Analysis Report&quot; to create one with AI.
          </p>
        )}
      </div>

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
