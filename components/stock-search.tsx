"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

export function StockSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [show, setShow] = useState(false);
  const [idx, setIdx] = useState(-1);
  const [searching, setSearching] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();

  const search = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([]);
      setShow(false);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.results || []);
      setShow((data.results || []).length > 0);
      setIdx(-1);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  function onInput(val: string) {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val.trim()), 250);
  }

  function go(symbol: string) {
    setQuery("");
    setResults([]);
    setShow(false);
    router.push(`/stock/${encodeURIComponent(symbol)}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!show || results.length === 0) {
      if (e.key === "Enter" && query.trim()) {
        e.preventDefault();
        go(query.trim().toUpperCase());
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (idx >= 0 && idx < results.length) go(results[idx].symbol);
      else if (query.trim()) go(query.trim().toUpperCase());
    } else if (e.key === "Escape") {
      setShow(false);
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShow(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKey}
          onFocus={() => results.length > 0 && setShow(true)}
          placeholder="Search stock..."
          className="w-44 sm:w-56 text-xs px-3 py-2 rounded-md outline-none focus:ring-1"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        />
        {searching && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 inline-block w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        )}
      </div>

      {show && results.length > 0 && (
        <div
          className="absolute top-full left-0 mt-1 w-72 rounded-lg shadow-xl z-50 overflow-hidden max-h-64 overflow-y-auto"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          {results.map((r, i) => (
            <button
              key={r.symbol}
              type="button"
              className="w-full px-3 py-2 text-left flex items-center gap-3 transition-colors cursor-pointer"
              style={{ background: i === idx ? "var(--border)" : "transparent" }}
              onMouseEnter={() => setIdx(i)}
              onClick={() => go(r.symbol)}
            >
              <span
                className="font-mono font-semibold text-xs min-w-14"
                style={{ color: "var(--blue)" }}
              >
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
  );
}
