import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getFuturesAnalysis } from "@/lib/futures";
import { FuturesAnalysisView } from "@/components/futures-analysis-view";

export const dynamic = "force-dynamic";

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
        <div className="flex items-center gap-3 mb-2">
          <Link href="/futures" className="text-sm hover:underline" style={{ color: "var(--blue)" }}>
            ← Futures
          </Link>
          <Link
            href={`/futures/${upperCode}`}
            className="text-sm hover:underline"
            style={{ color: "var(--muted)" }}
          >
            Chart →
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
