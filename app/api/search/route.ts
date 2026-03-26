import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

import { yahooFinance } from "@/lib/yf-cache";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  try {
    const data = await yahooFinance.search(q, {
      quotesCount: 8,
      newsCount: 0,
    });

    const results = (data.quotes || [])
      .filter((r: { quoteType?: string; symbol?: string }) =>
        r.symbol && (r.quoteType === "EQUITY" || r.quoteType === "ETF")
      )
      .map((r: { symbol: string; shortname?: string; longname?: string; exchange?: string; quoteType?: string }) => ({
        symbol: r.symbol,
        name: r.shortname || r.longname || r.symbol,
        exchange: r.exchange || "",
        type: r.quoteType || "",
      }));

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
