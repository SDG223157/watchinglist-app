import { notFound } from "next/navigation";
import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchStock, fetchStockHistory, getCachedHeatmap, isAnalyzed } from "@/lib/db";
import { buildHeatmapLookup, matchStock } from "@/lib/heatmap-match";
import { fetchPeerComparison, type PeerMetrics, fetchRevenueSegmentation, type RevenueSegmentation } from "@/lib/fmp";
import { AnalyzeButton } from "@/components/analyze-button";
import { RefreshButton } from "@/components/refresh-button";
import { DownloadReport } from "@/components/download-report";
import { StockSearch } from "@/components/stock-search";
import { HmmRegimeChart } from "@/components/hmm-regime-chart";
import { StockMacroCard } from "@/components/stock-macro-card";
import { StockEntropyCard } from "@/components/stock-entropy-card";
import { computeCompositeScore, SCORE_MAXES } from "@/lib/composite-score";
import { detectTriggers, type Trigger } from "@/lib/reanalysis-triggers";
import { diagnoseCapm, detectPhaseFromCapm } from "@/lib/capm-diagnostic";

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

function currencySymbol(symbol: string): string {
  if (symbol.endsWith(".HK")) return "HK$";
  if (symbol.endsWith(".SS") || symbol.endsWith(".SZ")) return "¥";
  if (symbol.endsWith(".T") || symbol.endsWith(".TYO")) return "¥";
  if (symbol.endsWith(".L") || symbol.endsWith(".LON")) return "£";
  if (symbol.endsWith(".DE") || symbol.endsWith(".PA") || symbol.endsWith(".MI")) return "€";
  return "$";
}

function nn(v: number | null | undefined): boolean {
  return v != null;
}

function fmtPct(v: number | string | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "—";
  const val = Math.abs(n) < 1 ? n * 100 : n;
  return val.toFixed(2);
}

function N(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return isNaN(n) ? null : n;
}

function fmtB(v: number | string | null | undefined, cs = "$"): string {
  const n = N(v);
  if (n == null) return "—";
  if (Math.abs(n) >= 1000) return `${cs}${(n / 1000).toFixed(1)}T`;
  return `${cs}${n.toFixed(1)}B`;
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

function fmtSegVal(v: number, cs = "$"): string {
  if (v >= 1e12) return `${cs}${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `${cs}${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${cs}${(v / 1e6).toFixed(0)}M`;
  return `${cs}${v.toLocaleString()}`;
}

function SegmentBars({ title, entries, cs }: { title: string; entries: import("@/lib/fmp").SegmentEntry[]; cs: string }) {
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
                    {fmtSegVal(value, cs)} ({pct.toFixed(1)}%)
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

function RevenueSegmentationSection({ segments, cs }: { segments: RevenueSegmentation; cs: string }) {
  if (segments.product.length === 0 && segments.geographic.length === 0) return null;
  return (
    <>
      <h2 className="text-lg font-bold mb-3">Revenue Segmentation</h2>
      <div
        className="rounded-lg p-5 mb-8 grid grid-cols-1 lg:grid-cols-2 gap-8"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <SegmentBars title="By Product" entries={segments.product} cs={cs} />
        <SegmentBars title="By Geography" entries={segments.geographic} cs={cs} />
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
                  <td className="px-3 py-2 text-right font-mono text-xs">{currencySymbol(p.symbol)}{p.price.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {p.marketCap >= 1e12
                      ? `${currencySymbol(p.symbol)}${(p.marketCap / 1e12).toFixed(1)}T`
                      : `${currencySymbol(p.symbol)}${(p.marketCap / 1e9).toFixed(1)}B`}
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

  const cs = currencySymbol(stock.symbol);

  const geoLabels: Record<number, string> = {
    0: "Anchor",
    1: "Velocity",
    2: "Acceleration",
    3: "Jerk",
  };

  return (
    <main className="max-w-[1600px] mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/"
          className="text-sm hover:underline"
          style={{ color: "var(--blue)" }}
        >
          ← Back to Dashboard
        </Link>
        <StockSearch />
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">{stock.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="font-mono text-lg" style={{ color: "var(--blue)" }}>
              {stock.symbol}
            </span>
            {N(stock.composite_score) != null && isAnalyzed(stock) && (
              <span
                className="font-mono text-sm font-bold px-2 py-0.5 rounded"
                style={{
                  background: N(stock.composite_score)! >= 70 ? "var(--green)" : N(stock.composite_score)! >= 40 ? "var(--yellow)" : "var(--red)",
                  color: "#000",
                }}
              >
                {N(stock.composite_score)!.toFixed(0)}
              </span>
            )}
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              {stock.sector}
            </span>
          </div>
        </div>
        <div className="sm:ml-auto flex items-end gap-4">
          <RefreshButton symbol={stock.symbol} />
          <div className="text-right">
            <div className="text-3xl font-mono font-bold">
              {stock.price ? `${cs}${stock.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}
            </div>
            <div className="text-xs font-mono" style={{ color: "#ef4444" }}>
              {stock.distance_from_ath && stock.distance_from_ath !== "?" ? stock.distance_from_ath : ""}
            </div>
          </div>
        </div>
      </div>

      {/* Valuation */}
      <MetricSection title="Valuation">
        <Metric label="Market Cap" value={stock.market_cap ? fmtB(stock.market_cap, cs) : null} />
        <Metric label="PE (TTM)" value={N(stock.pe_ttm)?.toFixed(1) ?? N(stock.pe_ratio)?.toFixed(1)} />
        <Metric label="Forward PE" value={N(stock.forward_pe)?.toFixed(1)} />
        <Metric label="PEG" value={N(stock.peg_ratio)?.toFixed(2)} />
        <Metric label="P/B" value={N(stock.price_to_book)?.toFixed(2)} />
        <Metric label="P/Sales" value={N(stock.price_to_sales)?.toFixed(2)} />
        <Metric label="P/FCF" value={N(stock.price_to_fcf)?.toFixed(1)} />
        <Metric label="EV/EBITDA" value={N(stock.ev_ebitda)?.toFixed(1)} />
        <Metric label="EV/Sales" value={N(stock.ev_sales)?.toFixed(2)} />
        <Metric label="Earnings Yield" value={nn(stock.earnings_yield) ? `${stock.earnings_yield}%` : null} />
        <Metric label="DCF Fair Value" value={N(stock.dcf_fair_value) != null ? `${cs}${N(stock.dcf_fair_value)!.toFixed(2)}` : null} />
        <Metric
          label="DCF Upside"
          value={
            N(stock.dcf_fair_value) != null && N(stock.price)
              ? `${(((N(stock.dcf_fair_value)! - N(stock.price)!) / N(stock.price)!) * 100).toFixed(1)}%`
              : null
          }
        />
      </MetricSection>

      {/* Profitability */}
      <MetricSection title="Profitability">
        <Metric label="ROIC" value={nn(stock.roic) ? `${stock.roic}%` : null} />
        <Metric label="ROE" value={nn(stock.roe) ? `${stock.roe}%` : null} />
        <Metric label="ROA" value={nn(stock.roa) ? `${stock.roa}%` : null} />
        <Metric label="ROCE" value={nn(stock.roce) ? `${stock.roce}%` : null} />
        <Metric label="Gross Margin" value={nn(stock.gross_margin) ? `${stock.gross_margin}%` : null} />
        <Metric label="Op. Margin" value={nn(stock.operating_margin) ? `${stock.operating_margin}%` : null} />
        <Metric label="Net Margin" value={nn(stock.net_margin) ? `${stock.net_margin}%` : null} />
        <Metric label="EBITDA Margin" value={nn(stock.ebitda_margin) ? `${stock.ebitda_margin}%` : null} />
      </MetricSection>

      {/* Growth */}
      <MetricSection title="Growth">
        <Metric label="Rev Growth YoY" value={nn(stock.revenue_growth_annual) ? `${fmtPct(stock.revenue_growth_annual)}%` : null} />
        <Metric label="Rev Growth TTM" value={nn(stock.revenue_growth_ttm) ? `${fmtPct(stock.revenue_growth_ttm)}%` : null} />
        <Metric label="Rev Recent Q" value={nn(stock.revenue_growth_recent_q) ? `${fmtPct(stock.revenue_growth_recent_q)}%` : null} />
        <Metric label="Rev CAGR 3Y" value={nn(stock.revenue_cagr_3y) ? `${fmtPct(stock.revenue_cagr_3y)}%` : null} />
        <Metric label="Rev CAGR 5Y" value={nn(stock.revenue_cagr_5y) ? `${fmtPct(stock.revenue_cagr_5y)}%` : null} />
        <Metric label="Earn Growth YoY" value={nn(stock.earnings_growth_annual) ? `${fmtPct(stock.earnings_growth_annual)}%` : null} />
        <Metric label="Earn Growth TTM" value={nn(stock.earnings_growth_ttm) ? `${fmtPct(stock.earnings_growth_ttm)}%` : null} />
        <Metric label="Earn Recent Q" value={nn(stock.earnings_growth_recent_q) ? `${fmtPct(stock.earnings_growth_recent_q)}%` : null} />
        <Metric label="Earn CAGR 3Y" value={nn(stock.earnings_cagr_3y) ? `${fmtPct(stock.earnings_cagr_3y)}%` : null} />
      </MetricSection>

      {/* Fundamentals & Cash Flow */}
      <MetricSection title="Fundamentals & Cash Flow">
        <Metric label="Revenue" value={nn(stock.revenue) ? fmtB(stock.revenue, cs) : null} />
        <Metric label="Revenue TTM" value={nn(stock.revenue_ttm) ? fmtB(stock.revenue_ttm, cs) : null} />
        <Metric label="Net Income TTM" value={nn(stock.net_income_ttm) ? fmtB(stock.net_income_ttm, cs) : null} />
        <Metric label="EBITDA TTM" value={nn(stock.ebitda_ttm) ? fmtB(stock.ebitda_ttm, cs) : null} />
        <Metric label="FCF" value={nn(stock.fcf) ? fmtB(stock.fcf, cs) : null} />
        <Metric label="FCF TTM" value={nn(stock.fcf_ttm) ? fmtB(stock.fcf_ttm, cs) : null} />
        <Metric label="FCF Yield" value={nn(stock.fcf_yield) ? `${stock.fcf_yield}%` : null} />
        <Metric label="Owner Earnings" value={nn(stock.owner_earnings) ? fmtB(stock.owner_earnings, cs) : null} />
        <Metric label="EPS" value={N(stock.eps) != null ? `${cs}${N(stock.eps)!.toFixed(2)}` : null} />
        <Metric label="Forward EPS" value={N(stock.forward_eps) != null ? `${cs}${N(stock.forward_eps)!.toFixed(2)}` : null} />
        <Metric label="Div Yield" value={nn(stock.dividend_yield) ? `${stock.dividend_yield}%` : null} />
        <Metric label="Shareholder Yield" value={nn(stock.shareholder_yield) ? `${stock.shareholder_yield}%` : null} />
      </MetricSection>

      {/* Balance Sheet & Risk */}
      <MetricSection title="Balance Sheet & Risk">
        <Metric label="Total Assets" value={nn(stock.total_assets) ? fmtB(stock.total_assets, cs) : null} />
        <Metric label="Total Debt" value={nn(stock.total_debt) ? fmtB(stock.total_debt, cs) : null} />
        <Metric label="Net Debt" value={nn(stock.net_debt) ? fmtB(stock.net_debt, cs) : null} />
        <Metric label="Cash" value={nn(stock.cash_and_equivalents) ? fmtB(stock.cash_and_equivalents, cs) : null} />
        <Metric label="D/E" value={N(stock.debt_to_equity)?.toFixed(2)} />
        <Metric label="Debt/EBITDA" value={N(stock.debt_to_ebitda)?.toFixed(2)} />
        <Metric label="Current Ratio" value={N(stock.current_ratio)?.toFixed(2)} />
        <Metric label="Interest Coverage" value={N(stock.interest_coverage)?.toFixed(1)} />
        <Metric label="Beta" value={N(stock.beta)?.toFixed(2)} />
        <Metric label="52W Low" value={N(stock.low_52w) != null ? `${cs}${N(stock.low_52w)!.toFixed(2)}` : null} />
        <Metric label="52W High" value={N(stock.high_52w) != null ? `${cs}${N(stock.high_52w)!.toFixed(2)}` : null} />
        <Metric label="DCF Levered" value={N(stock.dcf_levered) != null ? `${cs}${N(stock.dcf_levered)!.toFixed(2)}` : null} />
      </MetricSection>

      {/* Scores & Ratings */}
      <MetricSection title="Scores & Ratings">
        <Metric label="FMP Rating" value={stock.fmp_rating} />
        <Metric label="FMP Score" value={stock.fmp_rating_score != null ? `${stock.fmp_rating_score}/5` : null} />
        <Metric label="Piotroski F" value={stock.piotroski_score != null ? `${stock.piotroski_score}/9` : null} />
        <Metric label="Altman Z" value={N(stock.altman_z_score)?.toFixed(2)} />
      </MetricSection>

      {/* Revenue Segmentation */}
      <RevenueSegmentationSection segments={segments} cs={cs} />

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
          {stock.market_cap != null && stock.market_cap < 2 && (stock.geometric_order ?? 0) >= 2 && (
            <div className="text-[10px] mt-1.5 px-2 py-1 rounded" style={{ background: "rgba(234,179,8,0.1)", color: "#f59e0b" }}>
              Microcap (&lt;$2B) — geo signals inflated by illiquidity (FAJ 2026)
            </div>
          )}
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
              Entry: {stock.trend_entry_date} @ {cs}{stock.trend_entry_price}
            </div>
          )}
          {stock.trend_signal === "Open" && (
            <div className="text-[10px] mt-1.5" style={{ color: "var(--muted)" }}>
              Earnings-proximity crossovers carry higher conviction (FAJ 2026: stock-specific momentum doesn&apos;t reverse)
            </div>
          )}
        </div>
      </div>

      {/* CAPM Alpha-Beta Diagnostic */}
      {stock.capm_alpha != null && (() => {
        const diag = diagnoseCapm(stock);
        const verdictColor = diag.verdict === "VALIDATES" ? "var(--green)" : diag.verdict === "CONTRADICTS" ? "var(--red)" : "var(--yellow)";
        const verdictBg = diag.verdict === "VALIDATES" ? "rgba(34,197,94,0.08)" : diag.verdict === "CONTRADICTS" ? "rgba(239,68,68,0.08)" : "rgba(234,179,8,0.08)";
        const verdictIcon = diag.verdict === "VALIDATES" ? "✓" : diag.verdict === "CONTRADICTS" ? "✗" : "⚠";
        return (
          <>
            <h2 className="text-lg font-bold mb-3">CAPM Diagnostic</h2>
            <div className="rounded-lg p-5 mb-8" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-2xl font-bold font-mono" style={{ color: "var(--blue)" }}>
                      α {stock.capm_alpha > 0 ? "+" : ""}{stock.capm_alpha.toFixed(1)}%
                    </span>
                    <span className="text-lg font-mono">β {stock.capm_beta?.toFixed(2)}</span>
                    <span className="text-lg font-mono">R² {stock.capm_r2?.toFixed(2)}</span>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>vs {stock.capm_benchmark} (6M)</span>
                  </div>
                  {stock.capm_alpha_1y != null && (
                    <div className="text-xs font-mono" style={{ color: "var(--muted)" }}>
                      1Y α: {stock.capm_alpha_1y > 0 ? "+" : ""}{stock.capm_alpha_1y.toFixed(1)}% | Trend: {stock.capm_alpha_trend}
                    </div>
                  )}
                </div>
                <span
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold"
                  style={{ background: verdictBg, color: verdictColor }}
                >
                  {verdictIcon} {diag.verdict} CLOCK
                </span>
              </div>
              <div className="text-sm mb-3">{diag.summary}</div>
              {diag.signals.length > 0 && (
                <div className="space-y-1.5">
                  {diag.signals.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span
                        className="inline-block rounded-full mt-1 shrink-0"
                        style={{
                          width: 7, height: 7,
                          backgroundColor: s.status === "ok" ? "var(--green)" : s.status === "warning" ? "var(--yellow)" : "var(--red)",
                        }}
                      />
                      <span style={{ color: s.status === "ok" ? "var(--text)" : s.status === "warning" ? "var(--yellow)" : "var(--red)" }}>
                        {s.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {diag.expected && (
                <div className="mt-4 pt-3 text-xs" style={{ borderTop: "1px solid var(--border)", color: "var(--muted)" }}>
                  <strong>Expected at {diag.expected.hours} ({diag.expected.phase}):</strong>{" "}
                  α {diag.expected.alphaRange} | β {diag.expected.betaRange} | R² {diag.expected.r2Range}
                </div>
              )}
              {(() => {
                const implied = detectPhaseFromCapm(stock);
                const confColor = implied.confidence === "HIGH" ? "var(--green)" : implied.confidence === "MEDIUM" ? "var(--yellow)" : "var(--muted)";
                return (
                  <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--blue)" }}>
                        CAPM-Implied Phase
                      </span>
                      <span className="text-sm font-bold">{implied.phase}</span>
                      <span className="text-[10px] font-mono" style={{ color: "var(--muted)" }}>({implied.hours})</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: `${confColor}20`, color: confColor }}>
                        {implied.confidence}
                      </span>
                      {implied.llmClock && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                          style={{
                            background: implied.agreement ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                            color: implied.agreement ? "var(--green)" : "var(--red)",
                          }}
                        >
                          {implied.agreement ? "✓ Agrees with LLM clock" : `✗ LLM says ${implied.llmClock}`}
                        </span>
                      )}
                    </div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>{implied.reasoning}</div>
                  </div>
                );
              })()}
            </div>
          </>
        );
      })()}

      {/* Macro Playbook — 4-Layer Analysis */}
      <StockMacroCard symbol={stock.symbol} />

      {/* Markov Regime Model (HMM) */}
      <div
        className="rounded-lg p-5 mb-8"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <HmmRegimeChart symbol={stock.symbol} />
      </div>

      {/* Shannon Entropy */}
      <StockEntropyCard symbol={stock.symbol} />

      {/* Moat Analysis */}
      {(stock.moat_width || stock.moat_type) && (
        <>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-lg font-bold">Competitive Moat</h2>
            {((stock.green_walls || 0) >= 4 || ((stock.green_walls || 0) >= 3 && (stock.moat_width || "").toUpperCase() === "WIDE")) && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(59,130,246,0.12)", color: "var(--blue)" }}
              >
                DAR ELIGIBLE — natural defensive allocation candidate (FAJ 2026)
              </span>
            )}
          </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <WallCard label="Revenue Growth" text={stock.wall_revenue} color={wallColor(stock.wall_revenue)} />
        <WallCard label="Operating Margins" text={stock.wall_margins} color={wallColor(stock.wall_margins)} />
        <WallCard label="Capital Efficiency" text={stock.wall_capital} color={wallColor(stock.wall_capital)} />
        <WallCard label="Discount Rates" text={stock.wall_discount} color={wallColor(stock.wall_discount)} />
        {stock.wall_fcf && (
          <WallCard label="Cash Conversion" text={stock.wall_fcf} color={wallColor(stock.wall_fcf)} />
        )}
      </div>

      {/* FAJ Momentum & Regime */}
      {(stock.momentum_type || stock.macro_regime) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          {stock.momentum_type && (
            <div className={`rounded-lg border p-3 ${stock.structural_winner ? "border-emerald-500/50 bg-emerald-500/5" : stock.momentum_type === "Factor-only" ? "border-amber-500/50 bg-amber-500/5" : "border-zinc-700 bg-zinc-800/50"}`}>
              <div className="text-xs text-zinc-400 mb-1">Momentum Type</div>
              <div className="font-semibold text-sm">{stock.momentum_type}{stock.structural_winner ? " ★" : ""}</div>
              <div className="text-xs text-zinc-500 mt-1">
                Earnings: {stock.earnings_momentum || "—"} · Factor: {stock.factor_momentum || "—"}
              </div>
            </div>
          )}
          {stock.macro_regime && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
              <div className="text-xs text-zinc-400 mb-1">Macro Regime</div>
              <div className="font-semibold text-sm">{stock.macro_regime}</div>
              <div className="text-xs text-zinc-500 mt-1">{stock.macro_regime_details || ""}</div>
            </div>
          )}
          {stock.emotion_beta != null && (
            <div className={`rounded-lg border p-3 ${stock.emotion_signal === "High" ? "border-rose-500/50 bg-rose-500/5" : "border-zinc-700 bg-zinc-800/50"}`}>
              <div className="text-xs text-zinc-400 mb-1">Emotion Beta</div>
              <div className="font-semibold text-sm">{stock.emotion_beta?.toFixed(2)} ({stock.emotion_signal || "—"})</div>
              <div className="text-xs text-zinc-500 mt-1">Vol-of-vol sensitivity</div>
            </div>
          )}
          {stock.wall_combo && stock.wall_combo !== "Mixed" && (
            <div className={`rounded-lg border p-3 ${stock.wall_combo === "Best Quadrant" ? "border-emerald-500/50 bg-emerald-500/5" : stock.wall_combo === "Worst Quadrant" ? "border-red-500/50 bg-red-500/5" : "border-zinc-700 bg-zinc-800/50"}`}>
              <div className="text-xs text-zinc-400 mb-1">Wall Combo</div>
              <div className="font-semibold text-sm">{stock.wall_combo}</div>
              <div className="text-xs text-zinc-500 mt-1">
                {stock.fundamental_growth_score != null ? `FG Score: ${stock.fundamental_growth_score}/6` : ""}
                {stock.rd_intensity != null && stock.rd_intensity > 0 ? ` · R&D: ${(stock.rd_intensity * 100).toFixed(1)}%` : ""}
              </div>
            </div>
          )}
        </div>
      )}

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
          <div className="flex items-center gap-2">
            <DownloadReport symbol={stock.symbol} />
            <AnalyzeButton symbol={stock.symbol} />
          </div>
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
                  <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--muted)" }}>Score</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Walls</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--muted)" }}>Ext</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Clock</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Geo</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Signal</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>HMM</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Moat</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Entropy</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted)" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => {
                  const sc = computeCompositeScore(h);
                  const analyzed = isAnalyzed(h);
                  const geoLabel: Record<number, string> = { 0: "Anchor", 1: "Vel", 2: "Accel", 3: "Jerk" };
                  return (
                    <tr key={i} className="border-t" style={{ borderColor: "var(--border)" }}>
                      <td className="px-3 py-2 font-mono text-xs">
                        {new Date(h.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{N(h.price) ? `${cs}${N(h.price)!.toFixed(2)}` : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {analyzed ? (
                          <span className="font-mono text-xs font-bold" style={{ color: sc.gradeColor }}>
                            {sc.total}
                          </span>
                        ) : (
                          <span className="text-xs" style={{ color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {h.green_walls || 0}G/{h.yellow_walls || 0}Y/{h.red_walls || 0}R
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{h.extreme_score}/20</td>
                      <td className="px-3 py-2 text-xs">{h.clock_position}</td>
                      <td className="px-3 py-2 text-xs">
                        <span style={{
                          color: (h.geometric_order ?? 0) >= 3 ? "var(--red)"
                            : (h.geometric_order ?? 0) >= 2 ? "var(--yellow)"
                            : (h.geometric_order ?? 0) >= 1 ? "var(--blue)" : "var(--muted)",
                        }}>
                          {h.geometric_order ?? 0} {geoLabel[h.geometric_order ?? 0]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className={h.trend_signal === "Open" ? "signal-open" : "signal-closed"}>
                          {h.trend_signal || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {h.hmm_regime && h.hmm_regime !== "N/A" ? (
                          <span style={{
                            color: h.hmm_regime.toLowerCase().includes("bull") ? "var(--green)"
                              : h.hmm_regime.toLowerCase().includes("bear") ? "var(--red)" : "var(--muted)",
                          }}>
                            {h.hmm_regime}
                            {h.hmm_persistence != null && (
                              <span className="font-mono" style={{ color: "var(--muted)" }}> {(h.hmm_persistence * 100).toFixed(0)}%</span>
                            )}
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {h.moat_width ? (
                          <span style={{
                            color: h.moat_width === "WIDE" ? "var(--green)"
                              : h.moat_width === "NARROW" ? "var(--yellow)" : "var(--red)",
                          }}>
                            {h.moat_width}
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {h.entropy_regime ? (
                          <span style={{
                            color: h.entropy_regime === "compressed" ? "var(--red)"
                              : h.entropy_regime === "diverse" ? "var(--green)" : "var(--muted)",
                          }}>
                            {h.entropy_regime}
                            {h.cog_gap != null && h.cog_gap > 0 && (
                              <span className="font-mono" style={{ color: "var(--muted)" }}> {h.cog_gap}</span>
                            )}
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">{h.action}</td>
                    </tr>
                  );
                })}
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
