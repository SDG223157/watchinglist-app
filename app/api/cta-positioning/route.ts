import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildCTADashboard, type CTAAssetClass } from "@/lib/cta-positioning";

export const maxDuration = 120;

const ASSET_CLASSES = new Set(["All", "Equities", "Rates", "FX", "Commodities"]);
const PERIODS = new Set(["1y", "2y", "3y", "5y", "max"]);

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const assetClassRaw = params.get("assetClass") || "All";
  const periodRaw = params.get("period") || "3y";
  const targetVolRaw = Number(params.get("targetVol") || "0.15");

  if (!ASSET_CLASSES.has(assetClassRaw)) {
    return NextResponse.json({ error: "Invalid assetClass" }, { status: 400 });
  }
  if (!PERIODS.has(periodRaw)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }

  try {
    const data = await buildCTADashboard({
      assetClass: assetClassRaw as CTAAssetClass | "All",
      period: periodRaw as "1y" | "2y" | "3y" | "5y" | "max",
      targetVol: targetVolRaw,
    });

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cta-positioning]", message);
    return NextResponse.json(
      { error: "CTA positioning failed", detail: message.slice(0, 500) },
      { status: 500 }
    );
  }
}
