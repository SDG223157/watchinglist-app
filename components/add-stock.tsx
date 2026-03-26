"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export function AddStock() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();

  const search = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.results || []);
      setShowDropdown((data.results || []).length > 0);
      setSelectedIdx(-1);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  function handleInputChange(val: string) {
    setQuery(val);
    setError("");
    setSuccess("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val.trim()), 250);
  }

  function selectResult(r: SearchResult) {
    setQuery(r.symbol);
    setShowDropdown(false);
    setResults([]);
    submitSymbol(r.symbol);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown || results.length === 0) {
      if (e.key === "Enter") {
        e.preventDefault();
        const sym = query.trim().toUpperCase();
        if (sym) submitSymbol(sym);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIdx >= 0 && selectedIdx < results.length) {
        selectResult(results[selectedIdx]);
      } else {
        const sym = query.trim().toUpperCase();
        if (sym) submitSymbol(sym);
      }
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function submitSymbol(sym: string) {
    setLoading(true);
    setError("");
    setSuccess("");
    setShowDropdown(false);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: sym }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to add stock");
        setLoading(false);
        return;
      }

      setSuccess(`${data.symbol} @ ${data.price} — analyzing...`);
      setQuery("");
      router.refresh();

      let analysisOk = false;
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
          setSuccess(`${data.symbol} — analysis complete! Redirecting...`);
          analysisOk = true;
        } else {
          const rptData = await rpt.json().catch(() => ({}));
          setSuccess(`${data.symbol} added (${rptData.error || "analysis failed"})`);
        }
      } catch {
        setSuccess(`${data.symbol} added (analysis skipped)`);
      }

      if (analysisOk) {
        setTimeout(() => {
          router.push(`/stock/${encodeURIComponent(sym)}`);
        }, 800);
      } else {
        router.refresh();
        setTimeout(() => { setOpen(false); setSuccess(""); }, 2000);
      }
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
    <div ref={wrapperRef} className="relative flex items-center gap-2">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
          placeholder="Search AAPL, Tesla, 腾讯..."
          disabled={loading}
          className="w-64 text-sm px-3 py-1.5 rounded-md outline-none focus:ring-1"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
          autoFocus
        />
        {searching && (
          <span
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-block w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin"
          />
        )}

        {showDropdown && results.length > 0 && (
          <div
            className="absolute top-full left-0 mt-1 w-80 rounded-lg shadow-xl z-50 overflow-hidden max-h-72 overflow-y-auto"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            {results.map((r, i) => (
              <button
                key={r.symbol}
                type="button"
                className="w-full px-3 py-2 text-left flex items-center gap-3 transition-colors cursor-pointer"
                style={{
                  background: i === selectedIdx ? "var(--border)" : "transparent",
                }}
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => selectResult(r)}
              >
                <span className="font-mono font-semibold text-sm min-w-16" style={{ color: "var(--blue)" }}>
                  {r.symbol}
                </span>
                <span className="text-xs truncate flex-1" style={{ color: "var(--muted)" }}>
                  {r.name}
                </span>
                <span className="text-[10px] opacity-50">{r.exchange}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          const sym = query.trim().toUpperCase();
          if (sym) submitSymbol(sym);
        }}
        disabled={loading || !query.trim()}
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
          setQuery("");
          setResults([]);
          setShowDropdown(false);
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
    </div>
  );
}
