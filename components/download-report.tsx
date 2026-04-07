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

function fmt(v: number | null | undefined, d = 1): string {
  if (v == null || isNaN(v)) return "\u2014";
  return v.toFixed(d);
}

function fmtB(v: number | null | undefined, cs = "$"): string {
  if (v == null) return "\u2014";
  if (Math.abs(v) >= 1000) return `${cs}${(v / 1000).toFixed(1)}T`;
  return `${cs}${v.toFixed(1)}B`;
}

function fmtPct(v: number | string | null | undefined): string {
  if (v == null) return "\u2014";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "\u2014";
  const val = Math.abs(n) < 1 ? n * 100 : n;
  return val.toFixed(1) + "%";
}

export function DownloadReport({ stock }: Props) {
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      const jspdfModule = await import("jspdf");
      const jsPDF = jspdfModule.jsPDF;
      const autoTableModule = await import("jspdf-autotable");
      const autoTable = autoTableModule.default;

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const M = 15;
      const cs = ccy(stock.symbol);
      const sc = computeCompositeScore(stock);
      const now = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      type RGB = [number, number, number];
      const NAVY: RGB = [15, 23, 42];
      const BLUE: RGB = [59, 130, 246];
      const GREEN: RGB = [34, 197, 94];
      const RED: RGB = [239, 68, 68];
      const YELLOW: RGB = [234, 179, 8];
      const GRAY: RGB = [148, 163, 184];
      const WHITE: RGB = [255, 255, 255];
      const DARK: RGB = [30, 41, 59];
      const HEADER_BG: RGB = [30, 58, 95];

      const gradeColor: RGB =
        sc.total >= 80 ? GREEN : sc.total >= 65 ? [74, 222, 128] : sc.total >= 50 ? YELLOW : sc.total >= 35 ? [249, 115, 22] : RED;

      function wallColor(text: string | null): RGB {
        if (!text) return GRAY;
        const t = text.toUpperCase();
        if (t.includes("GREEN")) return GREEN;
        if (t.includes("YELLOW")) return YELLOW;
        if (t.includes("RED")) return RED;
        return GRAY;
      }

      function applyPageBg() {
        doc.setFillColor(...NAVY);
        doc.rect(0, 0, W, H, "F");
        doc.setFillColor(...BLUE);
        doc.rect(0, 0, W, 3, "F");
      }

      function addHeader(subtitle?: string) {
        doc.setTextColor(...WHITE);
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.text("THE RESEARCH DESK", M, 12);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...GRAY);
        doc.setFontSize(7);
        doc.text(subtitle || "Investment Research Report", M, 16);
        doc.text(now, W - M, 12, { align: "right" });
        doc.setDrawColor(...BLUE);
        doc.setLineWidth(0.2);
        doc.line(M, 19, W - M, 19);
      }

      function addFooter(pageNum: number) {
        doc.setFillColor(10, 15, 30);
        doc.rect(0, H - 8, W, 8, "F");
        doc.setTextColor(...GRAY);
        doc.setFontSize(6);
        doc.text(
          "The Research Desk  \u2022  For educational purposes only. Not financial advice.",
          M,
          H - 3
        );
        doc.text(`Page ${pageNum}`, W - M, H - 3, { align: "right" });
      }

      function sectionTitle(title: string, y: number): number {
        doc.setTextColor(...BLUE);
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.text(title, M, y);
        return y + 5;
      }

      const tableDefaults = {
        theme: "plain" as const,
        styles: { fillColor: DARK, textColor: WHITE, fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: HEADER_BG, textColor: BLUE, fontStyle: "bold" as const, fontSize: 6.5 },
        alternateRowStyles: { fillColor: [22, 33, 52] as RGB },
        margin: { left: M, right: M },
        tableWidth: W - M * 2,
        didDrawPage: () => {
          applyPageBg();
          addHeader(`${stock.name} (${stock.symbol})`);
        },
      };

      let pageNum = 1;

      // ===================== PAGE 1: COVER =====================
      applyPageBg();
      addHeader();

      let y = 28;

      doc.setTextColor(...WHITE);
      doc.setFontSize(22);
      doc.setFont("helvetica", "bold");
      const nameLines = doc.splitTextToSize(stock.name || stock.symbol, W - M * 2 - 45);
      doc.text(nameLines, M, y);
      y += nameLines.length * 8 + 2;

      doc.setFontSize(12);
      doc.setTextColor(...BLUE);
      doc.text(stock.symbol, M, y);
      doc.setTextColor(...GRAY);
      doc.setFontSize(8);
      doc.text(`${stock.sector || ""} \u2022 ${stock.market || ""}`, M + doc.getTextWidth(stock.symbol) + 4, y);

      // Score badge
      doc.setFillColor(...gradeColor);
      doc.roundedRect(W - M - 28, 26, 28, 16, 2, 2, "F");
      doc.setTextColor(...NAVY);
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text(String(sc.total), W - M - 14, 35, { align: "center" });
      doc.setFontSize(6);
      doc.text(sc.grade, W - M - 14, 40, { align: "center" });

      y += 8;

      // Key metrics
      doc.setFillColor(...DARK);
      doc.roundedRect(M, y, W - M * 2, 18, 2, 2, "F");
      const metrics = [
        { label: "Price", value: stock.price ? `${cs}${stock.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "\u2014" },
        { label: "Market Cap", value: fmtB(stock.market_cap, cs) },
        { label: "PE (TTM)", value: fmt(stock.pe_ttm ?? stock.pe_ratio) },
        { label: "ATH Distance", value: stock.distance_from_ath || "\u2014" },
      ];
      const colW = (W - M * 2) / metrics.length;
      metrics.forEach((m, i) => {
        const x = M + i * colW + colW / 2;
        doc.setTextColor(...GRAY);
        doc.setFontSize(6);
        doc.setFont("helvetica", "normal");
        doc.text(m.label, x, y + 6, { align: "center" });
        doc.setTextColor(...WHITE);
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.text(m.value, x, y + 13, { align: "center" });
      });
      y += 24;

      // Narrative
      if (stock.narrative) {
        y = sectionTitle("NARRATIVE", y);
        doc.setTextColor(...WHITE);
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "normal");
        const nLines = doc.splitTextToSize(stock.narrative, W - M * 2);
        doc.text(nLines.slice(0, 5), M, y);
        y += Math.min(nLines.length, 5) * 3.5 + 4;
      }

      // Framework Summary
      y = sectionTitle("FRAMEWORK SUMMARY", y);
      autoTable(doc, {
        ...tableDefaults,
        startY: y,
        head: [["Layer", "Value", "Detail"]],
        body: [
          ["Market Clock", stock.clock_position || "\u2014", stock.phase || ""],
          ["Corporate Stage", stock.corporate_stage || "\u2014", ""],
          ["Geometric Order", `${stock.geometric_order ?? 0}`, stock.geometric_details || ""],
          ["TrendWise", stock.trend_signal || "\u2014", stock.trend_entry_date ? `Entry: ${stock.trend_entry_date}` : ""],
          ["HMM Regime", stock.hmm_regime || "\u2014", stock.hmm_persistence != null ? `Persistence: ${(stock.hmm_persistence * 100).toFixed(0)}%` : ""],
          ["Moat", `${stock.moat_width || "\u2014"} ${stock.moat_trend ? `(${stock.moat_trend})` : ""}`, stock.moat_type || ""],
          ["Extreme Score", `${stock.extreme_score ?? "\u2014"}/20`, ""],
          ["Action", stock.action || "\u2014", ""],
        ],
      });
      y = (doc as any).lastAutoTable.finalY + 5;

      // Gravity Walls
      if (y > H - 50) {
        addFooter(pageNum++);
        doc.addPage();
        applyPageBg();
        addHeader(`${stock.name} (${stock.symbol})`);
        y = 24;
      }
      y = sectionTitle("GRAVITY WALLS (DAMODARAN)", y);
      autoTable(doc, {
        ...tableDefaults,
        startY: y,
        head: [["Wall", "Assessment"]],
        body: [
          ["Revenue Growth", stock.wall_revenue || "\u2014"],
          ["Operating Margins", stock.wall_margins || "\u2014"],
          ["Capital Efficiency", stock.wall_capital || "\u2014"],
          ["Discount Rates", stock.wall_discount || "\u2014"],
        ],
        didParseCell: (data: any) => {
          if (data.section === "body" && data.column.index === 1) {
            data.cell.styles.textColor = [...wallColor(data.cell.raw as string)];
          }
        },
      });

      addFooter(pageNum++);

      // ===================== PAGE 2: FINANCIALS =====================
      doc.addPage();
      applyPageBg();
      addHeader(`${stock.name} (${stock.symbol})`);
      y = 24;

      y = sectionTitle("VALUATION", y);
      autoTable(doc, {
        ...tableDefaults,
        startY: y,
        body: [
          ["PE (TTM)", fmt(stock.pe_ttm ?? stock.pe_ratio), "Forward PE", fmt(stock.forward_pe)],
          ["P/B", fmt(stock.price_to_book, 2), "EV/EBITDA", fmt(stock.ev_ebitda)],
          ["P/S", fmt(stock.price_to_sales, 2), "EV/Sales", fmt(stock.ev_sales, 2)],
          ["PEG", fmt(stock.peg_ratio, 2), "P/FCF", fmt(stock.price_to_fcf)],
          ["DCF Fair Value", stock.dcf_fair_value ? `${cs}${stock.dcf_fair_value.toFixed(2)}` : "\u2014", "Earnings Yield", stock.earnings_yield ? `${stock.earnings_yield}%` : "\u2014"],
        ],
        columnStyles: {
          0: { textColor: GRAY, fontStyle: "bold" as const },
          2: { textColor: GRAY, fontStyle: "bold" as const },
        },
      });
      y = (doc as any).lastAutoTable.finalY + 5;

      y = sectionTitle("PROFITABILITY", y);
      autoTable(doc, {
        ...tableDefaults,
        startY: y,
        body: [
          ["ROIC", stock.roic != null ? `${stock.roic}%` : "\u2014", "ROE", stock.roe != null ? `${stock.roe}%` : "\u2014"],
          ["Gross Margin", stock.gross_margin != null ? `${stock.gross_margin}%` : "\u2014", "Op Margin", stock.operating_margin != null ? `${stock.operating_margin}%` : "\u2014"],
          ["Net Margin", stock.net_margin != null ? `${stock.net_margin}%` : "\u2014", "EBITDA Margin", stock.ebitda_margin != null ? `${stock.ebitda_margin}%` : "\u2014"],
        ],
        columnStyles: {
          0: { textColor: GRAY, fontStyle: "bold" as const },
          2: { textColor: GRAY, fontStyle: "bold" as const },
        },
      });
      y = (doc as any).lastAutoTable.finalY + 5;

      y = sectionTitle("GROWTH", y);
      autoTable(doc, {
        ...tableDefaults,
        startY: y,
        body: [
          ["Rev Growth YoY", fmtPct(stock.revenue_growth_annual), "Earn Growth YoY", fmtPct(stock.earnings_growth_annual)],
          ["Rev Growth TTM", fmtPct(stock.revenue_growth_ttm), "Earn Growth TTM", fmtPct(stock.earnings_growth_ttm)],
          ["Rev CAGR 3Y", fmtPct(stock.revenue_cagr_3y), "Rev CAGR 5Y", fmtPct(stock.revenue_cagr_5y)],
        ],
        columnStyles: {
          0: { textColor: GRAY, fontStyle: "bold" as const },
          2: { textColor: GRAY, fontStyle: "bold" as const },
        },
      });
      y = (doc as any).lastAutoTable.finalY + 5;

      y = sectionTitle("BALANCE SHEET & RISK", y);
      autoTable(doc, {
        ...tableDefaults,
        startY: y,
        body: [
          ["D/E", fmt(stock.debt_to_equity, 2), "Current Ratio", fmt(stock.current_ratio, 2)],
          ["Debt/EBITDA", fmt(stock.debt_to_ebitda, 2), "Interest Coverage", fmt(stock.interest_coverage)],
          ["Altman Z", fmt(stock.altman_z_score, 2), "Piotroski F", stock.piotroski_score != null ? `${stock.piotroski_score}/9` : "\u2014"],
          ["Beta", fmt(stock.beta, 2), "FCF Yield", stock.fcf_yield ? `${stock.fcf_yield}%` : "\u2014"],
        ],
        columnStyles: {
          0: { textColor: GRAY, fontStyle: "bold" as const },
          2: { textColor: GRAY, fontStyle: "bold" as const },
        },
      });
      y = (doc as any).lastAutoTable.finalY + 5;

      y = sectionTitle("COMPOSITE SCORE BREAKDOWN", y);
      autoTable(doc, {
        ...tableDefaults,
        startY: y,
        head: [["Component", "Score", "Max"]],
        body: [
          ["Walls", String(sc.walls), "25"],
          ["TrendWise", String(sc.trendwise), "15"],
          ["Clock", String(sc.clock), "15"],
          ["Moat", String(sc.moat), "15"],
          ["Stage", String(sc.stage), "10"],
          ["Geo Order", String(sc.geo), "10"],
          ["Sector", String(sc.sector), "10"],
          ["TOTAL", String(sc.total), "100"],
        ],
        didParseCell: (data: any) => {
          if (data.section === "body" && data.row.index === 7) {
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.textColor = [...gradeColor];
          }
        },
      });

      addFooter(pageNum++);

      // ===================== PAGE 3+: ANALYSIS REPORT =====================
      if (stock.analysis_report) {
        doc.addPage();
        applyPageBg();
        addHeader(`${stock.name} (${stock.symbol})`);

        y = 24;
        y = sectionTitle("FULL ANALYSIS REPORT", y);

        const reportText = stock.analysis_report
          .replace(/```[\s\S]*?```/g, "")
          .replace(/\{[\s\S]*\}$/m, "")
          .replace(/\*\*/g, "")
          .replace(/\|[^\n]+\|/g, "")
          .replace(/[-]{3,}/g, "\n")
          .replace(/#{1,3}\s*/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        doc.setTextColor(...WHITE);
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");

        const lines = doc.splitTextToSize(reportText, W - M * 2);
        const lh = 3.2;
        const pageBottom = H - 14;

        for (let i = 0; i < lines.length; i++) {
          if (y + lh > pageBottom) {
            addFooter(pageNum++);
            doc.addPage();
            applyPageBg();
            addHeader(`${stock.name} (${stock.symbol})`);
            y = 24;
            doc.setTextColor(...WHITE);
            doc.setFontSize(7);
            doc.setFont("helvetica", "normal");
          }
          doc.text(lines[i], M, y);
          y += lh;
        }

        addFooter(pageNum);
      }

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
      style={{ background: "var(--blue)", color: "#000" }}
    >
      {loading ? "Generating PDF..." : "Download Report"}
    </button>
  );
}
