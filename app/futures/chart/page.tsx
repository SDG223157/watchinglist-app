import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { FuturesKlineChart } from "@/components/futures-kline-chart";

export const dynamic = "force-dynamic";

export default async function FuturesChartFullPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div>
      {/* Slim nav strip */}
      <div className="flex items-center gap-3 px-4 py-1.5" style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
        <Link href="/" className="text-xs hover:underline" style={{ color: "var(--blue)" }}>Dashboard</Link>
        <span style={{ color: "var(--border)" }}>|</span>
        <Link href="/futures" className="text-xs hover:underline" style={{ color: "var(--blue)" }}>Futures</Link>
        <span style={{ color: "var(--border)" }}>|</span>
        <Link href="/portfolio" className="text-xs hover:underline" style={{ color: "var(--muted)" }}>Portfolio</Link>
        <span style={{ color: "var(--border)" }}>|</span>
        <Link href="/heatmap" className="text-xs hover:underline" style={{ color: "var(--muted)" }}>Heatmap</Link>
      </div>
      <FuturesKlineChart />
    </div>
  );
}
