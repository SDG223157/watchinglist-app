import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runCrossSection, CrossSectionResult } from "@/lib/cross-section";

export const maxDuration = 300;

let cached: { data: CrossSectionResult; ts: number } | null = null;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours — fundamentals are annual

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return NextResponse.json(cached.data, {
        headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" },
      });
    }

    const data = await runCrossSection();
    cached = { data, ts: Date.now() };
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cross-section]", message);
    return NextResponse.json(
      { error: "Cross-section computation failed", detail: message.slice(0, 500) },
      { status: 500 }
    );
  }
}
