import { NextResponse } from "next/server";
import { runBounceAnalysis } from "@/lib/bounce-leader";
import { cacheGet, cacheSet } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const troughParam = url.searchParams.get("trough") || undefined;
    const day1Param = url.searchParams.get("day1") || undefined;
    const marketParam = (url.searchParams.get("market") || "all") as "us" | "china" | "qdii" | "both" | "all";
    const forceRefresh = url.searchParams.get("refresh") === "1";

    const cacheKey = `bounce:${marketParam}:${troughParam ?? "auto"}:${day1Param ?? "auto"}`;

    if (!forceRefresh) {
      const cached = await cacheGet<Awaited<ReturnType<typeof runBounceAnalysis>> & { source?: string }>(
        cacheKey
      );
      if (cached?.computedAt) {
        const age = Date.now() - new Date(cached.computedAt).getTime();
        if (age < 60 * 60 * 1000) {
          return NextResponse.json({ ...cached, source: "cache" });
        }
      }
    }

    const result = await runBounceAnalysis({
      troughDate: troughParam,
      day1Date: day1Param,
      market: marketParam,
    });

    await cacheSet(cacheKey, result, 60 * 60);
    return NextResponse.json({ ...result, source: "live" });
  } catch (e) {
    console.error("[bounce API]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
