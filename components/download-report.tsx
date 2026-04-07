"use client";

import { useState } from "react";
import type { WatchlistStock } from "@/lib/db";
import { computeCompositeScore } from "@/lib/composite-score";

interface Props {
  stock: WatchlistStock;
}

function ccy(symbol: string): string {
  if (symbol.endsWith(".HK")) return "HK$";
  if (symbol.endsWith(".SS") || symbol.endsWith(".SZ")) return "CNY ";
  return "$";
}

function fmt(v: number | null | undefined, decimals = 1): string {
  if (v == null || isNaN(v)) return "—";
  return v.toFixed(decimals);
}

function fmtB(v: number | null | undefined, cs = "$"): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1000) return `${cs}${(v / 1000).toFixed(1)}T`;
  return `${cs}${v.toFixed(1)}B`;
}

function fmtPct(v: number | string | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "—";
  const val = Math.abs(n) < 1 ? n * 100 : n;
  return val.toFixed(1) + "%";
}

export function DownloadReport({ stock }: Props) {
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      const { jsPDF } = await import("jspdf");
      await import("jspdf-autotable");

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const cs = ccy(stock.symbol);
      const sc = computeCompositeScore(stock);
      const now = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

      type RGB = [number, number, number];
      const NAVY: RGB = [15, 23, 42];
      const BLUE: RGB = [59, 130, 246];
      const GREEN: RGB = [34, 197, 94];
      const RED: RGB = [239, 68, 68];
      const YELLOW: RGB = [234, 179, 8];
      const GRAY: RGB = [148, 163, 184];
      const WHITE: RGB = [255, 255, 255];
      const DARK: RGB = [30, 41, 59];

      function wallColor(text: string | null): RGB {
        if (!text) return GRAY;
        const t = text.toUpperCase();
        if (t.includes("GREEN")) return GREEN;
        if (t.includes("YELLOW")) return YELLOW;
        if (t.includes("RED")) return RED;
        return GRAY;
      }

      function addFooter(pageNum: number) {
        doc.setFillColor(...NAVY);
        doc.rect(0, H - 10, W, 10, "F");
        doc.setTextColor(...GRAY);
        doc.setFontSize(7);
        doc.text("The Research Desk  •  For educational purposes only. Not financial advice.", 15, H - 4);
        doc.text(`Page ${pageNum}`, W - 15, H - 4, { align: "right" });
      }

      // ==================== PAGE 1: COVER ====================
      doc.setFillColor(...NAVY);
      doc.rect(0, 0, W, H, "F");

      doc.setFillColor(...BLUE);
      doc.rect(0, 0, W, 4, "F");

      doc.setTextColor(...WHITE);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("THE RESEARCH DESK", 15, 25);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GRAY);
      doc.text("Investment Research Report", 15, 31);
      doc.text(now, W - 15, 25, { align: "right" });

      doc.setDrawColor(...BLUE);
      doc.setLineWidth(0.3);
      doc.line(15, 36, W - 15, 36);

      doc.setTextColor(...WHITE);
      doc.setFontSize(32);
      doc.setFont("helvetica", "bold");
      doc.text(stock.name || stock.symbol, 15, 60);

      doc.setFontSize(16);
      doc.setTextColor(...BLUE);
      doc.text(stock.symbol, 15, 70);
      doc.setTextColor(...GRAY);
      doc.setFontSize(10);
      doc.text(`${stock.sector || ""} • ${stock.market || ""}`, 15, 77);

      // Score badge
      const scoreY = 55;
      const gradeColor: RGB = sc.total >= 80 ? GREEN : sc.total >= 65 ? [74, 222, 128] : sc.total >= 50 ? YELLOW : sc.total >= 35 ? [249, 115, 22] : RED;
      doc.setFillColor(...gradeColor);
      doc.roundedRect(W - 50, scoreY - 8, 35, 18, 3, 3, "F");
      doc.setTextColor(...NAVY);
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text(String(sc.total), W - 33, scoreY + 4, { align: "center" });
      doc.setFontSize(8);
      doc.text(sc.grade, W - 33, scoreY + 10, { align: "center" });

      // Key metrics row
      let y = 95;
      doc.setFillColor(...DARK);
      doc.roundedRect(15, y, W - 30, 30, 2, 2, "F");

      const metrics = [
        { label: "Price", value: stock.price ? `${cs}${stock.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—" },
        { label: "Market Cap", value: fmtB(stock.market_cap, cs) },
        { label: "PE (TTM)", value: fmt(stock.pe_ttm ?? stock.pe_ratio) },
        { label: "ATH Distance", value: stock.distance_from_ath || "—" },
      ];
      const colW = (W - 30) / metrics.length;
      metrics.forEach((m, i) => {
        const x = 15 + i * colW + colW / 2;
        doc.setTextColor(...GRAY);
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.text(m.label, x, y + 10, { align: "center" });
        doc.setTextColor(...WHITE);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text(m.value, x, y + 20, { align: "center" });
      });

      // Narrative
      y = 140;
      if (stock.narrative) {
        doc.setTextColor(...BLUE);
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text("NARRATIVE", 15, y);
        y += 6;
        doc.setTextColor(...WHITE);
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        const lines = doc.splitTextToSize(stock.narrative, W - 30);
        doc.text(lines.slice(0, 6), 15, y);
        y += lines.slice(0, 6).length * 4.5 + 5;
      }

      // Clock + Walls summary
      doc.setTextColor(...BLUE);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("FRAMEWORK SUMMARY", 15, y);
      y += 7;

      const summaryData = [
        ["Market Clock", stock.clock_position || "—", stock.phase || ""],
        ["Corporate Stage", stock.corporate_stage || "—", ""],
        ["Geometric Order", `${stock.geometric_order ?? 0}`, stock.geometric_details || ""],
        ["TrendWise", stock.trend_signal || "—", stock.trend_entry_date ? `Entry: ${stock.trend_entry_date}` : ""],
        ["HMM Regime", stock.hmm_regime || "—", stock.hmm_persistence != null ? `Persistence: ${(stock.hmm_persistence * 100).toFixed(0)}%` : ""],
        ["Moat", `${stock.moat_width || "—"} ${stock.moat_trend ? `(${stock.moat_trend})` : ""}`, stock.moat_type || ""],
        ["Extreme Score", `${stock.extreme_score ?? "—"}/20`, ""],
        ["Action", stock.action || "—", ""],
      ];

      (doc as any).autoTable({
        startY: y,
        head: [["Layer", "Value", "Detail"]],
        body: summaryData,
        theme: "plain",
        styles: { fillColor: DARK, textColor: WHITE, fontSize: 8, cellPadding: 2.5 },
        headStyles: { fillColor: [30, 58, 95], textColor: BLUE, fontStyle: "bold", fontSize: 7 },
        alternateRowStyles: { fillColor: [20, 30, 48] },
        margin: { left: 15, right: 15 },
        tableWidth: W - 30,
      });

      y = (doc as any).lastAutoTable.finalY + 8;

      // Gravity Walls
      doc.setTextColor(...BLUE);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("GRAVITY WALLS (DAMODARAN)", 15, y);
      y += 7;

      const wallData = [
        ["Revenue Growth", stock.wall_revenue || "—"],
        ["Operating Margins", stock.wall_margins || "—"],
        ["Capital Efficiency", stock.wall_capital || "—"],
        ["Discount Rates", stock.wall_discount || "—"],
      ];

      (doc as any).autoTable({
        startY: y,
        head: [["Wall", "Assessment"]],
        body: wallData,
        theme: "plain",
        styles: { fillColor: DARK, textColor: WHITE, fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [30, 58, 95], textColor: BLUE, fontStyle: "bold", fontSize: 7 },
        margin: { left: 15, right: 15 },
        tableWidth: W - 30,
        didParseCell: (data: any) => {
          if (data.section === "body" && data.column.index === 1) {
            const color = wallColor(data.cell.raw as string);
            data.cell.styles.textColor = [...color];
          }
        },
      });

      addFooter(1);

      // ==================== PAGE 2: FINANCIALS ====================
      doc.addPage();
      doc.setFillColor(...NAVY);
      doc.rect(0, 0, W, H, "F");
      doc.setFillColor(...BLUE);
      doc.rect(0, 0, W, 4, "F");

      y = 18;
      doc.setTextColor(...WHITE);
      doc.setFontSize(8);
      doc.text(`${stock.name} (${stock.symbol})`, 15, y);
      doc.setTextColor(...GRAY);
      doc.text(now, W - 15, y, { align: "right" });

      y = 28;
      doc.setTextColor(...BLUE);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("VALUATION", 15, y);
      y += 6;

      (doc as any).autoTable({
        startY: y,
        body: [
          ["PE (TTM)", fmt(stock.pe_ttm ?? stock.pe_ratio), "Forward PE", fmt(stock.forward_pe)],
          ["P/B", fmt(stock.price_to_book, 2), "EV/EBITDA", fmt(stock.ev_ebitda)],
          ["P/S", fmt(stock.price_to_sales, 2), "EV/Sales", fmt(stock.ev_sales, 2)],
          ["PEG", fmt(stock.peg_ratio, 2), "P/FCF", fmt(stock.price_to_fcf)],
          ["DCF Fair Value", stock.dcf_fair_value ? `${cs}${stock.dcf_fair_value.toFixed(2)}` : "—", "Earnings Yield", stock.earnings_yield ? `${stock.earnings_yield}%` : "—"],
        ],
        theme: "plain",
        styles: { fillColor: DARK, textColor: WHITE, fontSize: 8, cellPadding: 2.5 },
        columnStyles: { 0: { textColor: GRAY, fontStyle: "bold" }, 2: { textColor: GRAY, fontStyle: "bold" } },
        margin: { left: 15, right: 15 },
        tableWidth: W - 30,
      });
      y = (doc as any).lastAutoTable.finalY + 8;

      doc.setTextColor(...BLUE);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("PROFITABILITY", 15, y);
      y += 6;

      (doc as any).autoTable({
        startY: y,
        body: [
          ["ROIC", stock.roic != null ? `${stock.roic}%` : "—", "ROE", stock.roe != null ? `${stock.roe}%` : "—"],
          ["Gross Margin", stock.gross_margin != null ? `${stock.gross_margin}%` : "—", "Op Margin", stock.operating_margin != null ? `${stock.operating_margin}%` : "—"],
          ["Net Margin", stock.net_margin != null ? `${stock.net_margin}%` : "—", "EBITDA Margin", stock.ebitda_margin != null ? `${stock.ebitda_margin}%` : "—"],
        ],
        theme: "plain",
        styles: { fillColor: DARK, textColor: WHITE, fontSize: 8, cellPadding: 2.5 },
        columnStyles: { 0: { textColor: GRAY, fontStyle: "bold" }, 2: { textColor: GRAY, fontStyle: "bold" } },
        margin: { left: 15, right: 15 },
        tableWidth: W - 30,
      });
      y = (doc as any).lastAutoTable.finalY + 8;

      doc.setTextColor(...BLUE);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("GROWTH", 15, y);
      y += 6;

      (doc as any).autoTable({
        startY: y,
        body: [
          ["Rev Growth YoY", fmtPct(stock.revenue_growth_annual), "Earn Growth YoY", fmtPct(stock.earnings_growth_annual)],
          ["Rev Growth TTM", fmtPct(stock.revenue_growth_ttm), "Earn Growth TTM", fmtPct(stock.earnings_growth_ttm)],
          ["Rev CAGR 3Y", fmtPct(stock.revenue_cagr_3y), "Rev CAGR 5Y", fmtPct(stock.revenue_cagr_5y)],
        ],
        theme: "plain",
        styles: { fillColor: DARK, textColor: WHITE, fontSize: 8, cellPadding: 2.5 },
        columnStyles: { 0: { textColor: GRAY, fontStyle: "bold" }, 2: { textColor: GRAY, fontStyle: "bold" } },
        margin: { left: 15, right: 15 },
        tableWidth: W - 30,
      });
      y = (doc as any).lastAutoTable.finalY + 8;

      doc.setTextColor(...BLUE);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("BALANCE SHEET & RISK", 15, y);
      y += 6;

      (doc as any).autoTable({
        startY: y,
        body: [
          ["D/E", fmt(stock.debt_to_equity, 2), "Current Ratio", fmt(stock.current_ratio, 2)],
          ["Debt/EBITDA", fmt(stock.debt_to_ebitda, 2), "Interest Coverage", fmt(stock.interest_coverage)],
          ["Altman Z", fmt(stock.altman_z_score, 2), "Piotroski F", stock.piotroski_score != null ? `${stock.piotroski_score}/9` : "—"],
          ["Beta", fmt(stock.beta, 2), "FCF Yield", stock.fcf_yield ? `${stock.fcf_yield}%` : "—"],
        ],
        theme: "plain",
        styles: { fillColor: DARK, textColor: WHITE, fontSize: 8, cellPadding: 2.5 },
        columnStyles: { 0: { textColor: GRAY, fontStyle: "bold" }, 2: { textColor: GRAY, fontStyle: "bold" } },
        margin: { left: 15, right: 15 },
        tableWidth: W - 30,
      });
      y = (doc as any).lastAutoTable.finalY + 8;

      // Composite Score Breakdown
      doc.setTextColor(...BLUE);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("COMPOSITE SCORE BREAKDOWN", 15, y);
      y += 6;

      (doc as any).autoTable({
        startY: y,
        head: [["Component", "Score", "Max", "Grade"]],
        body: [
          ["Walls", sc.walls, 25, ""],
          ["TrendWise", sc.trendwise, 15, ""],
          ["Clock", sc.clock, 15, ""],
          ["Moat", sc.moat, 15, ""],
          ["Stage", sc.stage, 10, ""],
          ["Geo Order", sc.geo, 10, ""],
          ["Sector", sc.sector, 10, ""],
          ["TOTAL", sc.total, 100, sc.grade],
        ],
        theme: "plain",
        styles: { fillColor: DARK, textColor: WHITE, fontSize: 8, cellPadding: 2.5 },
        headStyles: { fillColor: [30, 58, 95], textColor: BLUE, fontStyle: "bold", fontSize: 7 },
        margin: { left: 15, right: 15 },
        tableWidth: W - 30,
        didParseCell: (data: any) => {
          if (data.section === "body" && data.row.index === 7) {
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.textColor = [...gradeColor];
          }
        },
      });

      addFooter(2);

      // ==================== PAGE 3: ANALYSIS REPORT ====================
      if (stock.analysis_report) {
        doc.addPage();
        doc.setFillColor(...NAVY);
        doc.rect(0, 0, W, H, "F");
        doc.setFillColor(...BLUE);
        doc.rect(0, 0, W, 4, "F");

        y = 18;
        doc.setTextColor(...WHITE);
        doc.setFontSize(8);
        doc.text(`${stock.name} (${stock.symbol})`, 15, y);
        doc.setTextColor(...GRAY);
        doc.text(now, W - 15, y, { align: "right" });

        y = 28;
        doc.setTextColor(...BLUE);
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text("FULL ANALYSIS REPORT", 15, y);
        y += 8;

        const reportText = stock.analysis_report
          .replace(/```[\s\S]*?```/g, "")
          .replace(/\{[\s\S]*\}$/m, "")
          .replace(/#{1,3}\s/g, "")
          .replace(/\*\*/g, "")
          .replace(/\|[^\n]+\|/g, "")
          .replace(/[-]{3,}/g, "")
          .trim();

        doc.setTextColor(...WHITE);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");

        const reportLines = doc.splitTextToSize(reportText, W - 30);
        const lineHeight = 3.8;
        const maxLinesPerPage = Math.floor((H - 40) / lineHeight);

        let lineIdx = 0;
        let pageNum = 3;

        while (lineIdx < reportLines.length) {
          const chunk = reportLines.slice(lineIdx, lineIdx + maxLinesPerPage);
          doc.text(chunk, 15, y);
          lineIdx += maxLinesPerPage;
          addFooter(pageNum);

          if (lineIdx < reportLines.length) {
            doc.addPage();
            doc.setFillColor(...NAVY);
            doc.rect(0, 0, W, H, "F");
            doc.setFillColor(...BLUE);
            doc.rect(0, 0, W, 4, "F");

            pageNum++;
            y = 18;
            doc.setTextColor(...WHITE);
            doc.setFontSize(8);
            doc.setFont("helvetica", "normal");
            doc.text(`${stock.name} (${stock.symbol})`, 15, y);
            doc.setTextColor(...GRAY);
            doc.text(now, W - 15, y, { align: "right" });
            y = 28;
            doc.setTextColor(...WHITE);
          }
        }
      }

      // ==================== LAST PAGE: DISCLAIMER ====================
      const totalPages = doc.getNumberOfPages();
      doc.setPage(totalPages);

      doc.save(`${stock.symbol}-Research-Desk-Report.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
      alert("PDF generation failed. See console for details.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={generate}
      disabled={loading}
      className="text-xs px-4 py-2 rounded-lg font-semibold transition-colors cursor-pointer disabled:opacity-50"
      style={{
        background: "var(--blue)",
        color: "#000",
      }}
    >
      {loading ? "Generating PDF..." : "Download Report"}
    </button>
  );
}
