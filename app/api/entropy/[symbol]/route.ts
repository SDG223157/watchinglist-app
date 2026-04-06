import { NextResponse } from "next/server";
import { fetchStock } from "@/lib/db";
import { cachedHistorical } from "@/lib/yf-cache";
import { computeEntropyProfile } from "@/lib/entropy";

export const dynamic = "force-dynamic";

interface HistBar {
  date: Date;
  close: number;
  volume: number;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const decoded = decodeURIComponent(symbol);

  try {
    const stock = await fetchStock(decoded);

    const period1 = new Date();
    period1.setFullYear(period1.getFullYear() - 3);
    const p1 = period1.toISOString().split("T")[0];

    const hist = (await cachedHistorical(decoded, p1)) as HistBar[];
    if (!hist || hist.length < 100) {
      return NextResponse.json(
        { error: "Insufficient historical data" },
        { status: 404 }
      );
    }

    const prices = hist.map((h) => h.close);
    const volumes = hist.map((h) => h.volume);
    const dates = hist.map((h) =>
      h.date instanceof Date
        ? h.date.toISOString().split("T")[0]
        : String(h.date).split("T")[0]
    );

    const profile = computeEntropyProfile(prices, volumes, dates, stock ?? undefined);

    return NextResponse.json({
      symbol: decoded,
      ...profile,
      computed_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error(`Entropy error for ${decoded}:`, e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
