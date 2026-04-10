"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshButton({ symbol }: { symbol: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const router = useRouter();

  async function handleClick() {
    setLoading(true);
    setError("");
    setDone(false);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol }),
          signal: AbortSignal.timeout(60000),
        });

        const text = await res.text();
        if (text.startsWith("<!") || text.startsWith("<html")) {
          if (attempt === 0) {
            setError("Waking up database... retrying");
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          setError("Server returned HTML — redeploy may be needed");
          break;
        }

        const data = JSON.parse(text);
        if (!res.ok) {
          if (attempt === 0 && res.status >= 500) {
            setError("Retrying...");
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          setError(data.error || `Failed (${res.status})`);
          break;
        }

        setDone(true);
        setError("");
        router.refresh();
        setTimeout(() => setDone(false), 3000);
        break;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Network error";
        if (attempt === 0) {
          setError("Retrying...");
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        setError(msg.includes("timeout") || msg.includes("abort") ? "Request timed out (60s)" : msg);
      }
    }

    setLoading(false);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={loading}
        className="text-xs px-4 py-2 rounded-md font-medium transition-colors cursor-pointer hover:brightness-125 disabled:opacity-50"
        style={{ background: "var(--blue)", color: "#fff" }}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Refreshing...
          </span>
        ) : (
          "Refresh Data"
        )}
      </button>
      {done && (
        <span className="text-xs font-semibold" style={{ color: "var(--green)" }}>
          Data updated
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
