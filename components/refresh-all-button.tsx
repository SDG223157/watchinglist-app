"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshAllButton({ stockCount }: { stockCount: number }) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    success: number;
    failed: number;
    total: number;
  } | null>(null);
  const router = useRouter();

  async function handleClick() {
    if (
      !confirm(
        `Refresh all ${stockCount} stocks? This will update prices, scores, and FAJ fields for every stock in the database. This may take several minutes.`
      )
    )
      return;

    setLoading(true);
    setError("");
    setResult(null);
    setProgress(`Refreshing ${stockCount} stocks...`);

    try {
      const res = await fetch("/api/refresh-all", {
        method: "POST",
        signal: AbortSignal.timeout(300000),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Failed (${res.status})`);
        return;
      }

      setResult({
        success: data.success,
        failed: data.failed,
        total: data.total,
      });
      setProgress("");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      setError(msg.includes("timeout") ? "Request timed out" : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={loading}
        className="text-xs px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer hover:brightness-125 disabled:opacity-50"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--muted)",
        }}
      >
        {loading ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
            Refreshing...
          </span>
        ) : (
          "Refresh All"
        )}
      </button>
      {progress && (
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {progress}
        </span>
      )}
      {result && (
        <span
          className="text-xs font-semibold"
          style={{ color: result.failed > 0 ? "var(--yellow)" : "var(--green)" }}
        >
          {result.success}/{result.total} updated
          {result.failed > 0 ? ` (${result.failed} failed)` : ""}
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
