"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  report: string | null;
  analysisDate: string | null;
  varietyCode: string;
}

export function FuturesAnalysisView({ report, analysisDate, varietyCode }: Props) {
  if (!report) {
    return (
      <div className="text-center py-16" style={{ color: "var(--muted)" }}>
        <p className="text-lg mb-2">No analysis yet for {varietyCode}</p>
        <p className="text-sm">
          Run <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: "var(--card)" }}>
            /futures-price-structure-analysis {varietyCode}
          </code>{" "}
          in Claude Code to generate and save the analysis.
        </p>
      </div>
    );
  }

  return (
    <div>
      {analysisDate && (
        <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
          Last analyzed: {new Date(analysisDate).toLocaleString()}
        </p>
      )}
      <article
        className="prose prose-invert prose-sm max-w-none"
        style={{ color: "var(--foreground)" }}
      >
        <Markdown remarkPlugins={[remarkGfm]}>{report}</Markdown>
      </article>
    </div>
  );
}
