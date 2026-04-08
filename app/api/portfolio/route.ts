import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchAllLatest } from "@/lib/db";
import { buildPortfolio } from "@/lib/portfolio-builder";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const capital = Number(body.capital) || 1_000_000;
  const market = (body.market || "ALL").toUpperCase();
  const maxHoldings = Number(body.maxHoldings) || 25;

  const allStocks = await fetchAllLatest();

  const filtered = allStocks.filter((s) => {
    if (market === "ALL") return true;
    if (market === "US") return !s.symbol.includes(".HK") && !s.symbol.includes(".SS") && !s.symbol.includes(".SZ");
    if (market === "HK") return s.symbol.includes(".HK");
    if (market === "CN") return s.symbol.includes(".SS") || s.symbol.includes(".SZ");
    if (market === "CHINA") return s.symbol.includes(".HK") || s.symbol.includes(".SS") || s.symbol.includes(".SZ");
    return true;
  });

  const result = buildPortfolio(filtered, capital, maxHoldings);
  return NextResponse.json(result);
}
