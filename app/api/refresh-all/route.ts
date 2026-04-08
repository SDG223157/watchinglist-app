import { NextResponse } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb, fetchAllLatest } from "@/lib/db";
import { refreshStockData } from "@/lib/refresh-stock";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stocks = await fetchAllLatest();
  const symbols = stocks.map((s) => s.symbol);
  const total = symbols.length;

  const results: { symbol: string; ok: boolean; error?: string }[] = [];
  let success = 0;
  let failed = 0;

  for (const symbol of symbols) {
    try {
      await refreshStockData(symbol);
      results.push({ symbol, ok: true });
      success++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ symbol, ok: false, error: msg.slice(0, 100) });
      failed++;
    }
  }

  revalidateTag("stocks", "max");
  revalidatePath("/");

  return NextResponse.json({
    ok: true,
    total,
    success,
    failed,
    results,
  });
}
