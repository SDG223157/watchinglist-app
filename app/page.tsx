import Link from "next/link";
import { fetchAllLatest, getCachedHeatmap } from "@/lib/db";
import { buildHeatmapLookup, matchStock, type StockHeatmapContext } from "@/lib/heatmap-match";
import { StatCards } from "@/components/stat-cards";
import { WatchlistTable } from "@/components/watchlist-table";
import { AddStock } from "@/components/add-stock";
import { RefreshAllButton } from "@/components/refresh-all-button";
import { auth, signOut } from "@/auth";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [stocks, heatmapRows, session] = await Promise.all([
    fetchAllLatest(),
    getCachedHeatmap(),
    auth(),
  ]);

  const lookup = buildHeatmapLookup(heatmapRows);
  const heatmapContext: Record<string, StockHeatmapContext> = {};
  for (const s of stocks) {
    heatmapContext[s.symbol] = matchStock(s, lookup);
  }

  return (
    <main className="max-w-[1800px] mx-auto px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">WatchingList</h1>
        </div>
        {session?.user && (
          <div className="flex items-center gap-3">
            <Link
              href="/heatmap"
              className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
            >
              Heatmap
            </Link>
            <Link
              href="/pca"
              className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
            >
              PCA
            </Link>
            <Link
              href="/matrix"
              className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
            >
              α·β·R²
            </Link>
            <Link
              href="/macro"
              className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
            >
              Macro
            </Link>
            <Link
              href="/entropy"
              className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
            >
              Entropy
            </Link>
            <Link
              href="/tda"
              className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
            >
              TDA
            </Link>
            <Link
              href="/bounce"
              className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
            >
              Bounce
            </Link>
            <Link
              href="/sim"
              className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
            >
              Sim
            </Link>
            <Link
              href="/portfolio"
              className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
              style={{ background: "#2563eb", border: "1px solid #2563eb", color: "#fff" }}
            >
              Portfolio
            </Link>
            <RefreshAllButton stockCount={stocks.length} symbols={stocks.map(s => s.symbol)} />
            <AddStock />
            {session.user.image && (
              <img
                src={session.user.image}
                alt=""
                className="w-8 h-8 rounded-full"
                referrerPolicy="no-referrer"
              />
            )}
            <span className="text-sm hidden sm:inline" style={{ color: "var(--muted)" }}>
              {session.user.email}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="text-xs px-3 py-1.5 rounded-md transition-colors cursor-pointer hover:brightness-125"
                style={{ background: "var(--border)", color: "var(--muted)" }}
              >
                Sign out
              </button>
            </form>
          </div>
        )}
      </header>

      <section className="mb-8">
        <StatCards stocks={stocks} />
      </section>

      <section>
        <WatchlistTable stocks={stocks} heatmapContext={heatmapContext} />
      </section>

      <footer className="mt-12 pb-8 text-right text-xs" style={{ color: "var(--muted)" }}>
        &copy; WatchingList
      </footer>
    </main>
  );
}
