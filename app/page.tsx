import { fetchAllLatest } from "@/lib/db";
import { StatCards } from "@/components/stat-cards";
import { WatchlistTable } from "@/components/watchlist-table";
import { AddStock } from "@/components/add-stock";
import { auth, signOut } from "@/auth";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const stocks = await fetchAllLatest();
  const session = await auth();

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">WatchingList</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Narrative Cycle × Gravity Wall × Extreme Reversal
          </p>
        </div>
        {session?.user && (
          <div className="flex items-center gap-3">
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
        <WatchlistTable stocks={stocks} />
      </section>

      <footer className="mt-12 pb-8 text-center text-xs" style={{ color: "var(--muted)" }}>
        Data refreshed daily at 09:00 CST &middot; Powered by ROIC.ai + yfinance + GPT-5.4
      </footer>
    </main>
  );
}
