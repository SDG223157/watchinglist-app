"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AnalyzeButton({ symbol }: { symbol: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [newScore, setNewScore] = useState<number | null>(null);
  const router = useRouter();

  async function handleClick() {
    setLoading(true);
    setError("");
    setNewScore(null);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180000);

      const res = await fetch("/api/analyze-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        setError(`Server error: ${text.slice(0, 200)}`);
        return;
      }

      if (!res.ok) {
        setError(data.error || `Failed (${res.status})`);
        return;
      }

      if (data.compositeScore != null) {
        setNewScore(data.compositeScore);
      }

      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      setError(msg.includes("abort") ? "Request timed out (3min)" : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleClick}
        disabled={loading}
        className="text-xs px-4 py-2 rounded-md font-medium transition-colors cursor-pointer hover:brightness-125 disabled:opacity-50"
        style={{ background: "var(--blue)", color: "#fff" }}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Analyzing... (30-60s)
          </span>
        ) : (
          "Generate Analysis Report"
        )}
      </button>
      {newScore != null && (
        <span className="text-xs font-semibold" style={{ color: "var(--green)" }}>
          Score updated: {newScore}/100
        </span>
      )}
      {error && (
        <span className="text-xs" style={{ color: "var(--red)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
