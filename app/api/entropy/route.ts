import { NextResponse } from "next/server";
import { fetchAllLatest } from "@/lib/db";
import { cachedHistorical } from "@/lib/yf-cache";
import { computeEntropyProfile, portfolioEntropy, type EntropyProfile } from "@/lib/entropy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface HistBar {
  date: Date;
  close: number;
  volume: number;
}

export async function GET() {
  try {
    const stocks = await fetchAllLatest();

    const period1 = new Date();
    period1.setFullYear(period1.getFullYear() - 3);
    const p1 = period1.toISOString().split("T")[0];

    const profiles: EntropyProfile[] = [];
    const allReturns: { symbol: string; returns60d: number[] }[] = [];

    const batchSize = 5;
    for (let i = 0; i < stocks.length; i += batchSize) {
      const batch = stocks.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (stock) => {
          const hist = (await cachedHistorical(stock.symbol, p1)) as HistBar[];
          if (!hist || hist.length < 100) return null;

          const prices = hist.map((h) => h.close);
          const volumes = hist.map((h) => h.volume);
          const dates = hist.map((h) =>
            h.date instanceof Date
              ? h.date.toISOString().split("T")[0]
              : String(h.date).split("T")[0]
          );

          const profile = computeEntropyProfile(prices, volumes, dates, stock);

          const ret60: number[] = [];
          const p = prices.slice(-61);
          for (let j = 1; j < p.length; j++) {
            if (p[j - 1] > 0 && p[j] > 0) ret60.push(Math.log(p[j] / p[j - 1]));
          }
          allReturns.push({ symbol: stock.symbol, returns60d: ret60 });

          return { symbol: stock.symbol, ...profile } as EntropyProfile;
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          profiles.push(r.value);
        }
      }
    }

    const portfolio = portfolioEntropy(allReturns);

    profiles.sort((a, b) => a.percentile - b.percentile);

    return NextResponse.json({
      profiles,
      portfolio,
      computed_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Entropy API error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
