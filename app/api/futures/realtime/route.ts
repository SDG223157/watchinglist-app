import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { jsonWithCache } from "@/lib/cache-headers";

export const dynamic = "force-dynamic";

const AKTOOLS_BASE = process.env.AKTOOLS_URL || "http://localhost:8888";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return jsonWithCache({ error: "Unauthorized" }, "none", 401);

  const code = req.nextUrl.searchParams.get("code")?.trim();
  if (!code) return jsonWithCache({ error: "code required" }, "none", 400);

  try {
    const res = await fetch(`${AKTOOLS_BASE}/api/realtime?code=${encodeURIComponent(code)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return jsonWithCache({ error: "Data source error" }, "none", 502);
    const data = await res.json();
    return jsonWithCache(data, "none"); // no cache — always fresh
  } catch {
    return jsonWithCache({ error: "Data source offline" }, "none", 502);
  }
}
