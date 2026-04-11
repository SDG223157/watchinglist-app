import { NextResponse } from "next/server";
import { fetchStock } from "@/lib/db";
import { cachedHistorical } from "@/lib/yf-cache";
import { computeEntropyProfile } from "@/lib/entropy";
import { fitHmm } from "@/lib/hmm";

export const dynamic = "force-dynamic";

interface HistBar {
  date: Date | string;
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

  const all = (vals: number[]) => {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const rng = max - min || 1e-9;
    return vals.map((v) => {
      const idx = Math.floor(((v - min) / rng) * bins);
      return Math.max(0, Math.min(bins - 1, idx));
    });
  };

  const xb = all(xPast);
  const yb = all(yPast);
  const yf = all(yFuture);

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

function ouHalfLife(prices: number[]): number | null {
  if (prices.length < 20) return null;
  const logP = prices.map((p) => Math.log(p));
  const delta = logP.slice(1).map((v, i) => v - logP[i]);
  const lag = logP.slice(0, -1);
  const mean = lag.reduce((s, v) => s + v, 0) / lag.length;
  const centered = lag.map((v) => v - mean);
  const denom = centered.reduce((s, v) => s + v * v, 0);
  if (denom === 0) return null;
  const beta = centered.reduce((s, v, i) => s + v * delta[i], 0) / denom;
  if (beta >= 0) return null;
  const hl = -Math.log(2) / beta;
  return hl > 0 && hl < 1000 ? hl : null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const decoded = decodeURIComponent(symbol).toUpperCase();

  try {
    const stock = await fetchStock(decoded);
    const period1 = new Date();
    period1.setFullYear(period1.getFullYear() - 5);
    const p1 = period1.toISOString().split("T")[0];

    const hist = (await cachedHistorical(decoded, p1)) as HistBar[];
    if (!hist || hist.length < 260) {
      return NextResponse.json({ error: "Insufficient historical data" }, { status: 404 });
    }

    const prices = hist.map((h) => h.close).filter((v): v is number => v != null && !Number.isNaN(v));
    const volumes = hist.map((h) => h.volume ?? 0);
    const dates = hist.map((h) =>
      h.date instanceof Date ? h.date.toISOString().split("T")[0] : String(h.date).split("T")[0],
    );
    if (prices.length < 260) {
      return NextResponse.json({ error: "Insufficient valid prices" }, { status: 404 });
    }

    const hmm = fitHmm(prices, dates.slice(-prices.length), 3);
    const lastState = hmm.states[hmm.states.length - 1];
    const hmmRegime = hmm.stateLabels[lastState] || "N/A";
    const hmmPersistence = hmm.persistence[lastState] || 0;

    const entropy = computeEntropyProfile(prices, volumes.slice(-prices.length), dates.slice(-prices.length), stock ?? undefined);

    const benchHist = (await cachedHistorical(benchmarkFor(decoded), p1)) as HistBar[];
    const benchPrices = benchHist.map((h) => h.close).filter((v): v is number => v != null && !Number.isNaN(v));
    const stockRet = prices.slice(1).map((v, i) => Math.log(v / prices[i]));
    const benchRet = benchPrices.slice(1).map((v, i) => Math.log(v / benchPrices[i]));
    const n = Math.min(stockRet.length, benchRet.length);
    const teTo = n > 30 ? transferEntropy(stockRet.slice(-n), benchRet.slice(-n)) : 0;
    const teFrom = n > 30 ? transferEntropy(benchRet.slice(-n), stockRet.slice(-n)) : 0;
    const teNet = teTo - teFrom;
    const teDirection = teNet > 0.005 ? "Stock leads" : teNet < -0.005 ? "Market leads" : "Bidirectional";

    const hlFull = ouHalfLife(prices);
    const hlRecent = ouHalfLife(prices.slice(-120)) ?? hlFull;
    const halflifeRegime =
      hlRecent == null ? "Structural (>180d)" :
      hlRecent < 30 ? "Fast (<30d)" :
      hlRecent < 90 ? "Medium (30-90d)" :
      hlRecent < 180 ? "Slow (90-180d)" :
      "Structural (>180d)";

    const ath = Math.max(...prices);
    const current = prices[prices.length - 1];
    const athDist = ath > 0 ? ((current / ath) - 1) * 100 : 0;
    const pe = stock?.pe_ratio ?? stock?.pe_ttm ?? null;
    const nearAth = athDist > -15;
    const farAth = athDist <= -25;
    const expensive = pe != null && pe > 40;
    const cheap = pe != null && pe > 0 && pe < 20;

    let conviction = "STANDARD";
    let convictionMultiplier = 1.0;
    if (entropy.regime === "compressed") {
      if (nearAth && expensive && entropy.cogGap >= 5) {
        conviction = "CROWDED";
        convictionMultiplier = 0.7;
      } else if (nearAth && expensive) {
        conviction = "CROWDED";
        convictionMultiplier = 0.8;
      } else if (entropy.anchorFailure && farAth) {
        conviction = "MAXIMUM";
        convictionMultiplier = 1.5;
      } else if (entropy.anchorFailure) {
        conviction = "MAXIMUM";
        convictionMultiplier = 1.4;
      } else if (entropy.cogGap >= 5 && farAth) {
        conviction = "HIGH";
        convictionMultiplier = 1.4;
      } else if (entropy.cogGap >= 5) {
        conviction = "HIGH";
        convictionMultiplier = 1.3;
      } else if (farAth && cheap) {
        conviction = "HIGH";
        convictionMultiplier = 1.3;
      } else {
        conviction = "ELEVATED";
        convictionMultiplier = 1.1;
      }
    } else if (entropy.regime === "diverse") {
      conviction = "NORMAL";
      convictionMultiplier = 1.0;
    }

    const recent = prices.slice(-75);
    const hi = Math.max(...recent);
    const lo = Math.min(...recent);
    const rng = hi - lo || 1;
    const position = ((current - lo) / rng) * 100;
    const retracement = ((hi - current) / rng) * 100;
    const trendwiseOpen = position > retracement;

    let entryAssessment = "WAIT — need TrendWise confirmation";
    if (hmmRegime.toLowerCase().includes("bear") && hmmPersistence > 0.85) {
      entryAssessment = "SKIP — Bear regime, high persistence";
    } else if (trendwiseOpen) {
      entryAssessment = "CONFIRMED — full position (TrendWise Open)";
    } else if (conviction === "MAXIMUM") {
      entryAssessment = "EARLY 1/2 — MAXIMUM conviction overrides TW lag";
    } else if (conviction === "HIGH") {
      entryAssessment = "EARLY 1/4 — HIGH conviction overrides TW lag";
    }

    let crossReference = `${hmmRegime} + ${entropy.regime}`;
    if (hmmRegime === "Bull" && entropy.regime === "compressed") crossReference = "FRAGILE MANIA";
    else if (hmmRegime === "Bear" && entropy.regime === "compressed") crossReference = "POTENTIAL REVERSAL";
    else if (hmmRegime === "Bull" && entropy.regime === "diverse") crossReference = "HEALTHY BULL";
    else if (hmmRegime === "Flat" && entropy.regime === "compressed") crossReference = "HIDDEN OPPORTUNITY";

    let lookbackInterpretation = "Normal vs both timeframes";
    const p1y = entropy.percentile1y;
    const p3y = entropy.percentile3y;
    if (p1y <= 20 && p3y <= 20) lookbackInterpretation = "Chronically compressed";
    else if (p1y <= 20) lookbackInterpretation = "Recently compressed (most actionable)";
    else if (p3y <= 20) lookbackInterpretation = "Recovering (edge fading)";

    return NextResponse.json({
      symbol: decoded,
      price: current,
      ath,
      athDistancePct: athDist,
      pe,
      hmm: {
        regime: hmmRegime,
        persistence: hmmPersistence,
      },
      entropy: {
        h60: entropy.current60d,
        h120: entropy.current120d,
        h252: entropy.current252d,
        volumeEntropy60d: entropy.volumeEntropy60d,
        percentile: entropy.percentile,
        percentile1y: entropy.percentile1y,
        percentile3y: entropy.percentile3y,
        trend: entropy.trend,
        regime: entropy.regime,
        cogGap: entropy.cogGap,
        cogGapLabel: entropy.cogGapLabel,
        anchorFailure: entropy.anchorFailure,
        anchorDetail: entropy.anchorDetail,
        history: entropy.history.slice(-180),
      },
      hmmHistory: {
        states: hmm.states.slice(-180),
        labels: hmm.stateLabels,
        dates: hmm.dates.slice(-180),
      },
      transferEntropy: {
        toBenchmark: teTo,
        fromBenchmark: teFrom,
        net: teNet,
        direction: teDirection,
      },
      halfLife: {
        full: hlFull,
        recent120d: hlRecent,
        regime: halflifeRegime,
      },
      trendwise: {
        position,
        retracement,
        open: trendwiseOpen,
      },
      conviction: {
        level: conviction,
        multiplier: convictionMultiplier,
      },
      entryAssessment,
      crossReference,
      lookbackInterpretation,
      computed_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error(`HMM×Entropy error for ${decoded}:`, e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
