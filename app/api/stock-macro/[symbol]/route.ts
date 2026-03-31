import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { analyzeStockMacro, StockMacroResult } from "@/lib/stock-macro";

export const maxDuration = 120;

const cache = new Map<string, { data: StockMacroResult; ts: number }>();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();

  const cached = cache.get(sym);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.data, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" },
    });
  }

  try {
    const data = await analyzeStockMacro(sym);
    cache.set(sym, { data, ts: Date.now() });
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
