import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { fetchKline } from "@/lib/futures";
import { jsonWithCache } from "@/lib/cache-headers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return jsonWithCache({ error: "Unauthorized" }, "none", 401);

  const p = req.nextUrl.searchParams;
  const symbol = p.get("symbol")?.trim().toUpperCase();
  if (!symbol) return jsonWithCache({ error: "symbol required" }, "none", 400);

  const startDate = p.get("start_date") || "20240101";
  const endDate = p.get("end_date") || "20261231";
  const period = p.get("period") || "daily";

  const data = await fetchKline(symbol, startDate, endDate, period);
  if (!data.length) return jsonWithCache({ error: "No data" }, "none", 404);

  return jsonWithCache(data, "short");
}
