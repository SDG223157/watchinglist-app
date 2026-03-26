import { NextResponse } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb, fetchAllLatest } from "@/lib/db";
import { computeCompositeScore } from "@/lib/composite-score";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stocks = await fetchAllLatest();
  const sql = getDb();
  let updated = 0;

  for (const s of stocks) {
    const { total } = computeCompositeScore(s);
    await sql`
      UPDATE watchlist_items SET composite_score = ${total}
      WHERE id = (
        SELECT id FROM watchlist_items
        WHERE symbol = ${s.symbol}
        ORDER BY created_at DESC LIMIT 1
      )
    `;
    updated++;
  }

  revalidateTag("stocks", "max");
  revalidatePath("/");

  return NextResponse.json({ ok: true, updated });
}
