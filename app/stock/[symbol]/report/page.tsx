import { notFound } from "next/navigation";
import { fetchStock, isAnalyzed } from "@/lib/db";
import { computeCompositeScore } from "@/lib/composite-score";
import { PrintButton } from "@/components/print-button";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const dynamic = "force-dynamic";

function ccy(s: string) {
  if (s.endsWith(".HK")) return "HK$";
  if (s.endsWith(".SS") || s.endsWith(".SZ")) return "\u00a5";
  return "$";
}
function n(v: number | null | undefined, d = 1) {
  return v != null && !isNaN(v) ? v.toFixed(d) : "\u2014";
}
function nB(v: number | null | undefined, c = "$") {
  if (v == null) return "\u2014";
  return Math.abs(v) >= 1000 ? `${c}${(v / 1000).toFixed(1)}T` : `${c}${v.toFixed(1)}B`;
}
function nP(v: number | string | null | undefined) {
  if (v == null) return "\u2014";
  const x = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(x)) return "\u2014";
  return (Math.abs(x) < 1 ? x * 100 : x).toFixed(1) + "%";
}
function wc(t: string | null) {
  if (!t) return "#64748b";
  const u = t.toUpperCase();
  return u.includes("GREEN") ? "#16a34a" : u.includes("YELLOW") ? "#b45309" : u.includes("RED") ? "#dc2626" : "#64748b";
}

export default async function ReportPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await params;
  const symbol = decodeURIComponent(raw);
  const stock = await fetchStock(symbol);
  if (!stock) notFound();

  const cs = ccy(stock.symbol);
  const sc = computeCompositeScore(stock);
  const now = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const analyzed = isAnalyzed(stock);

  const gc = sc.total >= 80 ? "#16a34a" : sc.total >= 65 ? "#22c55e" : sc.total >= 50 ? "#b45309" : sc.total >= 35 ? "#ea580c" : "#dc2626";
  const rating = sc.total >= 80 ? "STRONG BUY" : sc.total >= 65 ? "BUY" : sc.total >= 50 ? "WATCH" : sc.total >= 35 ? "CAUTION" : "AVOID";

  const reportMd = stock.analysis_report
    ? stock.analysis_report
        .replace(/```[\s\S]*?```/g, "")
        .replace(/\{[\s\S]*\}$/m, "")
        .trim()
    : null;

  return (
    <html>
      <head>
        <title>{stock.name} - Research Desk Report</title>
        <style>{`
          @page { size: A4; margin: 0; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1e293b; font-size: 9px; line-height: 1.5; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .page { width: 210mm; margin: 0 auto; padding: 0; }

          .header { background: #003366; color: white; padding: 6px 20px; display: flex; justify-content: space-between; align-items: center; }
          .header-left { display: flex; align-items: center; }
          .header-left img { height: 32px; margin-right: 10px; }
          .header-right { text-align: right; font-size: 7px; opacity: 0.8; }
          .blue-bar { height: 2px; background: #2563eb; }

          .content { padding: 12px 20px; }

          .cover-top { display: flex; gap: 12px; margin-bottom: 10px; }
          .cover-main { flex: 1; }
          .cover-main h2 { font-size: 20px; color: #0f172a; font-weight: 800; line-height: 1.2; margin-bottom: 2px; }
          .cover-main .ticker { font-size: 11px; color: #2563eb; font-weight: 600; }
          .cover-main .sub { font-size: 8px; color: #64748b; margin-left: 8px; }

          .rating-box { width: 100px; flex-shrink: 0; text-align: center; }
          .rating-badge { background: ${gc}; color: white; padding: 6px 12px; border-radius: 4px; font-weight: 800; font-size: 12px; letter-spacing: 0.5px; }
          .rating-score { font-size: 8px; color: #64748b; margin-top: 3px; }

          .key-data { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 12px; margin-bottom: 10px; display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
          .key-data .kd-item label { font-size: 6.5px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px; display: block; }
          .key-data .kd-item span { font-size: 10px; font-weight: 700; color: #0f172a; }

          .two-col { display: grid; grid-template-columns: 1fr 130px; gap: 12px; }
          .sidebar { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 10px; height: fit-content; }
          .sidebar h4 { font-size: 7px; color: #003366; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; }
          .sidebar .row { display: flex; justify-content: space-between; margin-bottom: 3px; }
          .sidebar .row label { font-size: 7px; color: #64748b; }
          .sidebar .row span { font-size: 7.5px; font-weight: 600; color: #0f172a; }

          .sec-title { font-size: 9.5px; font-weight: 700; color: #003366; margin: 10px 0 5px; padding-left: 8px; border-left: 2.5px solid #003366; }

          .narrative { font-size: 8.5px; line-height: 1.6; color: #334155; margin-bottom: 8px; }

          .fw-row { display: flex; margin-bottom: 2px; font-size: 8px; }
          .fw-label { width: 95px; font-weight: 600; color: #475569; flex-shrink: 0; }
          .fw-value { color: #0f172a; flex: 1; }

          .wall-row { display: flex; margin-bottom: 3px; font-size: 8px; }
          .wall-label { width: 95px; font-weight: 700; color: #475569; flex-shrink: 0; }

          table.fin { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 7.5px; }
          table.fin th { background: #f1f5f9; color: #003366; font-weight: 700; font-size: 6.5px; text-transform: uppercase; letter-spacing: 0.3px; padding: 3px 5px; text-align: left; border-bottom: 1.5px solid #cbd5e1; }
          table.fin td { padding: 2.5px 5px; border-bottom: 0.5px solid #e2e8f0; }
          table.fin tr:nth-child(even) { background: #fafbfc; }
          table.fin .label { color: #64748b; font-weight: 600; width: 65px; }
          table.fin .val { color: #0f172a; font-weight: 500; }

          .score-bar { display: flex; gap: 1px; margin-top: 4px; }
          .score-bar .seg { text-align: center; padding: 3px 2px; font-size: 6.5px; background: #f1f5f9; border: 0.5px solid #e2e8f0; flex: 1; }
          .score-bar .seg.total { background: ${gc}15; border-color: ${gc}; font-weight: 800; color: ${gc}; }
          .score-bar .seg label { display: block; font-size: 5.5px; color: #94a3b8; text-transform: uppercase; }
          .score-bar .seg span { font-weight: 700; font-size: 8px; color: #0f172a; }

          .report-text { font-size: 8px; line-height: 1.6; color: #334155; }
          .report-text h1 { font-size: 12px; color: #003366; margin: 14px 0 4px; font-weight: 700; }
          .report-text h2 { font-size: 11px; color: #003366; margin: 12px 0 4px; font-weight: 700; border-bottom: 1px solid #e2e8f0; padding-bottom: 2px; }
          .report-text h3 { font-size: 10px; color: #003366; margin: 10px 0 3px; font-weight: 700; }
          .report-text h4 { font-size: 9px; color: #003366; margin: 8px 0 2px; font-weight: 600; }
          .report-text p { margin: 3px 0; }
          .report-text ul, .report-text ol { padding-left: 14px; margin: 2px 0; }
          .report-text li { margin: 1px 0; }
          .report-text strong { color: #0f172a; }
          .report-text blockquote { border-left: 2px solid #2563eb; padding-left: 8px; margin: 4px 0; color: #475569; font-style: italic; }
          .report-text table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 7px; }
          .report-text th { background: #f1f5f9; color: #003366; font-weight: 700; padding: 2px 4px; text-align: left; border-bottom: 1.5px solid #cbd5e1; font-size: 6.5px; }
          .report-text td { padding: 2px 4px; border-bottom: 0.5px solid #e2e8f0; }
          .report-text tr:nth-child(even) { background: #fafbfc; }
          .report-text hr { border: none; border-top: 0.5px solid #e2e8f0; margin: 8px 0; }

          .footer-end { padding: 12px 20px 8px; border-top: 0.5px solid #e2e8f0; font-size: 6px; color: #94a3b8; text-align: center; margin-top: 16px; }

          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none; }
          }
        `}</style>
      </head>
      <body>
        <PrintButton />

        {/* PAGE 1: COVER */}
        <div className="page">
          <div className="header">
            <div className="header-left">
              <img src="/research-desk-logo.png" alt="The Research Desk" style={{ height: "32px", marginRight: "10px", verticalAlign: "middle" }} />
              <span style={{ fontSize: "7px", opacity: 0.7, verticalAlign: "middle" }}>Equity Research Report</span>
            </div>
            <div className="header-right">
              {now}<br />{stock.symbol} &bull; {stock.sector}
            </div>
          </div>
          <div className="blue-bar" />

          <div className="content">
            <div className="cover-top">
              <div className="cover-main">
                <h2>{stock.name}</h2>
                <span className="ticker">{stock.symbol}</span>
                <span className="sub">{stock.sector} &bull; {stock.market}</span>
              </div>
              <div className="rating-box">
                <div className="rating-badge">{rating}</div>
                <div className="rating-score">{sc.total}/100 Composite</div>
              </div>
            </div>

            <div className="key-data">
              <div className="kd-item"><label>Price</label><span>{stock.price ? `${cs}${stock.price.toFixed(2)}` : "\u2014"}</span></div>
              <div className="kd-item"><label>Market Cap</label><span>{nB(stock.market_cap, cs)}</span></div>
              <div className="kd-item"><label>PE (TTM)</label><span>{n(stock.pe_ttm ?? stock.pe_ratio)}</span></div>
              <div className="kd-item"><label>52W Range</label><span>{stock.low_52w && stock.high_52w ? `${cs}${n(stock.low_52w)}\u2013${cs}${n(stock.high_52w)}` : "\u2014"}</span></div>
              <div className="kd-item"><label>ATH</label><span>{stock.distance_from_ath || "\u2014"}</span></div>
            </div>

            <div className="two-col">
              <div>
                {stock.narrative && (
                  <>
                    <div className="sec-title">Investment Overview</div>
                    <p className="narrative">{stock.narrative}</p>
                  </>
                )}

                <div className="sec-title">Framework Positioning</div>
                {[
                  ["Market Clock", `${stock.clock_position || "\u2014"} (${stock.phase || ""})`],
                  ["Corporate Stage", stock.corporate_stage || "\u2014"],
                  ["Geometric Order", `${stock.geometric_order ?? 0} \u2014 ${stock.geometric_details || ""}`],
                  ["TrendWise", `${stock.trend_signal || "\u2014"}${stock.trend_entry_date ? ` \u2014 Entry: ${stock.trend_entry_date} @ ${cs}${stock.trend_entry_price}` : ""}`],
                  ["HMM Regime", `${stock.hmm_regime || "\u2014"}${stock.hmm_persistence != null ? ` (${(stock.hmm_persistence * 100).toFixed(0)}% persistence)` : ""}`],
                  ["Moat", `${stock.moat_width || "\u2014"} ${stock.moat_trend ? `(${stock.moat_trend})` : ""} \u2014 ${stock.moat_type || ""}`],
                  ["Extreme Score", `${stock.extreme_score ?? "\u2014"}/20`],
                  ...(stock.momentum_type ? [["Momentum", `${stock.momentum_type}${stock.structural_winner ? " \u2605" : ""} (E: ${stock.earnings_momentum || "\u2014"} / F: ${stock.factor_momentum || "\u2014"})`]] : []),
                  ...(stock.macro_regime ? [["Macro Regime", `${stock.macro_regime} \u2014 ${stock.macro_regime_details || ""}`]] : []),
                  ...(stock.emotion_beta != null ? [["Emotion Beta", `${stock.emotion_beta?.toFixed(2)} (${stock.emotion_signal || "\u2014"})`]] : []),
                  ...(stock.wall_combo && stock.wall_combo !== "Mixed" ? [["Wall Combo", `${stock.wall_combo}${stock.fundamental_growth_score != null ? ` \u2014 FG ${stock.fundamental_growth_score}/6` : ""}${stock.rd_intensity != null && stock.rd_intensity > 0 ? ` \u2014 R&D ${(stock.rd_intensity * 100).toFixed(1)}%` : ""}`]] : []),
                  ...(stock.capex_risk_flag ? [["CAPEX Risk", `\u26a0 ${stock.capex_risk_flag}`]] : []),
                  ...(stock.te_causal_direction ? [["Info Flow", `${stock.te_causal_direction}${stock.mean_reversion_halflife != null ? ` \u2014 HL: ${stock.mean_reversion_halflife.toFixed(0)}d (${stock.halflife_regime || ""})` : ""}`]] : []),
                  ["Action", stock.action || "\u2014"],
                ].map(([label, value]) => (
                  <div key={label} className="fw-row">
                    <div className="fw-label">{label}</div>
                    <div className="fw-value">{value}</div>
                  </div>
                ))}

                <div className="sec-title" style={{ marginTop: 10 }}>Gravity Walls (Damodaran Five Walls)</div>
                {[
                  ["Revenue Growth", stock.wall_revenue],
                  ["Operating Margins", stock.wall_margins],
                  ["Capital Efficiency", stock.wall_capital],
                  ["Discount Rates", stock.wall_discount],
                  ...(stock.wall_fcf ? [["Cash Conversion", stock.wall_fcf]] : []),
                ].map(([label, value]) => (
                  <div key={label} className="wall-row">
                    <div className="wall-label">{label}</div>
                    <div style={{ color: wc(value as string), flex: 1, fontSize: "8px" }}>{(value as string) || "\u2014"}</div>
                  </div>
                ))}

                {stock.buy_reason && (
                  <>
                    <div className="sec-title" style={{ marginTop: 10 }}>Buy Conditions (7-Gate)</div>
                    <p style={{ fontSize: "8px", color: "#334155", lineHeight: 1.5 }}>{stock.buy_reason}</p>
                  </>
                )}
              </div>

              <div className="sidebar">
                <h4>Key Financial Data</h4>
                {[
                  ["Price", stock.price ? `${cs}${stock.price.toFixed(2)}` : "\u2014"],
                  ["Market Cap", nB(stock.market_cap, cs)],
                  ["PE (TTM)", n(stock.pe_ttm ?? stock.pe_ratio)],
                  ["Forward PE", n(stock.forward_pe)],
                  ["PEG", n(stock.peg_ratio, 2)],
                  ["P/B", n(stock.price_to_book, 2)],
                  ["EV/EBITDA", n(stock.ev_ebitda)],
                  ["Div Yield", stock.dividend_yield != null ? `${stock.dividend_yield}%` : "\u2014"],
                  ["ROE", stock.roe != null ? `${stock.roe}%` : "\u2014"],
                  ["ROIC", stock.roic != null ? `${stock.roic}%` : "\u2014"],
                  ["Beta", n(stock.beta, 2)],
                  ["Altman Z", n(stock.altman_z_score, 2)],
                  ["FCF Yield", stock.fcf_yield ? `${stock.fcf_yield}%` : "\u2014"],
                ].map(([label, value]) => (
                  <div key={label} className="row">
                    <label>{label}</label>
                    <span>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="score-bar" style={{ marginTop: 8 }}>
              {[
                { l: "Walls", v: sc.walls, m: 25 },
                { l: "Trend", v: sc.trendwise, m: 15 },
                { l: "Clock", v: sc.clock, m: 15 },
                { l: "Moat", v: sc.moat, m: 15 },
                { l: "Stage", v: sc.stage, m: 10 },
                { l: "Geo", v: sc.geo, m: 10 },
                { l: "Sector", v: sc.sector, m: 10 },
              ].map((s) => (
                <div key={s.l} className="seg"><label>{s.l}</label><span>{s.v}/{s.m}</span></div>
              ))}
              <div className="seg total"><label>Total</label><span>{sc.total}/100</span></div>
            </div>

            <div className="sec-title">Valuation</div>
            <table className="fin">
              <thead><tr><th>Metric</th><th>Value</th><th>Metric</th><th>Value</th><th>Metric</th><th>Value</th></tr></thead>
              <tbody>
                <tr><td className="label">PE (TTM)</td><td className="val">{n(stock.pe_ttm ?? stock.pe_ratio)}</td><td className="label">Forward PE</td><td className="val">{n(stock.forward_pe)}</td><td className="label">PEG</td><td className="val">{n(stock.peg_ratio, 2)}</td></tr>
                <tr><td className="label">P/B</td><td className="val">{n(stock.price_to_book, 2)}</td><td className="label">EV/EBITDA</td><td className="val">{n(stock.ev_ebitda)}</td><td className="label">EV/Sales</td><td className="val">{n(stock.ev_sales, 2)}</td></tr>
                <tr><td className="label">P/Sales</td><td className="val">{n(stock.price_to_sales, 2)}</td><td className="label">P/FCF</td><td className="val">{n(stock.price_to_fcf)}</td><td className="label">Earn Yield</td><td className="val">{stock.earnings_yield ? `${stock.earnings_yield}%` : "\u2014"}</td></tr>
                <tr><td className="label">DCF Fair</td><td className="val">{stock.dcf_fair_value ? `${cs}${stock.dcf_fair_value.toFixed(2)}` : "\u2014"}</td><td className="label">DCF Levered</td><td className="val">{stock.dcf_levered ? `${cs}${stock.dcf_levered.toFixed(2)}` : "\u2014"}</td><td className="label">Upside</td><td className="val">{stock.dcf_fair_value && stock.price ? `${(((stock.dcf_fair_value - stock.price) / stock.price) * 100).toFixed(1)}%` : "\u2014"}</td></tr>
              </tbody>
            </table>

            <div className="sec-title">Profitability & Margins</div>
            <table className="fin">
              <thead><tr><th>Metric</th><th>Value</th><th>Metric</th><th>Value</th><th>Metric</th><th>Value</th></tr></thead>
              <tbody>
                <tr><td className="label">ROIC</td><td className="val">{stock.roic != null ? `${stock.roic}%` : "\u2014"}</td><td className="label">ROE</td><td className="val">{stock.roe != null ? `${stock.roe}%` : "\u2014"}</td><td className="label">ROA</td><td className="val">{stock.roa != null ? `${stock.roa}%` : "\u2014"}</td></tr>
                <tr><td className="label">Gross Mgn</td><td className="val">{stock.gross_margin != null ? `${stock.gross_margin}%` : "\u2014"}</td><td className="label">Op Mgn</td><td className="val">{stock.operating_margin != null ? `${stock.operating_margin}%` : "\u2014"}</td><td className="label">Net Mgn</td><td className="val">{stock.net_margin != null ? `${stock.net_margin}%` : "\u2014"}</td></tr>
                <tr><td className="label">EBITDA Mgn</td><td className="val">{stock.ebitda_margin != null ? `${stock.ebitda_margin}%` : "\u2014"}</td><td className="label">FCF Yield</td><td className="val">{stock.fcf_yield ? `${stock.fcf_yield}%` : "\u2014"}</td><td className="label">SH Yield</td><td className="val">{stock.shareholder_yield ? `${stock.shareholder_yield}%` : "\u2014"}</td></tr>
                <tr><td className="label">FCF/OI</td><td className="val">{n(stock.fcf_to_operating_income, 2)}</td><td className="label">Cash Conv</td><td className="val">{stock.cash_conversion_score != null ? `${stock.cash_conversion_score}/7` : "\u2014"}</td><td className="label">LBB Score</td><td className="val">{stock.long_bull_score != null ? `${stock.long_bull_score}/6` : "\u2014"}</td></tr>
                <tr><td className="label">R&D/Rev</td><td className="val">{stock.rd_intensity != null ? `${(stock.rd_intensity * 100).toFixed(1)}%` : "\u2014"}</td><td className="label">FG Score</td><td className="val">{stock.fundamental_growth_score != null ? `${stock.fundamental_growth_score}/6` : "\u2014"}</td><td className="label">GP Growth</td><td className="val">{nP(stock.gross_profit_growth_annual)}</td></tr>
              </tbody>
            </table>

            <div className="sec-title">Revenue & Earnings Growth</div>
            <table className="fin">
              <thead><tr><th>Metric</th><th>Value</th><th>Metric</th><th>Value</th><th>Metric</th><th>Value</th></tr></thead>
              <tbody>
                <tr><td className="label">Rev YoY</td><td className="val">{nP(stock.revenue_growth_annual)}</td><td className="label">Earn YoY</td><td className="val">{nP(stock.earnings_growth_annual)}</td><td className="label">Rev CAGR 3Y</td><td className="val">{nP(stock.revenue_cagr_3y)}</td></tr>
                <tr><td className="label">Rev TTM</td><td className="val">{nP(stock.revenue_growth_ttm)}</td><td className="label">Earn TTM</td><td className="val">{nP(stock.earnings_growth_ttm)}</td><td className="label">Rev CAGR 5Y</td><td className="val">{nP(stock.revenue_cagr_5y)}</td></tr>
                <tr><td className="label">Rev Qtr</td><td className="val">{nP(stock.revenue_growth_recent_q)}</td><td className="label">Earn Qtr</td><td className="val">{nP(stock.earnings_growth_recent_q)}</td><td className="label">Earn CAGR 3Y</td><td className="val">{nP(stock.earnings_cagr_3y)}</td></tr>
              </tbody>
            </table>

            <div className="sec-title">Balance Sheet & Credit</div>
            <table className="fin">
              <thead><tr><th>Metric</th><th>Value</th><th>Metric</th><th>Value</th><th>Metric</th><th>Value</th></tr></thead>
              <tbody>
                <tr><td className="label">D/E</td><td className="val">{n(stock.debt_to_equity, 2)}</td><td className="label">Current</td><td className="val">{n(stock.current_ratio, 2)}</td><td className="label">Int Coverage</td><td className="val">{n(stock.interest_coverage)}</td></tr>
                <tr><td className="label">Debt/EBITDA</td><td className="val">{n(stock.debt_to_ebitda, 2)}</td><td className="label">Altman Z</td><td className="val">{n(stock.altman_z_score, 2)}</td><td className="label">Piotroski</td><td className="val">{stock.piotroski_score != null ? `${stock.piotroski_score}/9` : "\u2014"}</td></tr>
                <tr><td className="label">Beta</td><td className="val">{n(stock.beta, 2)}</td><td className="label">52W Low</td><td className="val">{stock.low_52w ? `${cs}${n(stock.low_52w)}` : "\u2014"}</td><td className="label">52W High</td><td className="val">{stock.high_52w ? `${cs}${n(stock.high_52w)}` : "\u2014"}</td></tr>
                <tr><td className="label">Accrual Q</td><td className="val">{stock.accrual_quality != null ? `${stock.accrual_quality}x (${stock.accrual_flag || ""})` : "\u2014"}</td><td className="label">TA Growth</td><td className="val">{stock.total_asset_growth != null ? `${(stock.total_asset_growth * 100).toFixed(1)}%` : "\u2014"}</td><td className="label">Empire</td><td className="val">{stock.empire_building ? "\u26a0 Yes" : "\u2014"}</td></tr>
                <tr><td className="label">Lev Quality</td><td className="val">{stock.leverage_quality || "\u2014"}</td><td className="label">SBC/Rev</td><td className="val">{stock.sbc_as_pct_revenue != null ? `${(stock.sbc_as_pct_revenue * 100).toFixed(1)}%` : "\u2014"}</td><td className="label">Dilution</td><td className="val">{stock.share_dilution_rate != null ? `${(stock.share_dilution_rate * 100).toFixed(1)}%` : "\u2014"}</td></tr>
              </tbody>
            </table>

            <div className="sec-title">Fundamentals</div>
            <table className="fin">
              <thead><tr><th>Metric</th><th>Value</th><th>Metric</th><th>Value</th><th>Metric</th><th>Value</th></tr></thead>
              <tbody>
                <tr><td className="label">Revenue</td><td className="val">{nB(stock.revenue, cs)}</td><td className="label">Rev TTM</td><td className="val">{nB(stock.revenue_ttm, cs)}</td><td className="label">Net Inc TTM</td><td className="val">{nB(stock.net_income_ttm, cs)}</td></tr>
                <tr><td className="label">FCF</td><td className="val">{nB(stock.fcf, cs)}</td><td className="label">FCF TTM</td><td className="val">{nB(stock.fcf_ttm, cs)}</td><td className="label">EBITDA TTM</td><td className="val">{nB(stock.ebitda_ttm, cs)}</td></tr>
                <tr><td className="label">EPS</td><td className="val">{stock.eps ? `${cs}${n(stock.eps, 2)}` : "\u2014"}</td><td className="label">Fwd EPS</td><td className="val">{stock.forward_eps ? `${cs}${n(stock.forward_eps, 2)}` : "\u2014"}</td><td className="label">Div Yield</td><td className="val">{stock.dividend_yield != null ? `${stock.dividend_yield}%` : "\u2014"}</td></tr>
              </tbody>
            </table>

          {reportMd && (
            <>
              <div className="sec-title">Full Analysis Report</div>
              <div className="report-text">
                <Markdown remarkPlugins={[remarkGfm]}>{reportMd}</Markdown>
              </div>
            </>
          )}

          <div className="footer-end">
            {"The Research Desk \u2022 For educational and informational purposes only. Not financial advice. All investments carry risk."}
          </div>
        </div>
        </div>
      </body>
    </html>
  );
}
