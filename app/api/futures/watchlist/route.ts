import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth } from "@/auth";
import {
  getFuturesWatchlist,
  addToFuturesWatchlist,
  removeFromFuturesWatchlist,
} from "@/lib/futures";
import { jsonWithCache } from "@/lib/cache-headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return jsonWithCache({ error: "Unauthorized" }, "none", 401);

  const items = await getFuturesWatchlist(session.user.email);
  return jsonWithCache({ items }, "short");
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { code, name, exchange, multiplier, price } = body;
  if (!code || !name || !exchange) {
    return NextResponse.json({ error: "code, name, exchange required" }, { status: 400 });
  }

  await addToFuturesWatchlist(session.user.email, {
    code,
    name,
    exchange,
    multiplier: multiplier ?? 0,
    price: price ?? null,
  });

  revalidateTag("futures", "max");
  return NextResponse.json({ ok: true, code });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  await removeFromFuturesWatchlist(session.user.email, code);
  revalidateTag("futures", "max");
  return NextResponse.json({ ok: true, code });
}
