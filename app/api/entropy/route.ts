import { NextResponse } from "next/server";
import { fetchAllLatest } from "@/lib/db";
import { cachedHistorical } from "@/lib/yf-cache";
import { computeEntropyProfile, portfolioEntropy, type EntropyProfile } from "@/lib/entropy";
import { fitHmm } from "@/lib/hmm";
import { computeTailDependence } from "@/lib/copula";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const rng = max - min || 1e-9;
    return vals.map((v) => {
      const idx = Math.floor(((v - min) / rng) * bins);
      return Math.max(0, Math.min(bins - 1, idx));
    });
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
    const k2 = `${yfStr}|${ypStr}`;
    const k1 = ypStr;
    const p1 = c1.get(k1) || 1;
    const p2 = c2.get(k2) || 1;
    const pCond1 = v3 / p2;
    const pCond2 = p2 / p1;
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

          let hmmRegime = "N/A";
          let hmmPersistence = 0;
          try {
            const hmm = fitHmm(prices, dates.slice(-prices.length), 3, 6);
            const lastState = hmm.states[hmm.states.length - 1];
            hmmRegime = hmm.stateLabels[lastState] || "N/A";
            hmmPersistence = hmm.persistence[lastState] || 0;
          } catch { /* skip */ }

          const stockRet = prices.slice(1).map((v, idx) => Math.log(v / prices[idx]));
          const benchRet = benchDataMap.get(benchmarkFor(stock.symbol));
          let teDirection = "N/A";
          let teNet = 0;
          let tailRegime = "N/A";
          let lowerTail = 0;
          let upperTail = 0;
          let tailAsymmetry = 0;

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
    });
  } catch (e) {
    console.error("Entropy API error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
