import { NextResponse } from "next/server";
import { fetchAllLatest } from "@/lib/db";
import { cachedHistorical } from "@/lib/yf-cache";
import { computeEntropyProfile, portfolioEntropy, type EntropyProfile } from "@/lib/entropy";
import { computeTailDependence } from "@/lib/copula";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface HistBar {
  date: Date;
  close: number;
  volume: number;
}

function benchmarkFor(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.endsWith(".HK")) return "^HSI";
  if (s.endsWith(".SS") || s.endsWith(".SZ")) return "000300.SS";
  if (s.endsWith(".T")) return "^N225";
  return "SPY";
}

export interface EnhancedProfile extends EntropyProfile {
  hmmRegime: string;
  hmmPersistence: number;
  teDirection: string;
  teNet: number;
  tailRegime: string;
  lowerTail: number;
  upperTail: number;
  tailAsymmetry: number;
}

export async function GET() {
  try {
    const stocks = await fetchAllLatest();

    const period1 = new Date();
    period1.setFullYear(period1.getFullYear() - 3);
    const p1 = period1.toISOString().split("T")[0];

    const benchSymbols = [...new Set(stocks.map((s) => benchmarkFor(s.symbol)))];
    const benchDataMap = new Map<string, number[]>();
    await Promise.allSettled(
      benchSymbols.map(async (bs) => {
        const hist = (await cachedHistorical(bs, p1)) as HistBar[];
        if (hist && hist.length > 100) {
          const prices = hist.map((h) => h.close).filter((v): v is number => v != null && !Number.isNaN(v));
          const ret = prices.slice(1).map((v, i) => Math.log(v / prices[i]));
          benchDataMap.set(bs, ret);
        }
      }),
    );

    const profiles: EnhancedProfile[] = [];
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

          const hmmRegime = stock.hmm_regime || "N/A";
          const hmmPersistence = stock.hmm_persistence ?? 0;

          const dbTe = stock.te_causal_direction;
          const dbTeNet = stock.transfer_entropy_net ?? 0;
          let teDirection = "N/A";
          let teNet = dbTeNet;
          if (dbTe) {
            if (dbTe.toLowerCase().includes("stock lead") || dbTe.toLowerCase().includes("vol")) {
              teDirection = "Vol→Price";
            } else if (dbTe.toLowerCase().includes("market lead") || dbTe.toLowerCase().includes("mkt")) {
              teDirection = "Mkt→Stock";
            } else {
              teDirection = "Bidirectional";
            }
          }

          let tailRegime = "N/A";
          let lowerTail = 0;
          let upperTail = 0;
          let tailAsymmetry = 0;

          const stockRet = prices.slice(1).map((v, idx) => Math.log(v / prices[idx]));
          const benchRet = benchDataMap.get(benchmarkFor(stock.symbol));
          if (benchRet && benchRet.length > 60) {
            const n = Math.min(stockRet.length, benchRet.length);
            const sr = stockRet.slice(-n);
            const br = benchRet.slice(-n);
            const tail = computeTailDependence(sr, br);
            tailRegime = tail.regime;
            lowerTail = tail.lowerTail;
            upperTail = tail.upperTail;
            tailAsymmetry = tail.asymmetry;
          }

          return {
            symbol: stock.symbol,
            ...profile,
            hmmRegime,
            hmmPersistence,
            teDirection,
            teNet,
            tailRegime,
            lowerTail,
            upperTail,
            tailAsymmetry,
          } as EnhancedProfile;
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
