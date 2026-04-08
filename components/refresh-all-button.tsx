"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export function RefreshAllButton({ stockCount, symbols }: { stockCount: number; symbols: string[] }) {
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState("");
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);
  const abortRef = useRef(false);
  const router = useRouter();

  async function handleClick() {
    if (loading) {
      abortRef.current = true;
      return;
    }
    if (!confirm(`Refresh all ${stockCount} stocks one by one? This will take ~${Math.ceil(stockCount * 3 / 60)} minutes.`))
      return;

    setLoading(true);
    setDone(0);
    setFailed(0);
    setError("");
    setFinished(false);
    abortRef.current = false;

    let ok = 0;
    let fail = 0;

    for (const symbol of symbols) {
      if (abortRef.current) break;
      setCurrent(symbol);
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol }),
          signal: AbortSignal.timeout(30000),
        });
        if (res.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
      setDone(ok + fail);
      setFailed(fail);
    }

    setCurrent("");
    setFinished(true);
    setLoading(false);
    router.refresh();
  }

  const pct = stockCount > 0 ? Math.round(((done) / stockCount) * 100) : 0;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        className="text-xs px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer hover:brightness-125"
        style={{
          background: loading ? "#dc2626" : "var(--card)",
          border: `1px solid ${loading ? "#dc2626" : "var(--border)"}`,
          color: loading ? "#fff" : "var(--muted)",
        }}
      >
        {loading ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Stop ({pct}%)
          </span>
        ) : (
          "Refresh All"
        )}
      </button>
      {loading && current && (
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {done}/{stockCount} · {current}
        </span>
      )}
      {finished && (
        <span
          className="text-xs font-semibold"
          style={{ color: failed > 0 ? "#b45309" : "#16a34a" }}
        >
          {done - failed}/{stockCount} updated{failed > 0 ? ` (${failed} failed)` : ""}{abortRef.current ? " (stopped)" : ""}
        </span>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
