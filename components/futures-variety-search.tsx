"use client";

import { useState, useEffect, useRef } from "react";

interface Variety {
  code: string;
  name: string;
  exchange: string;
  multiplier: number;
  price: number | null;
}

export function FuturesVarietySearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Variety[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [allVarieties, setAllVarieties] = useState<Variety[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // Load all varieties once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/futures/varieties");
        if (!res.ok) return;
        const data = await res.json();
        const flat: Variety[] = [];
        for (const [exchange, items] of Object.entries(data)) {
          for (const v of items as Variety[]) {
            flat.push({ ...v, exchange });
          }
        }
        setAllVarieties(flat.sort((a, b) => a.code.localeCompare(b.code)));
      } catch {
        /* offline */
      }
    })();
  }, []);

  // Filter on query change
  useEffect(() => {
    if (!query.trim()) {
      setResults(allVarieties.slice(0, 15));
      return;
    }
    const q = query.toLowerCase();
    setResults(
      allVarieties
        .filter((v) => v.code.toLowerCase().includes(q) || v.name.toLowerCase().includes(q))
        .slice(0, 15)
    );
  }, [query, allVarieties]);

  // Close dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function handleAdd(v: Variety) {
    setLoading(true);
    try {
      await fetch("/api/futures/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      setOpen(false);
      setQuery("");
      window.location.reload();
    } catch {
      alert("Failed to add variety");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search futures variety (e.g. CU, 铜, RB)..."
        className="w-full px-4 py-2 rounded-lg text-sm outline-none"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--foreground)",
        }}
      />

      {open && results.length > 0 && (
        <div
          className="absolute top-full left-0 mt-1 w-full max-h-80 overflow-y-auto rounded-lg shadow-lg z-50"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          {results.map((v) => (
            <button
              key={`${v.exchange}-${v.code}`}
              onClick={() => handleAdd(v)}
              disabled={loading}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:brightness-125"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <span className="font-bold min-w-[40px]" style={{ color: "#ffd700" }}>
                {v.code}
              </span>
              <span className="flex-1">{v.name}</span>
              <span
                className="text-xs px-2 py-0.5 rounded"
                style={{ background: "#1a1a28", color: "var(--muted)" }}
              >
                {v.exchange}
              </span>
              <span className="text-xs font-mono" style={{ color: "var(--muted)" }}>
                {v.price ?? "—"}
              </span>
            </button>
          ))}
        </div>
      )}

      {open && query && results.length === 0 && (
        <div
          className="absolute top-full left-0 mt-1 w-full px-4 py-3 rounded-lg text-sm"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
        >
          No matching varieties found
        </div>
      )}
    </div>
  );
}
