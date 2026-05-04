"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  report: string | null;
  analysisDate: string | null;
  varietyCode: string;
}

export function FuturesAnalysisView({ report, analysisDate, varietyCode }: Props) {
  const [analyzing, setAnalyzing] = useState(false);

  async function runAnalysis(mode: string = "analysis") {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/futures/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: varietyCode, mode }),
      });
      const result = await res.json();
      if (result.ok) {
        window.location.reload();
      } else {
        alert("Failed: " + (result.error || "Unknown error"));
      }
    } catch (err) {
      alert("Failed: " + String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  if (!report) {
    return (
      <div className="text-center py-16" style={{ color: "var(--muted)" }}>
        <p className="text-lg mb-4">No analysis yet for {varietyCode}</p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          {[
            { mode: "analysis" as const, label: `Analyze ${varietyCode}`, bg: "#d97706" },
            { mode: "strategy" as const, label: "Strategy", bg: "#2563eb" },
            { mode: "table" as const, label: "Table", bg: "#7c3aed" },
            { mode: "intraday" as const, label: "Intraday", bg: "#059669" },
            { mode: "swing" as const, label: "Swing", bg: "#0891b2" },
            { mode: "orders" as const, label: "Orders", bg: "#be185d" },
            { mode: "risk" as const, label: "Risk", bg: "#dc2626" },
            { mode: "checklist" as const, label: "Checklist", bg: "#ea580c" },
          ].map((b) => (
            <button
              key={b.mode}
              onClick={() => runAnalysis(b.mode)}
              disabled={analyzing}
              className="px-5 py-2.5 text-sm font-semibold rounded-lg transition-colors"
              style={{ background: analyzing ? "#555" : b.bg, color: "#fff", cursor: analyzing ? "wait" : "pointer" }}
            >
              {analyzing ? "..." : b.label}
            </button>
          ))}
        </div>
        {analyzing && (
          <p className="mt-4 text-xs" style={{ color: "#888" }}>
            Gathering AKShare data + generating report. Please wait...
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {analysisDate && (
          <p className="text-xs mr-2" style={{ color: "var(--muted)" }}>
            Last: {new Date(analysisDate).toLocaleString()}
          </p>
        )}
        {[
          { mode: "analysis" as const, label: "Analyze", bg: "#d97706" },
          { mode: "strategy" as const, label: "Strategy", bg: "#2563eb" },
          { mode: "table" as const, label: "Table", bg: "#7c3aed" },
          { mode: "intraday" as const, label: "Intraday", bg: "#059669" },
          { mode: "swing" as const, label: "Swing", bg: "#0891b2" },
          { mode: "orders" as const, label: "Orders", bg: "#be185d" },
        ].map((b) => (
          <button
            key={b.mode}
            onClick={() => runAnalysis(b.mode)}
            disabled={analyzing}
            className="text-xs px-3 py-1.5 rounded transition-colors"
            style={{ background: analyzing ? "#555" : b.bg, color: "#fff", cursor: analyzing ? "wait" : "pointer" }}
          >
            {analyzing ? "..." : b.label}
          </button>
        ))}
      </div>
      <article
        className="prose prose-invert prose-sm max-w-none"
        style={{ color: "var(--foreground)" }}
      >
        <Markdown remarkPlugins={[remarkGfm]}>{report}</Markdown>
      </article>
    </div>
  );
}
