import Link from "next/link";
import { auth } from "@/auth";
import { fetchHeatmap, fetchHeatmapDate } from "@/lib/db";
import { HeatmapTabs } from "@/components/heatmap-tabs";

export const dynamic = "force-dynamic";

export default async function HeatmapPage() {
  const session = await auth();

  const [usSectors, usIndustries, usDate, cnSectors, cnIndustries, cnDate] =
    await Promise.all([
      fetchHeatmap("SP500", "sector"),
      fetchHeatmap("SP500", "industry"),
      fetchHeatmapDate("SP500"),
      fetchHeatmap("China", "sector"),
      fetchHeatmap("China", "industry"),
      fetchHeatmapDate("China"),
    ]);

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-8">
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
            Sector & Industry Heatmap
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            3M / 6M / 12M performance across sectors and industries
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

      <HeatmapTabs
        us={{
          sectors: usSectors,
          industries: usIndustries,
          reportDate: usDate,
        }}
        china={{
          sectors: cnSectors,
          industries: cnIndustries,
          reportDate: cnDate,
        }}
      />

      <footer className="mt-12 pb-8 text-center text-xs" style={{ color: "var(--muted)" }}>
        Data from sector_industry_heatmap.py &middot; Refreshed daily
      </footer>
    </main>
  );
}
