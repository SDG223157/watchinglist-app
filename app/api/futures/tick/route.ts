import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { jsonWithCache } from "@/lib/cache-headers";

export const dynamic = "force-dynamic";

const AKTOOLS_BASE = process.env.AKTOOLS_URL || "http://localhost:8888";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return jsonWithCache({ error: "Unauthorized" }, "none", 401);

  const symbol = req.nextUrl.searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) return jsonWithCache({ error: "symbol required" }, "none", 400);

  try {
    const res = await fetch(`${AKTOOLS_BASE}/api/tick?symbol=${symbol}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return jsonWithCache({ error: "offline" }, "none", 502);
    const data = await res.json();
    return jsonWithCache(data, "none");
  } catch {
    return jsonWithCache({ error: "offline" }, "none", 502);
  }
}
