import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SimDashboard } from "@/components/sim-dashboard";

export const dynamic = "force-dynamic";

export default async function SimPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="max-w-[1600px] mx-auto px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm hover:underline" style={{ color: "var(--blue)" }}>← Dashboard</Link>
          </div>
          <h1 className="text-3xl font-bold tracking-tight mt-2">Simulation Portfolios</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Two entropy-ranked portfolios — US ($1M) and China (¥1M) — auto-rebalanced monthly
          </p>
        </div>
        {session.user.image && (
          <img src={session.user.image} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
        )}
      </header>
      <SimDashboard />
    </main>
  );
}
