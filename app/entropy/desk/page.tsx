import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { TradingDesk } from "@/components/trading-desk";

export const dynamic = "force-dynamic";

export default async function TradingDeskPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="max-w-[1800px] mx-auto px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm hover:underline" style={{ color: "var(--blue)" }}>
              ← Dashboard
            </Link>
            <span style={{ color: "var(--muted)" }}>/</span>
            <Link href="/entropy" className="text-sm hover:underline" style={{ color: "var(--blue)" }}>
              Shannon Entropy
            </Link>
          </div>
          <h1 className="text-3xl font-bold tracking-tight mt-2">
            Entropy Trading Desk
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Four-phase lifecycle classifier — Compression → Fracture → Disorder → Re-compression
          </p>
        </div>
        {session.user.image && (
          <img src={session.user.image} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
        )}
      </header>

      <TradingDesk />

      <footer className="mt-12 pb-8 text-right text-xs" style={{ color: "var(--muted)" }}>
        &copy; The Research Desk
      </footer>
    </main>
  );
}
