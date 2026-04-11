import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { EntropyDashboard } from "@/components/entropy-dashboard";

export const dynamic = "force-dynamic";

export default async function EntropyPage() {
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
            Shannon Entropy
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Informational compression, narrative crowding & cognitive computation gaps
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/entropy/analyze"
            className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
            style={{ background: "#7c3aed", color: "#fff" }}
          >
            Analyze Ticker
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

      <EntropyDashboard />

      <footer
        className="mt-12 pb-8 text-right text-xs"
        style={{ color: "var(--muted)" }}
      >
        &copy; WatchingList
      </footer>
    </main>
  );
}
