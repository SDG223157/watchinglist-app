import { NextResponse } from "next/server";
import { fetchAllLatest } from "@/lib/db";
import { cachedHistorical } from "@/lib/yf-cache";
import { computeEntropyProfile, portfolioEntropy, type EntropyProfile } from "@/lib/entropy";
import { computeTailDependence } from "@/lib/copula";
import { loadEntropyCache, isCacheStale } from "@/lib/entropy-cache";
import { cacheGet, cacheSet } from "@/lib/redis";

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

function transferEntropy(x: number[], y: number[], bins = 6, lag = 1): number {
  const n = Math.min(x.length, y.length) - lag;
  if (n < 30) return 0;
  const xs = x.slice(-n - lag);
  const ys = y.slice(-n - lag);
  const xPast = xs.slice(0, n);
  const yPast = ys.slice(0, n);
  const yFuture = ys.slice(lag, lag + n);

  const quantize = (vals: number[]) => {
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    const rng = mx - mn || 1e-9;
    return vals.map((v) => Math.max(0, Math.min(bins - 1, Math.floor(((v - mn) / rng) * bins))));
  };

  const xb = quantize(xPast);
  const yb = quantize(yPast);
  const yf = quantize(yFuture);

  const c3 = new Map<string, number>();
  const c2 = new Map<string, number>();
  const c1 = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    const k3 = `${yf[i]}|${yb[i]}|${xb[i]}`;
    const k2 = `${yf[i]}|${yb[i]}`;
    const k1 = `${yb[i]}`;
    c3.set(k3, (c3.get(k3) || 0) + 1);
    c2.set(k2, (c2.get(k2) || 0) + 1);
    c1.set(k1, (c1.get(k1) || 0) + 1);
  }

  let te = 0;
  for (const [k3, v3] of c3.entries()) {
    const [yfStr, ypStr] = k3.split("|");
    const k2a = `${yfStr}|${ypStr}`;
    const p1v = c1.get(ypStr) || 1;
    const p2v = c2.get(k2a) || 1;
    const pCond1 = v3 / p2v;
    const pCond2 = p2v / p1v;
    if (pCond1 > 0 && pCond2 > 0) {
      te += (v3 / n) * Math.log2(pCond1 / pCond2);
    }
  }
  return Math.max(te, 0);
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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const forceRefresh = url.searchParams.get("refresh") === "1";

    if (!forceRefresh) {
      // Layer 1: Redis (sub-ms)
      const redisData = await cacheGet<{ profiles: unknown[]; portfolio: unknown; computed_at: string }>("entropy:all");
      if (redisData && !isCacheStale(redisData.computed_at)) {
        return NextResponse.json({ ...redisData, source: "redis" });
      }

      // Layer 2: Neon DB (~50ms)
      const cached = await loadEntropyCache();
      if (cached && !isCacheStale(cached.computed_at)) {
        await cacheSet("entropy:all", cached, 72000); // backfill Redis, 20hr TTL
        return NextResponse.json({
          profiles: cached.profiles,
          portfolio: cached.portfolio,
          computed_at: cached.computed_at,
          source: "db-cache",
        });
      }
    }

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

          let teDirection = "N/A";
          let teNet = 0;
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

            const teTo = transferEntropy(sr, br);
            const teFrom = transferEntropy(br, sr);
            teNet = teTo - teFrom;
            teDirection = teNet > 0.005 ? "Vol→Price" : teNet < -0.005 ? "Mkt→Stock" : "Bidirectional";

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
      source: "live",
    });
  } catch (e) {
    console.error("Entropy API error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
