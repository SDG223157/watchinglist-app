import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getCachedFuturesWatchlist } from "@/lib/futures";
import { FuturesWatchlistTable } from "@/components/futures-watchlist-table";
import { FuturesVarietySearch } from "@/components/futures-variety-search";

export const dynamic = "force-dynamic";

export default async function FuturesPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const items = await getCachedFuturesWatchlist(session.user.email);

  return (
    <main className="max-w-[1600px] mx-auto px-4 py-8">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm hover:underline" style={{ color: "var(--blue)" }}>
            ← Dashboard
          </Link>
          <Link
            href="/futures/chart"
            className="text-sm px-3 py-1 rounded-md"
            style={{ background: "#d97706", color: "#fff" }}
          >
            K-Line Chart
          </Link>
        </div>
        <h1 className="text-3xl font-bold tracking-tight mt-2">Futures</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Chinese commodity & financial futures — K-line charting, term structure, and price structure analysis
        </p>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-lg px-4 py-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-xs" style={{ color: "var(--muted)" }}>Tracked</div>
          <div className="text-2xl font-bold">{items.length}</div>
        </div>
        <div className="rounded-lg px-4 py-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-xs" style={{ color: "var(--muted)" }}>Analyzed</div>
          <div className="text-2xl font-bold">{items.filter((i) => i.analysis_report).length}</div>
        </div>
        <div className="rounded-lg px-4 py-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="text-xs" style={{ color: "var(--muted)" }}>Exchanges</div>
          <div className="text-2xl font-bold">{new Set(items.map((i) => i.exchange)).size}</div>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <FuturesVarietySearch />
      </div>

      {/* Table */}
      <FuturesWatchlistTable items={items} />
    </main>
  );
}
