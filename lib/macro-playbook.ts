import { cachedHistorical, yahooFinance } from "./yf-cache";

// M2 Money Supply (FRED, quarterly updates)
const M2: Record<number, number> = {
  2006: 6.8, 2007: 7.4, 2008: 7.8, 2009: 8.4, 2010: 8.8,
  2011: 9.6, 2012: 10.4, 2013: 10.9, 2014: 11.4, 2015: 12.0,
  2016: 12.9, 2017: 13.7, 2018: 14.3, 2019: 15.3, 2020: 19.1,
  2021: 21.6, 2022: 21.4, 2023: 20.9, 2024: 21.2, 2025: 22.0,
  2026: 22.5,
};
const M2_CURRENT = M2[Math.max(...Object.keys(M2).map(Number))];
const M2_BASELINE = M2[2019];
const SPY_PE_HIST = 19.0;

interface AssetDef {
  name: string;
  ticker: string;
  category: string;
  hedgeAgainst: string[];
  arbPeers: [string, string][];
  m2Baseline: number;
  structuralBid: number;
}

const ASSETS: Record<string, AssetDef> = {
  gold:   { name: "Gold",           ticker: "GC=F",     category: "commodity", hedgeAgainst: ["monetary debasement", "fiat currency risk", "geopolitical tail risk"], arbPeers: [["SPY","S&P 500"],["CL=F","Oil"],["BTC-USD","Bitcoin"],["SI=F","Silver"]], m2Baseline: 1520, structuralBid: 90 },
  oil:    { name: "Oil (WTI)",      ticker: "CL=F",     category: "commodity", hedgeAgainst: ["inflation (energy input cost)", "geopolitical supply disruption"], arbPeers: [["SPY","S&P 500"],["GC=F","Gold"],["BZ=F","Brent"]], m2Baseline: 60, structuralBid: 50 },
  spy:    { name: "S&P 500",        ticker: "SPY",      category: "equity",    hedgeAgainst: ["cash debasement", "inflation (earnings growth)"], arbPeers: [["GC=F","Gold"],["CL=F","Oil"],["BTC-USD","Bitcoin"],["TIP","TIPS"]], m2Baseline: 320, structuralBid: 70 },
  btc:    { name: "Bitcoin",        ticker: "BTC-USD",  category: "crypto",    hedgeAgainst: ["monetary debasement (digital)", "censorship risk"], arbPeers: [["GC=F","Gold"],["SPY","S&P 500"]], m2Baseline: 7200, structuralBid: 40 },
  silver: { name: "Silver",         ticker: "SI=F",     category: "commodity", hedgeAgainst: ["monetary debasement", "industrial demand hedge"], arbPeers: [["GC=F","Gold"],["SPY","S&P 500"],["CL=F","Oil"]], m2Baseline: 18, structuralBid: 45 },
  usd:    { name: "US Dollar (DXY)",ticker: "DX-Y.NYB", category: "currency",  hedgeAgainst: ["liquidity crisis", "flight to safety"], arbPeers: [["GC=F","Gold"],["BTC-USD","Bitcoin"]], m2Baseline: 97, structuralBid: 80 },
};

interface SectorDef {
  name: string; etf: string; betaType: "defensive" | "cyclical"; peakPhase: string;
}
const SECTORS: Record<string, SectorDef> = {
  staples:     { name: "Consumer Staples",     etf: "XLP",  betaType: "defensive", peakPhase: "late-cycle / recession" },
  utilities:   { name: "Utilities",            etf: "XLU",  betaType: "defensive", peakPhase: "recession / early recovery" },
  healthcare:  { name: "Healthcare",           etf: "XLV",  betaType: "defensive", peakPhase: "late-cycle / recession" },
  realestate:  { name: "Real Estate",          etf: "XLRE", betaType: "defensive", peakPhase: "early-cycle (rate cuts)" },
  tech:        { name: "Technology",           etf: "XLK",  betaType: "cyclical",  peakPhase: "mid-cycle / boom" },
  discretionary:{ name: "Consumer Disc.",      etf: "XLY",  betaType: "cyclical",  peakPhase: "early / mid-cycle" },
  financials:  { name: "Financials",           etf: "XLF",  betaType: "cyclical",  peakPhase: "early / mid-cycle" },
  industrials: { name: "Industrials",          etf: "XLI",  betaType: "cyclical",  peakPhase: "early / mid-cycle" },
  energy:      { name: "Energy",              etf: "XLE",  betaType: "cyclical",  peakPhase: "late-cycle (inflation)" },
  materials:   { name: "Materials",           etf: "XLB",  betaType: "cyclical",  peakPhase: "mid-cycle" },
  comm_svc:    { name: "Comm Services",       etf: "XLC",  betaType: "cyclical",  peakPhase: "mid-cycle / boom" },
};

const VERIFY_TICKERS: Record<string, Record<string, string>> = {
  cross_asset: { Gold: "GC=F", Oil: "CL=F", SPY: "SPY", BTC: "BTC-USD", USD: "DX-Y.NYB", Silver: "SI=F" },
  bonds:       { "TLT (20Y+)": "TLT", "SHY (1-3Y)": "SHY", TIPS: "TIP", "HYG (Junk)": "HYG" },
  volatility:  { VIX: "^VIX" },
  sectors:     { Energy: "XLE", Utilities: "XLU", Staples: "XLP", Healthcare: "XLV", Tech: "XLK", Discretionary: "XLY", Financials: "XLF", Industrials: "XLI", Materials: "XLB", "Real Estate": "XLRE", "Comm Svc": "XLC" },
  factors:     { "Value (IWD)": "IWD", "Growth (IWF)": "IWF", "EqWt (RSP)": "RSP", "Semis (SOXX)": "SOXX", "Defense (ITA)": "ITA", "Banks (KBWB)": "KBWB" },
};

// ─── helpers ────────────────────────────────────────────────
async function getHistory(ticker: string, years = 10) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  const rows = await cachedHistorical(ticker, d.toISOString().split("T")[0]);
  return rows.filter((r: { close?: number }) => r.close != null) as { date: Date; close: number }[];
}

function retFromHist(hist: { close: number }[], days: number) {
  if (hist.length <= days) return 0;
  return (hist[hist.length - 1].close / hist[hist.length - 1 - days].close - 1) * 100;
}

function ytdRet(hist: { date: Date; close: number }[]) {
  if (hist.length < 2) return 0;
  const yr = new Date(hist[hist.length - 1].date).getFullYear();
  const first = hist.find((r) => new Date(r.date).getFullYear() === yr);
  if (!first) return 0;
  return (hist[hist.length - 1].close / first.close - 1) * 100;
}

function percentile(arr: number[], val: number) {
  return (arr.filter((v) => v < val).length / arr.length) * 100;
}

async function getSpyPE(): Promise<number> {
  try {
    const q = await yahooFinance.quote("SPY");
    return q?.trailingPE ?? q?.forwardPE ?? SPY_PE_HIST;
  } catch { return SPY_PE_HIST; }
}

// ─── core analysis ──────────────────────────────────────────
function computeHedge(def: AssetDef, hist: { close: number }[]) {
  const price = hist[hist.length - 1].close;
  const m2Floor = def.m2Baseline * (M2_CURRENT / M2_BASELINE);
  const m2Premium = (price / m2Floor - 1) * 100;

  let m2Score: number;
  if (m2Premium < 0) m2Score = 0;
  else if (m2Premium < 50) m2Score = Math.round(m2Premium);
  else m2Score = Math.min(100, 50 + Math.round((m2Premium - 50) / 2));

  const logRet = hist.slice(1).map((r, i) => Math.log(r.close / hist[i].close));
  const vol3m = logRet.length >= 63 ? std(logRet.slice(-63)) * Math.sqrt(252) * 100 : 0;
  const vol1y = logRet.length >= 252 ? std(logRet.slice(-252)) * Math.sqrt(252) * 100 : vol3m;
  const volScore = Math.min(100, Math.round((vol3m / Math.max(vol1y, 1)) * 50));

  const hedgeScore = Math.round(0.4 * m2Score + 0.3 * volScore + 0.3 * def.structuralBid);

  let activation = "WARMING";
  if (m2Premium < -10) activation = "DORMANT";
  else if (m2Premium < 20) activation = "WARMING";
  else if (m2Premium < 50) activation = "ACTIVE";
  else if (m2Premium < 100) activation = "HOT";
  else activation = "EXTREME";

  return { score: hedgeScore, m2Floor: round(m2Floor), m2Premium: round(m2Premium), activation, price };
}

function computeArb(
  def: AssetDef,
  hist: { close: number; date: Date }[],
  allHist: Map<string, { close: number; date: Date }[]>,
  spyPE: number
) {
  const price = hist[hist.length - 1].close;
  const pctiles: number[] = [];
  const fairValues: number[] = [];

  for (const [peerTk] of def.arbPeers) {
    const ph = allHist.get(peerTk);
    if (!ph || ph.length < 100) continue;

    const histMap = new Map(hist.map((r) => [new Date(r.date).toISOString().split("T")[0], r.close]));
    const common: { a: number; b: number }[] = [];
    for (const pr of ph) {
      const dk = new Date(pr.date).toISOString().split("T")[0];
      const ac = histMap.get(dk);
      if (ac != null) common.push({ a: ac, b: pr.close });
    }
    if (common.length < 100) continue;

    const ratios = common.map((c) => c.a / c.b);
    const ratioNow = ratios[ratios.length - 1];
    const pct = percentile(ratios, ratioNow);
    pctiles.push(pct);

    const mean = ratios.reduce((s, v) => s + v, 0) / ratios.length;
    let peAdj = 1;
    if (spyPE && peerTk === "SPY" && def.category !== "equity") peAdj = spyPE / SPY_PE_HIST;
    const fairRatio = mean * peAdj;
    fairValues.push(fairRatio * ph[ph.length - 1].close);
  }

  if (pctiles.length === 0) return { score: 50, fairValue: price, premium: 0, signal: "N/A" };

  const avgPct = pctiles.reduce((s, v) => s + v, 0) / pctiles.length;
  fairValues.sort((a, b) => a - b);
  const fairValue = fairValues[Math.floor(fairValues.length / 2)];
  const premium = (price / fairValue - 1) * 100;

  let signal: string;
  if (avgPct > 80) signal = "RICH";
  else if (avgPct > 60) signal = "ABOVE AVG";
  else if (avgPct > 40) signal = "FAIR";
  else if (avgPct > 20) signal = "BELOW AVG";
  else signal = "CHEAP";

  return { score: Math.round(avgPct), fairValue: round(fairValue), premium: round(premium), signal };
}

// ─── public ─────────────────────────────────────────────────
export async function runPlaybook() {
  const spyPE = await getSpyPE();

  // Fetch all price data
  const allTickers = new Set<string>();
  for (const def of Object.values(ASSETS)) {
    allTickers.add(def.ticker);
    for (const [pt] of def.arbPeers) allTickers.add(pt);
  }
  for (const def of Object.values(SECTORS)) allTickers.add(def.etf);
  allTickers.add("SPY");
  for (const cat of Object.values(VERIFY_TICKERS))
    for (const tk of Object.values(cat)) allTickers.add(tk);

  const allHist = new Map<string, { close: number; date: Date }[]>();
  await Promise.all(
    [...allTickers].map(async (tk) => {
      const h = await getHistory(tk, 10);
      if (h.length > 0) allHist.set(tk, h);
    })
  );

  // Layer 1: Cross-asset
  interface AssetResult { hedge: ReturnType<typeof computeHedge>; arb: ReturnType<typeof computeArb>; combined: number; weight: string; netSignal: string; fair: number; stretch: number; vsFair: number }
  const assets: Record<string, AssetResult> = {};
  const assetList: {
    key: string; name: string; ticker: string; category: string; price: number;
    hedge_score: number; arb_score: number; combined_score: number;
    m2_floor: number; m2_premium: number; activation: string;
    arb_fair_value: number; arb_premium: number; arb_signal: string;
    combined_fair: number; stretch_target: number; net_signal: string;
    signal_detail: string; vs_floor: number; vs_fair: number; weight: string;
    structural_bid: number; hedge_against: string[];
  }[] = [];

  for (const [key, def] of Object.entries(ASSETS)) {
    const hist = allHist.get(def.ticker);
    if (!hist || hist.length < 60) continue;
    const hedge = computeHedge(def, hist);
    const arb = computeArb(def, hist, allHist, spyPE);
    const weights: Record<string, [number, number]> = { commodity: [0.5, 0.5], equity: [0.3, 0.7], crypto: [0.4, 0.6], currency: [0.2, 0.8] };
    const [hw, aw] = weights[def.category] || [0.5, 0.5];
    const combined = Math.round(hedge.score * hw + arb.score * aw);
    const fair = round(hedge.m2Floor * hw + arb.fairValue * aw);
    const stretch = round(Math.max(hedge.m2Floor * 2, arb.fairValue * 1.3));
    const vsFair = round((hedge.price / fair - 1) * 100);

    let netSignal: string, weight: string;
    if (combined > 75) { netSignal = "TRIM"; weight = "underweight"; }
    else if (combined > 60) { netSignal = "HOLD"; weight = "neutral"; }
    else if (combined > 40) { netSignal = "HOLD"; weight = "neutral"; }
    else if (combined > 25) { netSignal = "ACCUMULATE"; weight = "overweight"; }
    else { netSignal = "STRONG BUY"; weight = "overweight"; }

    assets[key] = { hedge, arb, combined, weight, netSignal, fair, stretch, vsFair };
    assetList.push({
      key, name: def.name, ticker: def.ticker, category: def.category,
      price: round(hedge.price), hedge_score: hedge.score, arb_score: arb.score,
      combined_score: combined, m2_floor: hedge.m2Floor, m2_premium: hedge.m2Premium,
      activation: hedge.activation, arb_fair_value: arb.fairValue, arb_premium: arb.premium,
      arb_signal: arb.signal, combined_fair: fair, stretch_target: stretch,
      net_signal: netSignal, signal_detail: netSignal, vs_floor: hedge.m2Premium,
      vs_fair: vsFair, weight, structural_bid: def.structuralBid, hedge_against: def.hedgeAgainst,
    });
  }
  assetList.sort((a, b) => a.combined_score - b.combined_score);

  // Layer 2: Sectors
  const spyHist = allHist.get("SPY");
  const sectorList: {
    key: string; name: string; etf: string; beta_type: string; peak_phase: string;
    ret_1m: number; ret_3m: number; ret_6m: number; ret_12m: number; alpha_3m: number;
    hedge_demand: number; arb_score: number; pe: number | null; div_yield: number | null;
  }[] = [];
  if (spyHist && spyHist.length > 126) {
    const spyRet3m = retFromHist(spyHist, 63);
    for (const [key, def] of Object.entries(SECTORS)) {
      const hist = allHist.get(def.etf);
      if (!hist || hist.length < 126) continue;
      const ret1m = round(retFromHist(hist, 21));
      const ret3m = round(retFromHist(hist, 63));
      const ret6m = round(retFromHist(hist, 126));
      const ret12m = hist.length > 252 ? round(retFromHist(hist, 252)) : 0;
      const alpha3m = round(ret3m - spyRet3m);

      const spyCommon = new Map(spyHist.map((r) => [new Date(r.date).toISOString().split("T")[0], r.close]));
      const ratios: number[] = [];
      for (const r of hist) {
        const sp = spyCommon.get(new Date(r.date).toISOString().split("T")[0]);
        if (sp) ratios.push(r.close / sp);
      }
      const ratioPct = ratios.length > 100 ? Math.round(percentile(ratios, ratios[ratios.length - 1])) : 50;

      const hedgeDemand = def.betaType === "defensive"
        ? Math.max(0, Math.min(100, 50 + Math.round(alpha3m * 5)))
        : Math.max(0, Math.min(100, 50 - Math.round(alpha3m * 5)));

      sectorList.push({
        key, name: def.name, etf: def.etf, beta_type: def.betaType, peak_phase: def.peakPhase,
        ret_1m: ret1m, ret_3m: ret3m, ret_6m: ret6m, ret_12m: ret12m, alpha_3m: alpha3m,
        hedge_demand: hedgeDemand, arb_score: ratioPct, pe: null, div_yield: null,
      });
    }
  }
  sectorList.sort((a, b) => b.alpha_3m - a.alpha_3m);

  const defensives = sectorList.filter((s) => s.beta_type === "defensive");
  const cyclicals = sectorList.filter((s) => s.beta_type === "cyclical");
  const defAlpha = defensives.length ? defensives.reduce((s, x) => s + x.alpha_3m, 0) / defensives.length : 0;
  const cycAlpha = cyclicals.length ? cyclicals.reduce((s, x) => s + x.alpha_3m, 0) / cyclicals.length : 0;
  const spread = round(defAlpha - cycAlpha);

  let regime: string;
  if (spread > 5) regime = "COOLING";
  else if (spread > 2) regime = "LATE-CYCLE";
  else if (spread > -2) regime = "TRANSITION";
  else if (spread > -5) regime = "EXPANSION";
  else regime = "BOOM";

  // Verification performance data
  const verify: Record<string, { category: string; price: number; w1: number; m1: number; m3: number; ytd: number; y1: number }> = {};
  for (const [cat, tickers] of Object.entries(VERIFY_TICKERS)) {
    for (const [name, tk] of Object.entries(tickers)) {
      const hist = allHist.get(tk);
      if (!hist || hist.length < 10) continue;
      verify[name] = {
        category: cat,
        price: round(hist[hist.length - 1].close),
        w1: round(retFromHist(hist, Math.min(5, hist.length - 1))),
        m1: round(retFromHist(hist, Math.min(21, hist.length - 1))),
        m3: round(retFromHist(hist, Math.min(63, hist.length - 1))),
        ytd: round(ytdRet(hist)),
        y1: round(retFromHist(hist, Math.min(252, hist.length - 1))),
      };
    }
  }

  // Allocation
  const gs = assets.gold?.combined ?? 50;
  const ss = assets.spy?.combined ?? 50;
  const us = assets.usd?.combined ?? 50;
  const bs = assets.btc?.combined ?? 50;

  const allocation = {
    equities:    { range: ss < 40 ? "60-70%" : ss < 65 ? "45-55%" : "30-40%", score: ss, regime },
    hard_assets: { range: gs < 40 ? "20-30%" : gs < 65 ? "10-15%" : "5-10%", score: gs },
    cash_usd:    { range: us < 40 ? "15-25%" : us < 65 ? "10-15%" : "5-10%", score: us },
    crypto:      { range: bs < 40 ? "5-10%"  : bs < 65 ? "2-5%"   : "0-2%",  score: bs },
  };

  const result = {
    timestamp: new Date().toISOString(),
    assets: assetList,
    sectors: sectorList,
    regime,
    spread,
    allocation,
    reflexivity: [] as { source: string; target: string; state: string; strength: string; mechanism: string }[],
    verify: { rules: [], performance: verify },
  };

  return result;
}

// ─── utils ──────────────────────────────────────────────────
function std(arr: number[]) {
  const n = arr.length;
  if (n < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / n;
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
}

function round(v: number, d = 2) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
