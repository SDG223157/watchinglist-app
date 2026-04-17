import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runBounceAnalysis } from "@/lib/bounce-leader";
import { generateInsights, type BounceInsights } from "@/lib/bounce-insights";
import { cacheGet, cacheSet } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const troughDate: string | undefined = body.trough;
    const day1Date: string | undefined = body.day1;
    const forceRefresh: boolean = body.refresh === true;

    const cacheKey = `bounce-insights:${troughDate ?? "auto"}:${day1Date ?? "auto"}`;

    if (!forceRefresh) {
      const cached = await cacheGet<BounceInsights & { source?: string }>(cacheKey);
      if (cached?.generatedAt) {
        const age = Date.now() - new Date(cached.generatedAt).getTime();
        // Cache insights for 6 hours — leadership signals persist that long
        if (age < 6 * 60 * 60 * 1000) {
          return NextResponse.json({ ...cached, source: "cache" });
        }
      }
    }

    const data = await runBounceAnalysis({
      troughDate,
      day1Date,
      market: "all",
    });

    const insights = await generateInsights(data);

    await cacheSet(cacheKey, insights, 6 * 60 * 60);

    return NextResponse.json({
      ...insights,
      troughDate: data.troughDate,
      day1Date: data.day1Date,
      source: "live",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[bounce-insights]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
