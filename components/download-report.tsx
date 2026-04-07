"use client";

import { useState } from "react";
import type { WatchlistStock } from "@/lib/db";
import { computeCompositeScore } from "@/lib/composite-score";

interface Props {
  stock: WatchlistStock;
}

function ccy(s: string): string {
  if (s.endsWith(".HK")) return "HK$";
  if (s.endsWith(".SS") || s.endsWith(".SZ")) return "\u00a5";
  return "$";
}
function n(v: number | null | undefined, d = 1): string {
  return v != null && !isNaN(v) ? v.toFixed(d) : "\u2014";
}
function nB(v: number | null | undefined, c = "$"): string {
  if (v == null) return "\u2014";
  return Math.abs(v) >= 1000 ? `${c}${(v / 1000).toFixed(1)}T` : `${c}${v.toFixed(1)}B`;
}
function nP(v: number | string | null | undefined): string {
  if (v == null) return "\u2014";
  const x = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(x)) return "\u2014";
  return (Math.abs(x) < 1 ? x * 100 : x).toFixed(1) + "%";
}

export function DownloadReport({ stock }: Props) {
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF("portrait", "mm", "a4");
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const L = 14, R = W - 14;
      const cs = ccy(stock.symbol);
      const sc = computeCompositeScore(stock);
      const now = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

      type RGB = [number, number, number];
      const NAVY: RGB = [15, 23, 42];
      const BLUE: RGB = [37, 99, 235];
      const GREEN: RGB = [22, 163, 74];
      const RED: RGB = [220, 38, 38];
      const AMBER: RGB = [180, 130, 0];
      const GRAY: RGB = [100, 116, 139];
      const BLACK: RGB = [15, 23, 42];
      const LIGHT: RGB = [241, 245, 249];
      const WHITE: RGB = [255, 255, 255];

      function wc(t: string | null): RGB {
        if (!t) return GRAY;
        const u = t.toUpperCase();
        return u.includes("GREEN") ? GREEN : u.includes("YELLOW") ? AMBER : u.includes("RED") ? RED : GRAY;
      }
      const gc: RGB = sc.total >= 80 ? GREEN : sc.total >= 65 ? [34, 197, 94] : sc.total >= 50 ? AMBER : sc.total >= 35 ? [234, 88, 12] : RED;

      let pg = 0;

      function header() {
        doc.setFillColor(...NAVY);
        doc.rect(0, 0, W, 18, "F");
        doc.setTextColor(...WHITE);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text("THE RESEARCH DESK", L, 8);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text("Investment Research Report", L, 13);
        doc.setTextColor(180, 200, 230);
        doc.text(now, R, 8, { align: "right" });
        doc.setFontSize(6);
        doc.text(`${stock.symbol} \u2022 ${stock.sector || ""}`, R, 13, { align: "right" });
      }

      function footer() {
        pg++;
        doc.setDrawColor(200, 210, 220);
        doc.setLineWidth(0.2);
        doc.line(L, H - 10, R, H - 10);
        doc.setTextColor(...GRAY);
        doc.setFontSize(5.5);
        doc.text("The Research Desk \u2022 For educational purposes only. Not financial advice. All investments carry risk.", L, H - 6);
        doc.text(`Page ${pg}`, R, H - 6, { align: "right" });
      }

      function newPage() {
        if (pg > 0) doc.addPage();
        header();
      }

      function title(text: string, y: number): number {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(...BLUE);
        doc.text(text, L, y);
        doc.setDrawColor(...BLUE);
        doc.setLineWidth(0.3);
        doc.line(L, y + 1.5, L + doc.getTextWidth(text), y + 1.5);
        return y + 6;
      }

      function kv(label: string, value: string, x: number, y: number, bold = false) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.setTextColor(...GRAY);
        doc.text(label, x, y);
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.setFontSize(8);
        doc.setTextColor(...BLACK);
        doc.text(value, x, y + 4.5);
      }

      const tbl = {
        theme: "grid" as const,
        styles: { fontSize: 7.5, cellPadding: 1.8, lineColor: [220, 225, 230] as RGB, lineWidth: 0.15, textColor: BLACK },
        headStyles: { fillColor: LIGHT, textColor: NAVY, fontStyle: "bold" as const, fontSize: 7 },
        alternateRowStyles: { fillColor: [248, 250, 252] as RGB },
        margin: { left: L, right: L + 0.01 },
        tableWidth: R - L,
      };

      // ============ PAGE 1: COVER ============
      newPage();
      let y = 24;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.setTextColor(...BLACK);
      const nameLines = doc.splitTextToSize(stock.name || stock.symbol, R - L - 35);
      doc.text(nameLines, L, y);
      y += nameLines.length * 7.5;

      doc.setFontSize(11);
      doc.setTextColor(...BLUE);
      doc.text(stock.symbol, L, y);
      doc.setTextColor(...GRAY);
      doc.setFontSize(8);
      doc.text(`${stock.sector || ""} \u2022 ${stock.market || ""}`, L + doc.getTextWidth(stock.symbol + "  "), y);

      doc.setFillColor(...gc);
      doc.roundedRect(R - 24, 22, 24, 14, 2, 2, "F");
      doc.setTextColor(...WHITE);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(String(sc.total), R - 12, 30, { align: "center" });
      doc.setFontSize(5.5);
      doc.text(sc.grade, R - 12, 34.5, { align: "center" });

      y += 6;

      doc.setFillColor(...LIGHT);
      doc.roundedRect(L, y, R - L, 16, 1.5, 1.5, "F");
      const ms = [
        { l: "Price", v: stock.price ? `${cs}${stock.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "\u2014" },
        { l: "Market Cap", v: nB(stock.market_cap, cs) },
        { l: "PE (TTM)", v: n(stock.pe_ttm ?? stock.pe_ratio) },
        { l: "52W Range", v: stock.low_52w && stock.high_52w ? `${cs}${n(stock.low_52w)} \u2013 ${cs}${n(stock.high_52w)}` : "\u2014" },
        { l: "ATH", v: stock.distance_from_ath || "\u2014" },
      ];
      const cW = (R - L) / ms.length;
      ms.forEach((m, i) => kv(m.l, m.v, L + 3 + i * cW, y + 4, true));
      y += 22;

      if (stock.narrative) {
        y = title("Narrative", y);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...BLACK);
        const nl = doc.splitTextToSize(stock.narrative, R - L);
        doc.text(nl.slice(0, 6), L, y);
        y += Math.min(nl.length, 6) * 3.8 + 4;
      }

      y = title("Framework Summary", y);
      autoTable(doc, {
        ...tbl, startY: y,
        head: [["Layer", "Value", "Detail"]],
        body: [
          ["Market Clock", stock.clock_position || "\u2014", stock.phase || ""],
          ["Corporate Stage", stock.corporate_stage || "\u2014", ""],
          ["Geometric Order", `${stock.geometric_order ?? 0}`, stock.geometric_details || ""],
          ["TrendWise", stock.trend_signal || "\u2014", stock.trend_entry_date ? `Entry: ${stock.trend_entry_date} @ ${cs}${stock.trend_entry_price}` : ""],
          ["HMM Regime", stock.hmm_regime || "\u2014", stock.hmm_persistence != null ? `Persistence: ${(stock.hmm_persistence * 100).toFixed(0)}%` : ""],
          ["Moat", `${stock.moat_width || "\u2014"} ${stock.moat_trend ? `(${stock.moat_trend})` : ""}`, stock.moat_type || ""],
          ["Extreme Score", `${stock.extreme_score ?? "\u2014"}/20`, ""],
          ["Action", stock.action || "\u2014", stock.buy_reason || ""],
        ],
        columnStyles: { 0: { fontStyle: "bold" as const, cellWidth: 30 }, 1: { cellWidth: 35 } },
      });
      y = (doc as any).lastAutoTable.finalY + 5;

      if (y > H - 45) { footer(); newPage(); y = 24; }
      y = title("Gravity Walls (Damodaran)", y);
      autoTable(doc, {
        ...tbl, startY: y,
        head: [["Wall", "Assessment"]],
        body: [
          ["Revenue Growth", stock.wall_revenue || "\u2014"],
          ["Operating Margins", stock.wall_margins || "\u2014"],
          ["Capital Efficiency", stock.wall_capital || "\u2014"],
          ["Discount Rates", stock.wall_discount || "\u2014"],
        ],
        columnStyles: { 0: { fontStyle: "bold" as const, cellWidth: 35 } },
        didParseCell: (d: any) => { if (d.section === "body" && d.column.index === 1) d.cell.styles.textColor = [...wc(d.cell.raw)]; },
      });

      footer();

      // ============ PAGE 2: FINANCIALS ============
      newPage();
      y = 24;

      y = title("Valuation", y);
      autoTable(doc, {
        ...tbl, startY: y,
        body: [
          ["PE (TTM)", n(stock.pe_ttm ?? stock.pe_ratio), "Forward PE", n(stock.forward_pe), "PEG", n(stock.peg_ratio, 2)],
          ["P/B", n(stock.price_to_book, 2), "EV/EBITDA", n(stock.ev_ebitda), "EV/Sales", n(stock.ev_sales, 2)],
          ["P/S", n(stock.price_to_sales, 2), "P/FCF", n(stock.price_to_fcf), "Earn Yield", stock.earnings_yield ? `${stock.earnings_yield}%` : "\u2014"],
          ["DCF Fair", stock.dcf_fair_value ? `${cs}${stock.dcf_fair_value.toFixed(2)}` : "\u2014", "DCF Levered", stock.dcf_levered ? `${cs}${stock.dcf_levered.toFixed(2)}` : "\u2014", "", ""],
        ],
        columnStyles: { 0: { fontStyle: "bold" as const, textColor: GRAY }, 2: { fontStyle: "bold" as const, textColor: GRAY }, 4: { fontStyle: "bold" as const, textColor: GRAY } },
      });
      y = (doc as any).lastAutoTable.finalY + 5;

      y = title("Profitability", y);
      autoTable(doc, {
        ...tbl, startY: y,
        body: [
          ["ROIC", stock.roic != null ? `${stock.roic}%` : "\u2014", "ROE", stock.roe != null ? `${stock.roe}%` : "\u2014", "ROA", stock.roa != null ? `${stock.roa}%` : "\u2014"],
          ["Gross Mgn", stock.gross_margin != null ? `${stock.gross_margin}%` : "\u2014", "Op Mgn", stock.operating_margin != null ? `${stock.operating_margin}%` : "\u2014", "Net Mgn", stock.net_margin != null ? `${stock.net_margin}%` : "\u2014"],
        ],
        columnStyles: { 0: { fontStyle: "bold" as const, textColor: GRAY }, 2: { fontStyle: "bold" as const, textColor: GRAY }, 4: { fontStyle: "bold" as const, textColor: GRAY } },
      });
      y = (doc as any).lastAutoTable.finalY + 5;

      y = title("Growth", y);
      autoTable(doc, {
        ...tbl, startY: y,
        body: [
          ["Rev YoY", nP(stock.revenue_growth_annual), "Earn YoY", nP(stock.earnings_growth_annual), "Rev CAGR 3Y", nP(stock.revenue_cagr_3y)],
          ["Rev TTM", nP(stock.revenue_growth_ttm), "Earn TTM", nP(stock.earnings_growth_ttm), "Rev CAGR 5Y", nP(stock.revenue_cagr_5y)],
          ["Rev Qtr", nP(stock.revenue_growth_recent_q), "Earn Qtr", nP(stock.earnings_growth_recent_q), "", ""],
        ],
        columnStyles: { 0: { fontStyle: "bold" as const, textColor: GRAY }, 2: { fontStyle: "bold" as const, textColor: GRAY }, 4: { fontStyle: "bold" as const, textColor: GRAY } },
      });
      y = (doc as any).lastAutoTable.finalY + 5;

      y = title("Balance Sheet & Risk", y);
      autoTable(doc, {
        ...tbl, startY: y,
        body: [
          ["D/E", n(stock.debt_to_equity, 2), "Current", n(stock.current_ratio, 2), "Int Cov", n(stock.interest_coverage)],
          ["Debt/EBITDA", n(stock.debt_to_ebitda, 2), "Altman Z", n(stock.altman_z_score, 2), "Piotroski", stock.piotroski_score != null ? `${stock.piotroski_score}/9` : "\u2014"],
          ["Beta", n(stock.beta, 2), "FCF Yield", stock.fcf_yield ? `${stock.fcf_yield}%` : "\u2014", "SH Yield", stock.shareholder_yield ? `${stock.shareholder_yield}%` : "\u2014"],
        ],
        columnStyles: { 0: { fontStyle: "bold" as const, textColor: GRAY }, 2: { fontStyle: "bold" as const, textColor: GRAY }, 4: { fontStyle: "bold" as const, textColor: GRAY } },
      });
      y = (doc as any).lastAutoTable.finalY + 5;

      y = title("Composite Score Breakdown", y);
      autoTable(doc, {
        ...tbl, startY: y,
        head: [["Component", "Score", "Max", "", "Component", "Score", "Max"]],
        body: [
          ["Walls", String(sc.walls), "25", "", "Moat", String(sc.moat), "15"],
          ["TrendWise", String(sc.trendwise), "15", "", "Stage", String(sc.stage), "10"],
          ["Clock", String(sc.clock), "15", "", "Geo Order", String(sc.geo), "10"],
          ["Sector", String(sc.sector), "10", "", "TOTAL", String(sc.total), "100"],
        ],
        columnStyles: { 0: { fontStyle: "bold" as const }, 3: { cellWidth: 4 }, 4: { fontStyle: "bold" as const } },
        didParseCell: (d: any) => {
          if (d.section === "body" && d.row.index === 3 && (d.column.index === 4 || d.column.index === 5)) {
            d.cell.styles.fontStyle = "bold";
            d.cell.styles.textColor = [...gc];
          }
        },
      });

      footer();

      // ============ PAGE 3+: ANALYSIS REPORT ============
      if (stock.analysis_report) {
        newPage();
        y = 22;
        y = title("Full Analysis Report", y);

        const text = stock.analysis_report
          .replace(/```[\s\S]*?```/g, "")
          .replace(/\{[\s\S]*\}$/m, "")
          .replace(/\*\*/g, "")
          .replace(/\|[^\n]+\|/g, "")
          .replace(/[-]{3,}/g, "")
          .replace(/#{1,3}\s*/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...BLACK);
        const lines = doc.splitTextToSize(text, R - L);
        const lh = 3.3;

        for (const line of lines) {
          if (y + lh > H - 14) { footer(); newPage(); y = 22; doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...BLACK); }
          doc.text(line, L, y);
          y += lh;
        }
        footer();
      }

      doc.save(`${stock.symbol}-Research-Desk-Report.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={generate} disabled={loading}
      className="text-xs px-4 py-2 rounded-lg font-semibold transition-colors cursor-pointer disabled:opacity-50"
      style={{ background: "var(--blue)", color: "#000" }}>
      {loading ? "Generating..." : "Download Report"}
    </button>
  );
}
