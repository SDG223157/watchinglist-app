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

  async function runAnalysis() {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/futures/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: varietyCode }),
      });
      const result = await res.json();
      if (result.ok) {
        window.location.reload();
      } else {
        alert("Analysis failed: " + (result.error || "Unknown error"));
      }
    } catch (err) {
      alert("Analysis failed: " + String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  if (!report) {
    return (
      <div className="text-center py-16" style={{ color: "var(--muted)" }}>
        <p className="text-lg mb-4">No analysis yet for {varietyCode}</p>
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          className="px-6 py-3 text-sm font-semibold rounded-lg transition-colors"
          style={{
            background: analyzing ? "#555" : "#d97706",
            color: "#fff",
            cursor: analyzing ? "wait" : "pointer",
          }}
        >
          {analyzing ? "Analyzing with GPT-5.4... (30-60s)" : `Analyze ${varietyCode}`}
        </button>
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
      <div className="flex items-center gap-4 mb-4">
        {analysisDate && (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Last analyzed: {new Date(analysisDate).toLocaleString()}
          </p>
        )}
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          className="text-xs px-3 py-1.5 rounded transition-colors"
          style={{
            background: analyzing ? "#555" : "#d97706",
            color: "#fff",
            cursor: analyzing ? "wait" : "pointer",
          }}
        >
          {analyzing ? "Re-analyzing..." : "Re-analyze"}
        </button>
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
