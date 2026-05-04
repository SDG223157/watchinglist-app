import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getCachedFuturesWatchlist } from "@/lib/futures";
import { FuturesWatchlistTable } from "@/components/futures-watchlist-table";
import { FuturesVarietySearch } from "@/components/futures-variety-search";

export const dynamic = "force-dynamic";

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/pca", label: "PCA" },
  { href: "/matrix", label: "Matrix" },
  { href: "/macro", label: "Macro" },
  { href: "/entropy", label: "Entropy" },
  { href: "/regime", label: "Regime" },
  { href: "/bounce", label: "Bounce" },
  { href: "/portfolio", label: "Portfolio", accent: "#2563eb" },
];

export default async function FuturesPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const items = await getCachedFuturesWatchlist(session.user.email);

  return (
    <main className="max-w-[1600px] mx-auto px-4 py-8">
      <header className="mb-8">
        {/* Nav bar */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
              style={{
                background: l.accent || "var(--card)",
                border: `1px solid ${l.accent || "var(--border)"}`,
                color: l.accent ? "#fff" : "var(--muted)",
              }}
            >
              {l.label}
            </Link>
          ))}
          <span
            className="text-xs px-3 py-1.5 rounded-md font-semibold"
            style={{ background: "#d97706", border: "1px solid #d97706", color: "#fff" }}
          >
            Futures
          </span>
          <Link
            href="/futures/chart"
            className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
            style={{ background: "#92400e", border: "1px solid #92400e", color: "#fff" }}
          >
            K-Line Chart
          </Link>
        </div>

        <h1 className="text-3xl font-bold tracking-tight">Futures</h1>
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
