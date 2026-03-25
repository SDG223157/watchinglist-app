import { fetchAllLatest } from "@/lib/db";
import { StatCards } from "@/components/stat-cards";
import { WatchlistTable } from "@/components/watchlist-table";

export const revalidate = 300; // revalidate every 5 minutes

export default async function Dashboard() {
  const stocks = await fetchAllLatest();

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">WatchingList</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Narrative Cycle × Gravity Wall × Extreme Reversal
        </p>
      </header>

      <section className="mb-8">
        <StatCards stocks={stocks} />
      </section>

      <section>
        <WatchlistTable stocks={stocks} />
      </section>

      <footer className="mt-12 pb-8 text-center text-xs" style={{ color: "var(--muted)" }}>
        Data refreshed daily at 09:00 CST &middot; Powered by ROIC.ai + yfinance + GPT-5.4
      </footer>
    </main>
  );
}
