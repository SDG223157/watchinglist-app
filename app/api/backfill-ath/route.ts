import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { cachedHistorical, cachedQuote } from "@/lib/yf-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function computeAth(symbol: string): Promise<string | null> {
  try {
    const [quote, hist] = await Promise.all([
      cachedQuote(symbol),
      cachedHistorical(symbol, "1970-01-01", "1mo"),
    ]);

    const price = (quote as Record<string, unknown>)?.regularMarketPrice as number | undefined;
    if (!price) return null;

    const closes = hist
      .map((q: { close?: number | null }) => q.close)
      .filter((c: number | null | undefined): c is number => c != null);

    const ath = closes.length > 0
      ? Math.max(...closes)
      : (quote as Record<string, unknown>).fiftyTwoWeekHigh ?? 0;

    if (Number(ath) <= 0) return null;
    return `${(((price - Number(ath)) / Number(ath)) * 100).toFixed(1)}%`;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const forceAll = url.searchParams.get("all") === "1";

  const sql = getDb();
  const rows = forceAll
    ? await sql`SELECT id, symbol FROM watchlist_items ORDER BY created_at DESC`
    : await sql`SELECT id, symbol FROM watchlist_items WHERE distance_from_ath IS NULL OR distance_from_ath = '?' ORDER BY created_at DESC`;

  const CONCURRENCY = 5;
  let updated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (row) => {
        const ath = await computeAth(row.symbol);
        if (ath) {
          await sql`UPDATE watchlist_items SET distance_from_ath = ${ath} WHERE id = ${row.id}`;
          return { symbol: row.symbol, ath };
        }
        return null;
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) updated++;
      else {
        failed++;
        if (r.status === "rejected") errors.push(String(r.reason).slice(0, 80));
      }
    }
  }

  revalidatePath("/");

  return NextResponse.json({
    ok: true,
    total: rows.length,
    updated,
    failed,
    errors: errors.slice(0, 10),
  });
}
