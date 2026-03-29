import Link from "next/link";
import { fetchAllLatest } from "@/lib/db";
import { AlphaBetaMatrix } from "@/components/alpha-beta-matrix";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MatrixPage() {
  const [stocks, session] = await Promise.all([fetchAllLatest(), auth()]);
  if (!session?.user) redirect("/login");

  const withCapm = stocks.filter(
    (s) => s.capm_alpha != null && s.capm_beta != null
  );

  return (
    <main className="max-w-[1800px] mx-auto px-4 py-8">
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-xs px-3 py-1.5 rounded-md transition-colors hover:brightness-125"
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              color: "var(--muted)",
            }}
          >
            &larr; Dashboard
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">
            Alpha &middot; Beta &middot; R&sup2; Matrix
          </h1>
          <span className="text-xs font-mono" style={{ color: "var(--muted)" }}>
            {withCapm.length} / {stocks.length} stocks with CAPM data
          </span>
        </div>
      </header>

      <AlphaBetaMatrix stocks={withCapm} />
    </main>
  );
}
