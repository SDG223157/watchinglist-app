"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export function AddStock() {
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: sym }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to add stock");
        return;
      }

      setSuccess(`Added ${data.symbol} @ ${data.price} — running AI analysis...`);
      setSymbol("");
      router.refresh();

      // Auto-trigger LLM analysis in background
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 180000);
        const rpt = await fetch("/api/analyze-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: sym }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (rpt.ok) {
          setSuccess(`${data.symbol} — full analysis complete!`);
        } else {
          const rptData = await rpt.json().catch(() => ({}));
          setSuccess(`${data.symbol} added (analysis: ${rptData.error || "failed"})`);
        }
      } catch {
        setSuccess(`${data.symbol} added (analysis skipped)`);
      }
      router.refresh();
      setTimeout(() => { setOpen(false); setSuccess(""); }, 2000);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 100);
        }}
        className="text-xs px-3 py-1.5 rounded-md transition-colors cursor-pointer hover:brightness-125"
        style={{ background: "var(--blue)", color: "#fff" }}
      >
        + Add Stock
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        placeholder="AAPL, 0700.HK, 600519.SS"
        disabled={loading}
        className="w-52 text-sm px-3 py-1.5 rounded-md outline-none focus:ring-1"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--text)",
        }}
        autoFocus
      />
      <button
        type="submit"
        disabled={loading || !symbol.trim()}
        className="text-xs px-3 py-1.5 rounded-md transition-colors cursor-pointer hover:brightness-125 disabled:opacity-40"
        style={{ background: "var(--blue)", color: "#fff" }}
      >
        {loading ? "Adding + Analyzing..." : "Add"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError("");
          setSuccess("");
          setSymbol("");
        }}
        className="text-xs px-2 py-1.5 cursor-pointer"
        style={{ color: "var(--muted)" }}
      >
        Cancel
      </button>
      {error && (
        <span className="text-xs" style={{ color: "var(--red)" }}>
          {error}
        </span>
      )}
      {success && (
        <span className="text-xs" style={{ color: "var(--green)" }}>
          {success}
        </span>
      )}
    </form>
  );
}
