import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { yahooFinance } from "@/lib/yf-cache";
import { jsonWithCache } from "@/lib/cache-headers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return jsonWithCache({ error: "Unauthorized" }, "none", 401);
  }

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 1) {
    return jsonWithCache({ results: [] }, "none");
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

    return jsonWithCache({ results }, "short");
  } catch {
    return jsonWithCache({ results: [] }, "none");
  }
}
