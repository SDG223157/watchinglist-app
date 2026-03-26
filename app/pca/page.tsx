import Link from "next/link";
import { auth } from "@/auth";
import { getCachedPcaReports, getCachedPcaDates } from "@/lib/db";
import { PcaDashboard } from "@/components/pca-dashboard";

export const dynamic = "force-dynamic";

export default async function PcaPage() {
  const session = await auth();

  const [spReports, chinaReports, spDates, chinaDates] = await Promise.all([
    getCachedPcaReports("SP500"),
    getCachedPcaReports("CHINA"),
    getCachedPcaDates("SP500"),
    getCachedPcaDates("CHINA"),
  ]);

  return (
    <main className="max-w-[1800px] mx-auto px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm hover:underline"
              style={{ color: "var(--blue)" }}
            >
              ← Dashboard
            </Link>
          </div>
          <h1 className="text-3xl font-bold tracking-tight mt-2">
            Market PCA Analysis
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Factor decomposition across S&P 500 and China indices
          </p>
        </div>
        {session?.user?.image && (
          <img
            src={session.user.image}
            alt=""
            className="w-8 h-8 rounded-full"
            referrerPolicy="no-referrer"
          />
        )}
      </header>

      <PcaDashboard
        spReports={spReports}
        chinaReports={chinaReports}
        spDates={spDates}
        chinaDates={chinaDates}
      />

      <footer
        className="mt-12 pb-8 text-right text-xs"
        style={{ color: "var(--muted)" }}
      >
        &copy; WatchingList
      </footer>
    </main>
  );
}
