import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { BounceDashboard } from "@/components/bounce-dashboard";

export const dynamic = "force-dynamic";

export default async function BouncePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="max-w-[1600px] mx-auto px-4 py-8">
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
            Sector Bounce Leader
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Identify which sectors lead on Day-1 of a rebound and track them to
            the phase high — US & China sector ETFs
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/heatmap"
            className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            Heatmap
          </Link>
          <Link
            href="/macro"
            className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            Macro
          </Link>
          {session.user.image && (
            <img
              src={session.user.image}
              alt=""
              className="w-8 h-8 rounded-full"
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      </header>

      <BounceDashboard />

      <footer
        className="mt-12 pb-8 text-right text-xs"
        style={{ color: "var(--muted)" }}
      >
        &copy; WatchingList
      </footer>
    </main>
  );
}
