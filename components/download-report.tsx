"use client";

import { useState } from "react";
import type { WatchlistStock } from "@/lib/db";
import { computeCompositeScore } from "@/lib/composite-score";

interface Props { stock: WatchlistStock }

const $ = (s: string) => s.endsWith(".HK") ? "HK$" : s.endsWith(".SS") || s.endsWith(".SZ") ? "\u00a5" : "$";
const N = (v: number | null | undefined, d = 1) => v != null && !isNaN(v) ? v.toFixed(d) : "\u2014";
const NB = (v: number | null | undefined, c = "$") => v == null ? "\u2014" : Math.abs(v) >= 1000 ? `${c}${(v / 1000).toFixed(1)}T` : `${c}${v.toFixed(1)}B`;
const NP = (v: number | string | null | undefined) => { if (v == null) return "\u2014"; const x = typeof v === "string" ? parseFloat(v) : v; return isNaN(x) ? "\u2014" : (Math.abs(x) < 1 ? x * 100 : x).toFixed(1) + "%"; };

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
      const L = 12, R = W - 12;
      const cs = $(stock.symbol);
      const sc = computeCompositeScore(stock);
      const now = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

      type RGB = [number, number, number];
      const BLUE: RGB = [0, 51, 102];
      const LBLUE: RGB = [0, 82, 155];
      const GREEN: RGB = [0, 128, 0];
      const RED: RGB = [180, 0, 0];
      const AMBER: RGB = [180, 120, 0];
      const GRAY: RGB = [100, 100, 110];
      const DGRAY: RGB = [50, 50, 60];
      const BLACK: RGB = [20, 20, 30];
      const LIGHT: RGB = [240, 243, 247];
      const BORDER: RGB = [200, 208, 218];

      const gc: RGB = sc.total >= 80 ? GREEN : sc.total >= 65 ? [34, 150, 60] : sc.total >= 50 ? AMBER : RED;
      const gradeMap: Record<string, string> = { "Strong Buy": "STRONG BUY", "Buy": "BUY", "Watch": "WATCH", "Caution": "CAUTION", "Avoid": "AVOID" };
      const rating = gradeMap[sc.grade] || sc.grade.toUpperCase();

      function wc(t: string | null): RGB { if (!t) return GRAY; const u = t.toUpperCase(); return u.includes("GREEN") ? GREEN : u.includes("YELLOW") ? AMBER : u.includes("RED") ? RED : GRAY; }

      let pg = 0;

      function drawHeader() {
        doc.setFillColor(...BLUE);
        doc.rect(0, 0, W, 1.5, "F");
        doc.setFillColor(...LIGHT);
        doc.rect(0, 1.5, W, 11, "F");
        doc.setDrawColor(...BORDER);
        doc.setLineWidth(0.2);
        doc.line(0, 12.5, W, 12.5);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...BLUE);
        doc.text("THE RESEARCH DESK", L, 6);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6);
        doc.setTextColor(...GRAY);
        doc.text("EQUITY RESEARCH", L, 10);

        doc.setTextColor(...DGRAY);
        doc.setFontSize(6);
        doc.text(now, R, 6, { align: "right" });
        doc.text(`${stock.symbol} \u2022 ${stock.sector || ""}`, R, 10, { align: "right" });
      }

      function drawFooter() {
        pg++;
        doc.setDrawColor(...BORDER);
        doc.setLineWidth(0.15);
        doc.line(L, H - 10, R, H - 10);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(5);
        doc.setTextColor(...GRAY);
        doc.text("The Research Desk \u2022 This report is for educational and informational purposes only. Not financial advice. All investments carry risk.", L, H - 7);
        doc.setTextColor(...BLUE);
        doc.text(`${pg}`, R, H - 7, { align: "right" });
      }

      function page() { if (pg > 0) doc.addPage(); drawHeader(); }

      function secTitle(text: string, y: number): number {
        doc.setFillColor(...BLUE);
        doc.rect(L, y - 3, 1.2, 5, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(...BLUE);
        doc.text(text, L + 4, y);
        return y + 5;
      }

      const tbl = {
        theme: "plain" as const,
        styles: { fontSize: 7, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, textColor: BLACK, lineColor: BORDER, lineWidth: 0.1 },
        headStyles: { fillColor: LIGHT, textColor: BLUE, fontStyle: "bold" as const, fontSize: 6.5 },
        alternateRowStyles: { fillColor: [250, 251, 253] as RGB },
        margin: { left: L, right: 12.01 },
        tableWidth: R - L,
      };

      // ============ PAGE 1 ============
      page();
      let y = 17;

      // Company name + Rating box
      const ratingW = 36;
      const nameW = R - L - ratingW - 4;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(...BLACK);
      const nameLines = doc.splitTextToSize(stock.name || stock.symbol, nameW);
      doc.text(nameLines, L, y + 5);
      const nameH = nameLines.length * 6;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...LBLUE);
      doc.text(stock.symbol, L, y + nameH + 3);
      doc.setTextColor(...GRAY);
      doc.setFontSize(7);
      const subX = L + doc.getTextWidth(stock.symbol + "  ") + 8;
      doc.text(`${stock.sector || ""} \u2022 ${stock.market || ""}`, subX, y + nameH + 3);

      // Rating box (GS-style)
      const rX = R - ratingW;
      doc.setFillColor(...gc);
      doc.roundedRect(rX, y, ratingW, 12, 1.5, 1.5, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(rating, rX + ratingW / 2, y + 5.5, { align: "center" });
      doc.setFontSize(6);
      doc.text(`Score: ${sc.total}/100`, rX + ratingW / 2, y + 10, { align: "center" });

      // Key data box
      const kdY = y + 14;
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.3);
      doc.rect(rX, kdY, ratingW, 40, "S");
      doc.setFillColor(...LIGHT);
      doc.rect(rX, kdY, ratingW, 6, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(...BLUE);
      doc.text("Key Financial Data", rX + 2, kdY + 4);

      const kdItems = [
        ["Price", stock.price ? `${cs}${stock.price.toFixed(2)}` : "\u2014"],
        ["Market Cap", NB(stock.market_cap, cs)],
        ["PE (TTM)", N(stock.pe_ttm ?? stock.pe_ratio)],
        ["Forward PE", N(stock.forward_pe)],
        ["P/B", N(stock.price_to_book, 2)],
        ["Div Yield", stock.dividend_yield != null ? `${stock.dividend_yield}%` : "\u2014"],
        ["ROE", stock.roe != null ? `${stock.roe}%` : "\u2014"],
        ["ROIC", stock.roic != null ? `${stock.roic}%` : "\u2014"],
        ["Beta", N(stock.beta, 2)],
      ];
      let kdRowY = kdY + 9;
      kdItems.forEach(([label, value]) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(5.5);
        doc.setTextColor(...GRAY);
        doc.text(label, rX + 2, kdRowY);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...BLACK);
        doc.text(value, rX + ratingW - 2, kdRowY, { align: "right" });
        kdRowY += 3.5;
      });

      y = y + nameH + 10;

      // Investment Overview / Narrative
      const contentW = nameW;
      if (stock.narrative) {
        y = secTitle("Investment Overview", y);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...BLACK);
        const nl = doc.splitTextToSize(stock.narrative, contentW);
        doc.text(nl, L, y);
        y += nl.length * 3.3 + 4;
      }

      // Clock + Framework
      y = secTitle("Framework Positioning", y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...BLACK);
      const fwLines = [
        `Market Clock: ${stock.clock_position || "\u2014"} (${stock.phase || ""})`,
        `Corporate Stage: ${stock.corporate_stage || "\u2014"}`,
        `Geometric Order: ${stock.geometric_order ?? 0} (${stock.geometric_details || ""})`,
        `TrendWise: ${stock.trend_signal || "\u2014"}${stock.trend_entry_date ? ` \u2014 Entry: ${stock.trend_entry_date} @ ${cs}${stock.trend_entry_price}` : ""}`,
        `HMM Regime: ${stock.hmm_regime || "\u2014"}${stock.hmm_persistence != null ? ` (Persistence: ${(stock.hmm_persistence * 100).toFixed(0)}%)` : ""}`,
        `Moat: ${stock.moat_width || "\u2014"} ${stock.moat_trend ? `(${stock.moat_trend})` : ""} \u2014 ${stock.moat_type || ""}`,
        `Extreme Score: ${stock.extreme_score ?? "\u2014"}/20`,
        `Action: ${stock.action || "\u2014"}`,
      ];
      fwLines.forEach((line) => {
        const parts = line.split(": ");
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...DGRAY);
        doc.text(parts[0] + ":", L, y);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...BLACK);
        const rest = parts.slice(1).join(": ");
        const valLines = doc.splitTextToSize(rest, contentW - 35);
        doc.text(valLines, L + 33, y);
        y += valLines.length * 3.3 + 0.5;
      });
      y += 3;

      // Gravity Walls
      if (y > H - 40) { drawFooter(); page(); y = 17; }
      y = secTitle("Gravity Walls (Damodaran)", y);
      const walls = [
        ["Revenue Growth", stock.wall_revenue],
        ["Operating Margins", stock.wall_margins],
        ["Capital Efficiency", stock.wall_capital],
        ["Discount Rates", stock.wall_discount],
      ];
      walls.forEach(([label, val]) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...DGRAY);
        doc.text(label as string, L + 4, y);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...wc(val as string));
        const wLines = doc.splitTextToSize((val as string) || "\u2014", contentW - 40);
        doc.text(wLines, L + 38, y);
        y += wLines.length * 3 + 1.5;
      });

      // Buy Reason
      if (stock.buy_reason) {
        y += 2;
        y = secTitle("Buy Conditions (7-Gate)", y);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(...BLACK);
        const brLines = doc.splitTextToSize(stock.buy_reason, R - L);
        doc.text(brLines, L, y);
        y += brLines.length * 3 + 2;
      }

      drawFooter();

      // ============ PAGE 2: FINANCIALS ============
      page();
      y = 17;

      y = secTitle("Valuation", y);
      autoTable(doc, { ...tbl, startY: y,
        body: [
          ["PE (TTM)", N(stock.pe_ttm ?? stock.pe_ratio), "Fwd PE", N(stock.forward_pe), "PEG", N(stock.peg_ratio, 2)],
          ["P/B", N(stock.price_to_book, 2), "EV/EBITDA", N(stock.ev_ebitda), "EV/Sales", N(stock.ev_sales, 2)],
          ["P/S", N(stock.price_to_sales, 2), "P/FCF", N(stock.price_to_fcf), "Earn Yield", stock.earnings_yield ? `${stock.earnings_yield}%` : "\u2014"],
          ["DCF Fair", stock.dcf_fair_value ? `${cs}${stock.dcf_fair_value.toFixed(2)}` : "\u2014", "DCF Lev", stock.dcf_levered ? `${cs}${stock.dcf_levered.toFixed(2)}` : "\u2014", "Upside", stock.dcf_fair_value && stock.price ? `${(((stock.dcf_fair_value - stock.price) / stock.price) * 100).toFixed(1)}%` : "\u2014"],
        ],
        columnStyles: { 0: { fontStyle: "bold" as const, textColor: GRAY, cellWidth: 22 }, 2: { fontStyle: "bold" as const, textColor: GRAY, cellWidth: 22 }, 4: { fontStyle: "bold" as const, textColor: GRAY, cellWidth: 22 } },
      });
      y = (doc as any).lastAutoTable.finalY + 4;

      y = secTitle("Profitability & Margins", y);
      autoTable(doc, { ...tbl, startY: y,
        body: [
          ["ROIC", stock.roic != null ? `${stock.roic}%` : "\u2014", "ROE", stock.roe != null ? `${stock.roe}%` : "\u2014", "ROA", stock.roa != null ? `${stock.roa}%` : "\u2014"],
          ["Gross", stock.gross_margin != null ? `${stock.gross_margin}%` : "\u2014", "Operating", stock.operating_margin != null ? `${stock.operating_margin}%` : "\u2014", "Net", stock.net_margin != null ? `${stock.net_margin}%` : "\u2014"],
          ["EBITDA Mgn", stock.ebitda_margin != null ? `${stock.ebitda_margin}%` : "\u2014", "FCF Yield", stock.fcf_yield ? `${stock.fcf_yield}%` : "\u2014", "SH Yield", stock.shareholder_yield ? `${stock.shareholder_yield}%` : "\u2014"],
        ],
        columnStyles: { 0: { fontStyle: "bold" as const, textColor: GRAY, cellWidth: 22 }, 2: { fontStyle: "bold" as const, textColor: GRAY, cellWidth: 22 }, 4: { fontStyle: "bold" as const, textColor: GRAY, cellWidth: 22 } },
      });
      y = (doc as any).lastAutoTable.finalY + 4;

      y = secTitle("Revenue & Earnings Growth", y);
      autoTable(doc, { ...tbl, startY: y,
        body: [
          ["Rev YoY", NP(stock.revenue_growth_annual), "Earn YoY", NP(stock.earnings_growth_annual), "Rev CAGR 3Y", NP(stock.revenue_cagr_3y)],
          ["Rev TTM", NP(stock.revenue_growth_ttm), "Earn TTM", NP(stock.earnings_growth_ttm), "Rev CAGR 5Y", NP(stock.revenue_cagr_5y)],
          ["Rev Qtr", NP(stock.revenue_growth_recent_q), "Earn Qtr", NP(stock.earnings_growth_recent_q), "Earn CAGR 3Y", NP(stock.earnings_cagr_3y)],
        ],
        columnStyles: { 0: { fontStyle: "bold" as const, textColor: GRAY, cellWidth: 22 }, 2: { fontStyle: "bold" as const, textColor: GRAY, cellWidth: 22 }, 4: { fontStyle: "bold" as const, textColor: GRAY, cellWidth: 22 } },
      });
      y = (doc as any).lastAutoTable.finalY + 4;

      y = secTitle("Balance Sheet & Credit", y);
      autoTable(doc, { ...tbl, startY: y,
        body: [
          ["D/E", N(stock.debt_to_equity, 2), "Current", N(stock.current_ratio, 2), "Int Cov", N(stock.interest_coverage)],
          ["Debt/EBITDA", N(stock.debt_to_ebitda, 2), "Altman Z", N(stock.altman_z_score, 2), "Piotroski", stock.piotroski_score != null ? `${stock.piotroski_score}/9` : "\u2014"],
          ["Beta", N(stock.beta, 2), "52W Low", stock.low_52w ? `${cs}${N(stock.low_52w)}` : "\u2014", "52W High", stock.high_52w ? `${cs}${N(stock.high_52w)}` : "\u2014"],
        ],
        columnStyles: { 0: { fontStyle: "bold" as const, textColor: GRAY, cellWidth: 22 }, 2: { fontStyle: "bold" as const, textColor: GRAY, cellWidth: 22 }, 4: { fontStyle: "bold" as const, textColor: GRAY, cellWidth: 22 } },
      });
      y = (doc as any).lastAutoTable.finalY + 4;

      y = secTitle("Fundamentals", y);
      autoTable(doc, { ...tbl, startY: y,
        body: [
          ["Revenue", NB(stock.revenue, cs), "Rev TTM", NB(stock.revenue_ttm, cs), "Net Inc TTM", NB(stock.net_income_ttm, cs)],
          ["FCF", NB(stock.fcf, cs), "FCF TTM", NB(stock.fcf_ttm, cs), "EBITDA TTM", NB(stock.ebitda_ttm, cs)],
          ["EPS", stock.eps ? `${cs}${N(stock.eps, 2)}` : "\u2014", "Fwd EPS", stock.forward_eps ? `${cs}${N(stock.forward_eps, 2)}` : "\u2014", "Div Yield", stock.dividend_yield != null ? `${stock.dividend_yield}%` : "\u2014"],
        ],
        columnStyles: { 0: { fontStyle: "bold" as const, textColor: GRAY, cellWidth: 22 }, 2: { fontStyle: "bold" as const, textColor: GRAY, cellWidth: 22 }, 4: { fontStyle: "bold" as const, textColor: GRAY, cellWidth: 22 } },
      });
      y = (doc as any).lastAutoTable.finalY + 4;

      y = secTitle("Composite Score Breakdown", y);
      autoTable(doc, { ...tbl, startY: y,
        head: [["Walls", "Trend", "Clock", "Moat", "Stage", "Geo", "Sector", "TOTAL"]],
        body: [[String(sc.walls) + "/25", String(sc.trendwise) + "/15", String(sc.clock) + "/15", String(sc.moat) + "/15", String(sc.stage) + "/10", String(sc.geo) + "/10", String(sc.sector) + "/10", String(sc.total) + "/100"]],
        didParseCell: (d: any) => { if (d.section === "body" && d.column.index === 7) { d.cell.styles.fontStyle = "bold"; d.cell.styles.textColor = [...gc]; } },
      });

      drawFooter();

      // ============ PAGE 3+: ANALYSIS REPORT ============
      if (stock.analysis_report) {
        page();
        y = 16;
        y = secTitle("Full Analysis Report", y);

        const text = stock.analysis_report
          .replace(/```[\s\S]*?```/g, "").replace(/\{[\s\S]*\}$/m, "")
          .replace(/\*\*/g, "").replace(/\|[^\n]+\|/g, "").replace(/[-]{3,}/g, "")
          .replace(/#{1,3}\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(...BLACK);
        const lines = doc.splitTextToSize(text, R - L);

        for (const line of lines) {
          if (y + 3.2 > H - 14) { drawFooter(); page(); y = 16; doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...BLACK); }
          doc.text(line, L, y);
          y += 3.2;
        }
        drawFooter();
      }

      doc.save(`${stock.symbol}-Research-Desk-Report.pdf`);
    } catch (err) { console.error("PDF generation failed:", err); }
    finally { setLoading(false); }
  }

  return (
    <button onClick={generate} disabled={loading}
      className="text-xs px-4 py-2 rounded-lg font-semibold transition-colors cursor-pointer disabled:opacity-50"
      style={{ background: "var(--blue)", color: "#000" }}>
      {loading ? "Generating..." : "Download Report"}
    </button>
  );
}
