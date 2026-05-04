import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { FuturesKlineChart } from "@/components/futures-kline-chart";

export const dynamic = "force-dynamic";

export default async function FuturesChartPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { code } = await params;
  const symbol = code.toUpperCase() + "0";

  return (
    <main className="max-w-[1600px] mx-auto px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/futures" className="text-sm hover:underline" style={{ color: "var(--blue)" }}>
            ← Futures
          </Link>
          <Link
            href={`/futures/${code.toUpperCase()}/analysis`}
            className="text-sm hover:underline"
            style={{ color: "var(--muted)" }}
          >
            Analysis →
          </Link>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {code.toUpperCase()} K-Line
        </h1>
      </header>

      <FuturesKlineChart symbol={symbol} varietyName={code.toUpperCase()} />
    </main>
  );
}
