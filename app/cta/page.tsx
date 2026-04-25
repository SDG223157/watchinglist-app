import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { CTADashboard } from "@/components/cta-dashboard";

export const dynamic = "force-dynamic";

export default async function CTAPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="max-w-[1600px] mx-auto px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm hover:underline" style={{ color: "var(--blue)" }}>
            ← Dashboard
          </Link>
          <h1 className="text-3xl font-bold tracking-tight mt-2">CTA Positioning</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Model-implied trend-following exposure, volatility scaling, and trigger-level flow risk.
          </p>
        </div>
        {session.user.image && (
          <img
            src={session.user.image}
            alt=""
            className="w-8 h-8 rounded-full"
            referrerPolicy="no-referrer"
          />
        )}
      </header>

      <CTADashboard />

      <footer className="mt-12 pb-8 text-right text-xs" style={{ color: "var(--muted)" }}>
        &copy; WatchingList
      </footer>
    </main>
  );
}
