"use client";

import Link from "next/link";
import { useState } from "react";
import { StockHmmEntropyCard } from "@/components/stock-hmm-entropy-card";

export default function HmmEntropyAnalyzePage() {
  const [input, setInput] = useState("AAPL");
  const [symbol, setSymbol] = useState("AAPL");

  return (
    <main className="max-w-[1200px] mx-auto px-4 py-8">
      <header className="mb-8">
        <Link href="/entropy" className="text-sm hover:underline" style={{ color: "var(--blue)" }}>
          ← Entropy Dashboard
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">HMM × Entropy Analyzer</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Single-ticker analysis: HMM regime, Shannon entropy, conviction, transfer entropy, half-life, and entry recommendation
        </p>
      </header>

      <div
        className="rounded-lg p-4 mb-6 flex flex-wrap items-end gap-4"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
            Ticker
          </label>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="AAPL / 0700.HK / 300760.SZ"
            className="w-64 px-3 py-2 rounded-md text-sm bg-zinc-900 border border-zinc-700 text-white"
          />
        </div>
        <button
          onClick={() => setSymbol(input.trim().toUpperCase())}
          className="px-5 py-2 rounded-md text-sm font-semibold cursor-pointer hover:brightness-125"
          style={{ background: "#7c3aed", color: "#fff" }}
        >
          Analyze
        </button>
        <div className="text-xs" style={{ color: "var(--muted)" }}>
          Uses last valid close. Incomplete Yahoo candles are filtered automatically.
        </div>
      </div>

      {symbol && <StockHmmEntropyCard symbol={symbol} />}
    </main>
  );
}
