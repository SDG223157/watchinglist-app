import { NextRequest, NextResponse } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { refreshStockData } from "@/lib/refresh-stock";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const symbol = (body.symbol || "").trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json(
      { error: "Symbol is required" },
      { status: 400 }
    );
  }

  try {
    const result = await refreshStockData(symbol);

    revalidateTag("stocks", "max");
    revalidatePath("/");

    return NextResponse.json({
      ok: true,
      symbol: result.symbol,
      name: result.name,
      price: result.price,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("analyze error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
