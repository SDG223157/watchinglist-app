import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getFuturesAnalysis } from "@/lib/futures";
import { FuturesAnalysisView } from "@/components/futures-analysis-view";

export const dynamic = "force-dynamic";

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/futures", label: "Futures", accent: "#d97706" },
  { href: "/futures/chart", label: "K-Line Chart", accent: "#92400e" },
  { href: "/portfolio", label: "Portfolio", accent: "#2563eb" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/entropy", label: "Entropy" },
  { href: "/macro", label: "Macro" },
];

export default async function FuturesAnalysisPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const { code } = await params;
  const upperCode = code.toUpperCase();
  const item = await getFuturesAnalysis(session.user.email, upperCode);

  return (
    <main className="max-w-[1200px] mx-auto px-4 py-8">
      <header className="mb-6">
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
          <span style={{ color: "var(--border)" }}>|</span>
          <Link
            href={`/futures/${upperCode}`}
            className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "#ffd700" }}
          >
            {upperCode} Chart
          </Link>
        </div>

        <h1 className="text-2xl font-bold tracking-tight">
          {upperCode} Price Structure Analysis
        </h1>
      </header>

      <FuturesAnalysisView
        report={item?.analysis_report ?? null}
        analysisDate={item?.analysis_date ?? null}
        varietyCode={upperCode}
      />
    </main>
  );
}
