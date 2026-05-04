import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth } from "@/auth";
import { getFuturesAnalysis, updateFuturesAnalysis } from "@/lib/futures";
import { jsonWithCache } from "@/lib/cache-headers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return jsonWithCache({ error: "Unauthorized" }, "none", 401);

  const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase();
  if (!code) return jsonWithCache({ error: "code required" }, "none", 400);

  const item = await getFuturesAnalysis(session.user.email, code);
  return jsonWithCache(item ?? { analysis_report: null }, "short");
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { code, report } = body;
  if (!code || !report) {
    return NextResponse.json({ error: "code and report required" }, { status: 400 });
  }

  await updateFuturesAnalysis(session.user.email, code.toUpperCase(), report);
  revalidateTag("futures", "max");
  return NextResponse.json({ ok: true, code });
}
