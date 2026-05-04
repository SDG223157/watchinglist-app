import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth } from "@/auth";
import { getFuturesAnalysis, updateFuturesAnalysis, fetchVarieties, addToFuturesWatchlist } from "@/lib/futures";
import { jsonWithCache } from "@/lib/cache-headers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const AKTOOLS_BASE = process.env.AKTOOLS_URL || "http://localhost:8888";

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
  const code = (body.code || "").trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  // If a report is provided directly, store it
  if (body.report) {
    await updateFuturesAnalysis(session.user.email, code, body.report);
    revalidateTag("futures", "max");
    return NextResponse.json({ ok: true, code });
  }

  // Otherwise, trigger GPT-5.4 analysis via the FastAPI backend
  try {
    const res = await fetch(`${AKTOOLS_BASE}/api/analyze?code=${code}`, {
      signal: AbortSignal.timeout(115_000),
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Analysis backend error: ${err}` }, { status: 502 });
    }
    const result = await res.json();
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    const report = result.report as string;

    // Ensure variety is in the watchlist
    const varieties = await fetchVarieties();
    if (varieties) {
      for (const items of Object.values(varieties)) {
        const match = (items as Array<{ code: string; name: string; exchange: string; multiplier: number; price: number | null }>)
          .find((v) => v.code.toUpperCase() === code);
        if (match) {
          await addToFuturesWatchlist(session.user.email, { ...match, exchange: match.exchange || "" });
          break;
        }
      }
    }

    // Store the report
    await updateFuturesAnalysis(session.user.email, code, report);
    revalidateTag("futures", "max");
    return NextResponse.json({ ok: true, code, report });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
