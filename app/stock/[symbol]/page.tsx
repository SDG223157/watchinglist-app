import { notFound } from "next/navigation";
import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchStock, fetchStockHistory, getCachedHeatmap } from "@/lib/db";
import { buildHeatmapLookup, matchStock } from "@/lib/heatmap-match";
import { fetchPeerComparison, type PeerMetrics, fetchRevenueSegmentation, type RevenueSegmentation } from "@/lib/fmp";
import { AnalyzeButton } from "@/components/analyze-button";
import { RefreshButton } from "@/components/refresh-button";
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

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  // Old data stored as decimal (0.0841 = 8.41%), new data as percentage (8.41)
  const val = Math.abs(v) < 1 ? v * 100 : v;
  return val.toFixed(2);
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

function MetricSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3
        className="text-xs font-semibold uppercase tracking-widest mb-3 px-1"
        style={{ color: "var(--blue)" }}
      >
        {title}
      </h3>
      <div
        className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-4 p-5 rounded-lg"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        {children}
      </div>
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

function fmtSegVal(v: number): string {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

function SegmentBars({ title, entries }: { title: string; entries: import("@/lib/fmp").SegmentEntry[] }) {
  if (entries.length === 0) return null;

  const latest = entries[0];
  const prior = entries[1];
  const total = Object.values(latest.data).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(latest.data).sort((a, b) => b[1] - a[1]);
  const maxVal = sorted[0]?.[1] ?? 1;

  const colors = [
    "var(--blue)", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444",
    "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
  ];

  return (
    <div>
      <h3
        className="text-xs font-semibold uppercase tracking-widest mb-3"
        style={{ color: "var(--blue)" }}
      >
        {title} — FY{latest.fiscalYear}
      </h3>
      <div className="space-y-2.5">
        {sorted.map(([name, value], i) => {
          const pct = total > 0 ? (value / total) * 100 : 0;
          const barWidth = (value / maxVal) * 100;
          let yoyLabel = "";
          if (prior) {
            const priorVal = prior.data[name];
            if (priorVal && priorVal > 0) {
              const yoy = ((value - priorVal) / priorVal) * 100;
              yoyLabel = `${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}%`;
            }
          }
          return (
            <div key={name}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs truncate max-w-[200px]">{name}</span>
                <div className="flex items-center gap-3">
                  {yoyLabel && (
                    <span
                      className="text-[10px] font-mono"
                      style={{ color: yoyLabel.startsWith("+") ? "var(--green)" : "var(--red)" }}
                    >
                      {yoyLabel}
                    </span>
                  )}
                  <span className="text-xs font-mono" style={{ color: "var(--muted)" }}>
                    {fmtSegVal(value)} ({pct.toFixed(1)}%)
                  </span>
                </div>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,0.06)" }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${barWidth}%`, background: colors[i % colors.length] }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RevenueSegmentationSection({ segments }: { segments: RevenueSegmentation }) {
  if (segments.product.length === 0 && segments.geographic.length === 0) return null;
  return (
    <>
      <h2 className="text-lg font-bold mb-3">Revenue Segmentation</h2>
      <div
        className="rounded-lg p-5 mb-8 grid grid-cols-1 lg:grid-cols-2 gap-8"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <SegmentBars title="By Product" entries={segments.product} />
        <SegmentBars title="By Geography" entries={segments.geographic} />
      </div>
    </>
  );
}

function PeersSection({ peers, currentSymbol }: { peers: PeerMetrics[]; currentSymbol: string }) {
  if (peers.length === 0) return null;
  return (
    <>
      <h2 className="text-lg font-bold mb-3">Stock Peers</h2>
      <div className="overflow-x-auto rounded-lg mb-8" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead style={{ background: "var(--card)" }}>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Symbol</th>
              <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Name</th>
              <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--muted)" }}>Price</th>
              <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--muted)" }}>Mkt Cap</th>
              <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--muted)" }}>PE</th>
              <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--muted)" }}>ROE</th>
              <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--muted)" }}>Op. Margin</th>
              <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--muted)" }}>FCF Yield</th>
              <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--muted)" }}>D/E</th>
            </tr>
          </thead>
          <tbody>
            {peers.map((p) => {
              const isInWatchlist = p.symbol === currentSymbol;
              return (
                <tr
                  key={p.symbol}
                  className="border-t"
                  style={{
                    borderColor: "var(--border)",
                    background: isInWatchlist ? "rgba(59,130,246,0.06)" : undefined,
                  }}
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/stock/${encodeURIComponent(p.symbol)}`}
                      className="font-mono text-xs font-semibold hover:underline"
                      style={{ color: "var(--blue)" }}
                    >
                      {p.symbol}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs truncate max-w-[180px]">{p.name}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">${p.price.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {p.marketCap >= 1e12
                      ? `$${(p.marketCap / 1e12).toFixed(1)}T`
                      : `$${(p.marketCap / 1e9).toFixed(1)}B`}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{p.pe?.toFixed(1) ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{p.roe != null ? `${p.roe}%` : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{p.operatingMargin != null ? `${p.operatingMargin}%` : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{p.fcfYield != null ? `${p.fcfYield}%` : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{p.debtToEquity?.toFixed(2) ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
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

  const [history, peers, segments] = await Promise.all([
    fetchStockHistory(symbol, 10),
    fetchPeerComparison(symbol).catch(() => [] as PeerMetrics[]),
    fetchRevenueSegmentation(symbol).catch(() => ({ product: [], geographic: [] }) as RevenueSegmentation),
  ]);
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
        <div className="sm:ml-auto flex items-end gap-4">
          <RefreshButton symbol={stock.symbol} />
          <div className="text-right">
            <div className="text-3xl font-mono font-bold">
              {stock.price ? stock.price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}
            </div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              {stock.distance_from_ath && stock.distance_from_ath !== "?" ? stock.distance_from_ath : ""}
            </div>
          </div>
        </div>
      </div>

      {/* Valuation */}
      <MetricSection title="Valuation">
        <Metric label="Market Cap" value={stock.market_cap ? fmtB(stock.market_cap) : null} />
        <Metric label="PE (TTM)" value={stock.pe_ttm?.toFixed(1) ?? stock.pe_ratio?.toFixed(1)} />
        <Metric label="Forward PE" value={stock.forward_pe?.toFixed(1)} />
        <Metric label="PEG" value={stock.peg_ratio?.toFixed(2)} />
        <Metric label="P/B" value={stock.price_to_book?.toFixed(2)} />
        <Metric label="P/Sales" value={stock.price_to_sales?.toFixed(2)} />
        <Metric label="P/FCF" value={stock.price_to_fcf?.toFixed(1)} />
        <Metric label="EV/EBITDA" value={stock.ev_ebitda?.toFixed(1)} />
        <Metric label="EV/Sales" value={stock.ev_sales?.toFixed(2)} />
        <Metric label="Earnings Yield" value={stock.earnings_yield ? `${stock.earnings_yield}%` : null} />
        <Metric label="DCF Fair Value" value={stock.dcf_fair_value?.toFixed(2)} />
        <Metric
          label="DCF Upside"
          value={
            stock.dcf_fair_value && stock.price
              ? `${(((stock.dcf_fair_value - stock.price) / stock.price) * 100).toFixed(1)}%`
              : null
          }
        />
      </MetricSection>

      {/* Profitability */}
      <MetricSection title="Profitability">
        <Metric label="ROIC" value={stock.roic ? `${stock.roic}%` : null} />
        <Metric label="ROE" value={stock.roe ? `${stock.roe}%` : null} />
        <Metric label="ROA" value={stock.roa ? `${stock.roa}%` : null} />
        <Metric label="ROCE" value={stock.roce ? `${stock.roce}%` : null} />
        <Metric label="Gross Margin" value={stock.gross_margin ? `${stock.gross_margin}%` : null} />
        <Metric label="Op. Margin" value={stock.operating_margin ? `${stock.operating_margin}%` : null} />
        <Metric label="Net Margin" value={stock.net_margin ? `${stock.net_margin}%` : null} />
        <Metric label="EBITDA Margin" value={stock.ebitda_margin ? `${stock.ebitda_margin}%` : null} />
      </MetricSection>

      {/* Growth */}
      <MetricSection title="Growth">
        <Metric label="Rev Growth YoY" value={stock.revenue_growth_annual ? `${fmtPct(stock.revenue_growth_annual)}%` : null} />
        <Metric label="Rev Growth TTM" value={stock.revenue_growth_ttm ? `${fmtPct(stock.revenue_growth_ttm)}%` : null} />
        <Metric label="Rev Recent Q" value={stock.revenue_growth_recent_q ? `${fmtPct(stock.revenue_growth_recent_q)}%` : null} />
        <Metric label="Rev CAGR 3Y" value={stock.revenue_cagr_3y ? `${fmtPct(stock.revenue_cagr_3y)}%` : null} />
        <Metric label="Rev CAGR 5Y" value={stock.revenue_cagr_5y ? `${fmtPct(stock.revenue_cagr_5y)}%` : null} />
        <Metric label="Earn Growth YoY" value={stock.earnings_growth_annual ? `${fmtPct(stock.earnings_growth_annual)}%` : null} />
        <Metric label="Earn Growth TTM" value={stock.earnings_growth_ttm ? `${fmtPct(stock.earnings_growth_ttm)}%` : null} />
        <Metric label="Earn Recent Q" value={stock.earnings_growth_recent_q ? `${fmtPct(stock.earnings_growth_recent_q)}%` : null} />
      </MetricSection>

      {/* Fundamentals & Cash Flow */}
      <MetricSection title="Fundamentals & Cash Flow">
        <Metric label="Revenue" value={stock.revenue ? fmtB(stock.revenue) : null} />
        <Metric label="Revenue TTM" value={stock.revenue_ttm ? fmtB(stock.revenue_ttm) : null} />
        <Metric label="Net Income TTM" value={stock.net_income_ttm ? fmtB(stock.net_income_ttm) : null} />
        <Metric label="EBITDA TTM" value={stock.ebitda_ttm ? fmtB(stock.ebitda_ttm) : null} />
        <Metric label="FCF" value={stock.fcf ? fmtB(stock.fcf) : null} />
        <Metric label="FCF TTM" value={stock.fcf_ttm ? fmtB(stock.fcf_ttm) : null} />
        <Metric label="FCF Yield" value={stock.fcf_yield ? `${stock.fcf_yield}%` : null} />
        <Metric label="Owner Earnings" value={stock.owner_earnings ? fmtB(stock.owner_earnings) : null} />
        <Metric label="EPS" value={stock.eps?.toFixed(2)} />
        <Metric label="Forward EPS" value={stock.forward_eps?.toFixed(2)} />
        <Metric label="Div Yield" value={stock.dividend_yield ? `${stock.dividend_yield}%` : null} />
        <Metric label="Shareholder Yield" value={stock.shareholder_yield ? `${stock.shareholder_yield}%` : null} />
      </MetricSection>

      {/* Balance Sheet & Risk */}
      <MetricSection title="Balance Sheet & Risk">
        <Metric label="Total Assets" value={stock.total_assets ? fmtB(stock.total_assets) : null} />
        <Metric label="Total Debt" value={stock.total_debt ? fmtB(stock.total_debt) : null} />
        <Metric label="Net Debt" value={stock.net_debt ? fmtB(stock.net_debt) : null} />
        <Metric label="Cash" value={stock.cash_and_equivalents ? fmtB(stock.cash_and_equivalents) : null} />
        <Metric label="D/E" value={stock.debt_to_equity?.toFixed(2)} />
        <Metric label="Debt/EBITDA" value={stock.debt_to_ebitda?.toFixed(2)} />
        <Metric label="Current Ratio" value={stock.current_ratio?.toFixed(2)} />
        <Metric label="Interest Coverage" value={stock.interest_coverage?.toFixed(1)} />
        <Metric label="Beta" value={stock.beta?.toFixed(2)} />
        <Metric label="52W Low" value={stock.low_52w?.toFixed(2)} />
        <Metric label="52W High" value={stock.high_52w?.toFixed(2)} />
        <Metric label="DCF Levered" value={stock.dcf_levered?.toFixed(2)} />
      </MetricSection>

      {/* Scores & Ratings */}
      <MetricSection title="Scores & Ratings">
        <Metric label="FMP Rating" value={stock.fmp_rating} />
        <Metric label="FMP Score" value={stock.fmp_rating_score != null ? `${stock.fmp_rating_score}/5` : null} />
        <Metric label="Piotroski F" value={stock.piotroski_score != null ? `${stock.piotroski_score}/9` : null} />
        <Metric label="Altman Z" value={stock.altman_z_score?.toFixed(2)} />
      </MetricSection>

      {/* Revenue Segmentation */}
      <RevenueSegmentationSection segments={segments} />

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

      {/* Stock Peers */}
      <PeersSection peers={peers} currentSymbol={stock.symbol} />

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
          <div className="analysis-report">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                table: ({ children }) => (
                  <div className="overflow-x-auto my-4">
                    <table className="w-full text-sm border-collapse">{children}</table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead style={{ background: "rgba(255,255,255,0.04)" }}>{children}</thead>
                ),
                th: ({ children }) => (
                  <th className="px-3 py-2 text-left text-xs font-semibold border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{children}</th>
                ),
                td: ({ children }) => (
                  <td className="px-3 py-2 text-sm border-b" style={{ borderColor: "var(--border)" }}>{children}</td>
                ),
                h1: ({ children }) => <h1 className="text-xl font-bold mt-6 mb-3">{children}</h1>,
                h2: ({ children }) => <h2 className="text-lg font-bold mt-6 mb-2" style={{ color: "var(--blue)" }}>{children}</h2>,
                h3: ({ children }) => <h3 className="text-base font-semibold mt-4 mb-2">{children}</h3>,
                p: ({ children }) => <p className="text-sm leading-relaxed mb-3" style={{ color: "var(--foreground)", opacity: 0.9 }}>{children}</p>,
                ul: ({ children }) => <ul className="text-sm list-disc pl-5 mb-3 space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="text-sm list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
                li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
                strong: ({ children }) => <strong className="font-semibold" style={{ color: "var(--foreground)" }}>{children}</strong>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 pl-4 my-3 text-sm italic" style={{ borderColor: "var(--blue)", color: "var(--muted)" }}>{children}</blockquote>
                ),
                code: ({ children, className }) => {
                  if (className?.includes("language-")) {
                    return null;
                  }
                  return <code className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)" }}>{children}</code>;
                },
                pre: () => null,
              }}
            >
              {stock.analysis_report.replace(/\n```[\s\S]*?```\s*$/m, "").replace(/\n\{[\s\S]*\}\s*$/, "")}
            </Markdown>
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
