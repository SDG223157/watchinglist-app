/**
 * Single-stock 4-layer macro analysis.
 *
 * Layer 1: Hedge Floor / Arb Fair Value (M2-adjusted baseline + peer ratios)
 * Layer 2: Factor Regression (APT-style: VIX, DXY, 10Y, SPY, Oil, Gold, TIPS, HYG)
 * Layer 3: Sector Context (defensive/cyclical spread, sector momentum)
 * Layer 4: Blueprint Score (fundamentals → quality score + macro-adjusted alpha)
 */

import { cachedHistorical, cachedSummary, yahooFinance } from "./yf-cache";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const M2_FALLBACK: Record<number, number> = {
  2006: 6.8, 2007: 7.4, 2008: 7.8, 2009: 8.4, 2010: 8.8,
  2011: 9.6, 2012: 10.4, 2013: 10.9, 2014: 11.4, 2015: 12.0,
  2016: 12.9, 2017: 13.7, 2018: 14.3, 2019: 15.3, 2020: 19.1,
  2021: 21.6, 2022: 21.4, 2023: 20.9, 2024: 21.2, 2025: 22.0,
  2026: 22.5,
};

function loadM2(): Record<number, number> {
  try {
    const p = join(process.cwd(), ".m2_cache.json");
    if (existsSync(p)) {
      const cache = JSON.parse(readFileSync(p, "utf-8"));
      if (Date.now() - (cache.ts ?? 0) < 30 * 86400 * 1000) {
        const out: Record<number, number> = {};
        for (const [k, v] of Object.entries(cache.data)) out[parseInt(k)] = v as number;
        return out;
      }
    }
  } catch { /* use fallback */ }
  return M2_FALLBACK;
}

const M2 = loadM2();
const M2_CURRENT = M2[Math.max(...Object.keys(M2).map(Number))];
const M2_BASELINE = M2[2019];

// ─── Factor definitions ──────────────────────────────────────

interface FactorDef { ticker: string; category: "hedge" | "arb" | "structural"; desc: string }

const FACTORS: Record<string, FactorDef> = {
  VIX:    { ticker: "^VIX",     category: "hedge",      desc: "Fear / implied volatility" },
  DXY:    { ticker: "DX-Y.NYB", category: "hedge",      desc: "Dollar strength" },
  "10Y":  { ticker: "^TNX",     category: "arb",        desc: "Treasury yield" },
  SPY:    { ticker: "SPY",      category: "arb",        desc: "Equity market beta" },
  Oil:    { ticker: "CL=F",     category: "structural", desc: "Energy / inflation" },
  Gold:   { ticker: "GC=F",     category: "hedge",      desc: "Monetary debasement hedge" },
  TIPS:   { ticker: "TIP",      category: "hedge",      desc: "Real rate proxy" },
  Credit: { ticker: "HYG",      category: "arb",        desc: "Credit spread / risk appetite" },
};

const LEVEL_TICKERS = new Set(["^VIX", "^TNX"]);

const SECTOR_MAP: Record<string, { name: string; etf: string; betaType: "defensive" | "cyclical" }> = {
  "Technology":           { name: "Technology",        etf: "XLK",  betaType: "cyclical" },
  "Communication Services": { name: "Comm Services",  etf: "XLC",  betaType: "cyclical" },
  "Consumer Cyclical":    { name: "Consumer Disc.",    etf: "XLY",  betaType: "cyclical" },
  "Consumer Defensive":   { name: "Consumer Staples",  etf: "XLP",  betaType: "defensive" },
  "Financial Services":   { name: "Financials",        etf: "XLF",  betaType: "cyclical" },
  "Healthcare":           { name: "Healthcare",        etf: "XLV",  betaType: "defensive" },
  "Industrials":          { name: "Industrials",       etf: "XLI",  betaType: "cyclical" },
  "Energy":               { name: "Energy",            etf: "XLE",  betaType: "cyclical" },
  "Basic Materials":      { name: "Materials",         etf: "XLB",  betaType: "cyclical" },
  "Real Estate":          { name: "Real Estate",       etf: "XLRE", betaType: "defensive" },
  "Utilities":            { name: "Utilities",         etf: "XLU",  betaType: "defensive" },
};

const ALL_SECTOR_ETFS = [
  { etf: "XLK", name: "Technology",     betaType: "cyclical" as const },
  { etf: "XLC", name: "Comm Services",  betaType: "cyclical" as const },
  { etf: "XLY", name: "Consumer Disc.", betaType: "cyclical" as const },
  { etf: "XLF", name: "Financials",     betaType: "cyclical" as const },
  { etf: "XLI", name: "Industrials",    betaType: "cyclical" as const },
  { etf: "XLE", name: "Energy",         betaType: "cyclical" as const },
  { etf: "XLB", name: "Materials",      betaType: "cyclical" as const },
  { etf: "XLP", name: "Staples",        betaType: "defensive" as const },
  { etf: "XLV", name: "Healthcare",     betaType: "defensive" as const },
  { etf: "XLRE", name: "Real Estate",   betaType: "defensive" as const },
  { etf: "XLU", name: "Utilities",      betaType: "defensive" as const },
];

// ─── Helpers ─────────────────────────────────────────────────

async function getHistory(ticker: string, years = 3) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  const rows = await cachedHistorical(ticker, d.toISOString().split("T")[0]);
  return rows.filter((r: { close?: number }) => r.close != null) as { date: Date; close: number }[];
}

function round(v: number, d = 2) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function toWeekly(hist: { date: Date; close: number }[]): Map<string, number> {
  const byWeek = new Map<string, number>();
  for (const r of hist) {
    const d = new Date(r.date);
    const fri = new Date(d);
    fri.setDate(d.getDate() + (5 - d.getDay() + 7) % 7);
    byWeek.set(fri.toISOString().split("T")[0], r.close);
  }
  return byWeek;
}

function olsRegress(X: number[][], y: number[]) {
  const n = X.length, k = X[0].length;
  const XtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++)
      for (let r = 0; r < n; r++) XtX[i][j] += X[r][i] * X[r][j];

  const aug: number[][] = XtX.map((row, i) => {
    const r = [...row];
    for (let j = 0; j < k; j++) r.push(i === j ? 1 : 0);
    return r;
  });
  for (let col = 0; col < k; col++) {
    let maxRow = col;
    for (let row = col + 1; row < k; row++)
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) return null;
    for (let j = 0; j < 2 * k; j++) aug[col][j] /= pivot;
    for (let row = 0; row < k; row++) {
      if (row === col) continue;
      const f = aug[row][col];
      for (let j = 0; j < 2 * k; j++) aug[row][j] -= f * aug[col][j];
    }
  }
  const XtXInv = aug.map((row) => row.slice(k));

  const Xty: number[] = new Array(k).fill(0);
  for (let i = 0; i < k; i++)
    for (let r = 0; r < n; r++) Xty[i] += X[r][i] * y[r];

  const betas: number[] = new Array(k).fill(0);
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++) betas[i] += XtXInv[i][j] * Xty[j];

  const yHat = X.map((row) => row.reduce((s, v, idx) => s + v * betas[idx], 0));
  const resid = y.map((v, i) => v - yHat[i]);
  const ssRes = resid.reduce((s, v) => s + v * v, 0);
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const sigma2 = n > k ? ssRes / (n - k) : 1e-10;
  const tStats = betas.map((b, i) => {
    const se = Math.sqrt(Math.max(0, XtXInv[i][i] * sigma2));
    return se > 0 ? b / se : 0;
  });

  return { betas, tStats, r2, yMean };
}

// ─── Layer 1: Hedge Floor / Arb Fair Value ───────────────────

interface Layer1Result {
  price: number;
  m2Floor: number;
  m2Premium: number;
  activation: string;
  arbFairValue: number;
  arbPremium: number;
  arbSignal: string;
  combinedFair: number;
  vsFair: number;
  netSignal: string;
}

async function computeLayer1(
  symbol: string,
  stockHist: { date: Date; close: number }[]
): Promise<Layer1Result> {
  const price = stockHist[stockHist.length - 1].close;

  // M2 hedge floor: what would this stock be worth if it tracked monetary debasement?
  const baselineIdx = stockHist.findIndex(r => new Date(r.date).getFullYear() >= 2019);
  const baselinePrice = baselineIdx >= 0 ? stockHist[baselineIdx].close : stockHist[0].close;
  const m2Floor = round(baselinePrice * (M2_CURRENT / M2_BASELINE));
  const m2Premium = round((price / m2Floor - 1) * 100);

  let activation = "WARMING";
  if (m2Premium < -10) activation = "DORMANT";
  else if (m2Premium < 20) activation = "WARMING";
  else if (m2Premium < 50) activation = "ACTIVE";
  else if (m2Premium < 100) activation = "HOT";
  else activation = "EXTREME";

  // Arb fair value: compare stock/SPY ratio to 3-year historical average
  const spyHist = await getHistory("SPY", 3);
  const spyMap = new Map(spyHist.map(r => [new Date(r.date).toISOString().split("T")[0], r.close]));
  const common: { stock: number; spy: number }[] = [];
  for (const r of stockHist) {
    const dk = new Date(r.date).toISOString().split("T")[0];
    const sp = spyMap.get(dk);
    if (sp) common.push({ stock: r.close, spy: sp });
  }

  let arbFairValue = price;
  let arbPremium = 0;
  let arbSignal = "N/A";
  if (common.length >= 100) {
    const ratios = common.map(c => c.stock / c.spy);
    const meanRatio = ratios.reduce((s, v) => s + v, 0) / ratios.length;
    const currentSpy = spyHist[spyHist.length - 1].close;
    arbFairValue = round(meanRatio * currentSpy);
    arbPremium = round((price / arbFairValue - 1) * 100);

    const currentRatio = ratios[ratios.length - 1];
    const pct = ratios.filter(v => v < currentRatio).length / ratios.length * 100;
    if (pct > 80) arbSignal = "RICH";
    else if (pct > 60) arbSignal = "ABOVE AVG";
    else if (pct > 40) arbSignal = "FAIR";
    else if (pct > 20) arbSignal = "BELOW AVG";
    else arbSignal = "CHEAP";
  }

  const combinedFair = round((m2Floor + arbFairValue) / 2);
  const vsFair = round((price / combinedFair - 1) * 100);

  let netSignal: string;
  if (vsFair > 30) netSignal = "TRIM";
  else if (vsFair > 10) netSignal = "HOLD";
  else if (vsFair > -10) netSignal = "FAIR";
  else if (vsFair > -25) netSignal = "ACCUMULATE";
  else netSignal = "STRONG BUY";

  return {
    price: round(price), m2Floor, m2Premium, activation,
    arbFairValue, arbPremium, arbSignal,
    combinedFair, vsFair, netSignal,
  };
}

// ─── Layer 2: Factor Regression ──────────────────────────────

export interface FactorResult {
  name: string;
  category: string;
  beta: number;
  tStat: number;
  significant: boolean;
  desc: string;
}

interface Layer2Result {
  nObs: number;
  alpha: number;
  r2: number;
  r2Oos: number | null;
  hedgeR2: number;
  arbR2: number;
  structuralR2: number;
  factors: FactorResult[];
}

async function computeLayer2(
  symbol: string,
  stockWeekly: Map<string, number>
): Promise<Layer2Result | null> {
  const factorWeekly = new Map<string, Map<string, number>>();
  await Promise.all(
    Object.entries(FACTORS).map(async ([, fdef]) => {
      if (factorWeekly.has(fdef.ticker)) return;
      const hist = await getHistory(fdef.ticker, 3);
      factorWeekly.set(fdef.ticker, toWeekly(hist));
    })
  );

  // Find common weeks
  let weeks = [...stockWeekly.keys()].sort();
  for (const fw of factorWeekly.values()) {
    weeks = weeks.filter(w => fw.has(w));
  }
  if (weeks.length < 50) return null;

  // Compute weekly returns
  const yRets: number[] = [];
  const factorNames: string[] = [];
  const factorCats: string[] = [];
  const factorDescs: string[] = [];
  const factorCols: number[][] = [];

  for (const [fname, fdef] of Object.entries(FACTORS)) {
    factorNames.push(fname);
    factorCats.push(fdef.category);
    factorDescs.push(fdef.desc);
    factorCols.push([]);
  }

  for (let i = 1; i < weeks.length; i++) {
    const prevS = stockWeekly.get(weeks[i - 1]);
    const currS = stockWeekly.get(weeks[i]);
    if (!prevS || !currS || prevS === 0) continue;
    yRets.push((currS / prevS - 1) * 100);

    let valid = true;
    const fRow: number[] = [];
    for (const [, fdef] of Object.entries(FACTORS)) {
      const fw = factorWeekly.get(fdef.ticker);
      const prev = fw?.get(weeks[i - 1]);
      const curr = fw?.get(weeks[i]);
      if (prev == null || curr == null) { valid = false; break; }
      if (LEVEL_TICKERS.has(fdef.ticker)) fRow.push(curr - prev);
      else if (prev === 0) fRow.push(0);
      else fRow.push((curr / prev - 1) * 100);
    }
    if (!valid) { yRets.pop(); continue; }
    for (let fi = 0; fi < fRow.length; fi++) factorCols[fi].push(fRow[fi]);
  }

  const nObs = yRets.length;
  if (nObs < 50) return null;

  // Orthogonalize non-SPY factors against SPY (Frisch-Waugh-Lovell)
  const spyIdx = factorNames.indexOf("SPY");
  const spyCol = spyIdx >= 0 ? factorCols[spyIdx] : null;
  const orthCols: number[][] = [];
  for (let i = 0; i < factorCols.length; i++) {
    if (i === spyIdx || !spyCol) {
      orthCols.push(factorCols[i]);
      continue;
    }
    const X = spyCol.map((v, j) => [1, v]);
    const reg = olsRegress(X, factorCols[i]);
    if (!reg) { orthCols.push(factorCols[i]); continue; }
    orthCols.push(factorCols[i].map((v, j) => v - (reg.betas[0] + reg.betas[1] * spyCol[j])));
  }

  const X: number[][] = [];
  for (let i = 0; i < nObs; i++) {
    const row = [1];
    for (const col of orthCols) row.push(col[i]);
    X.push(row);
  }

  const ols = olsRegress(X, yRets);
  if (!ols) return null;

  const { betas, tStats, r2, yMean } = ols;

  // R² decomposition by category
  let hedgeR2 = 0, arbR2 = 0, structR2 = 0;
  const ssTot = yRets.reduce((s, v) => s + (v - yMean) ** 2, 0);
  if (ssTot > 0) {
    for (let i = 0; i < factorNames.length; i++) {
      const contribution = betas[i + 1] * orthCols[i].reduce((s, v, j) => s + v * (yRets[j] - yMean), 0);
      const pctContrib = Math.max(0, contribution / ssTot) * r2;
      if (factorCats[i] === "hedge") hedgeR2 += pctContrib;
      else if (factorCats[i] === "arb") arbR2 += pctContrib;
      else structR2 += pctContrib;
    }
    const totalDecomp = hedgeR2 + arbR2 + structR2;
    if (totalDecomp > 0) {
      const scale = r2 / totalDecomp;
      hedgeR2 *= scale; arbR2 *= scale; structR2 *= scale;
    }
  }

  // OOS validation
  let r2Oos: number | null = null;
  const trainN = Math.floor(nObs * 0.67);
  const testN = nObs - trainN;
  if (testN > 10) {
    const olsTrain = olsRegress(X.slice(0, trainN), yRets.slice(0, trainN));
    if (olsTrain) {
      const yTest = yRets.slice(trainN);
      const yPred = X.slice(trainN).map(row => row.reduce((s, v, i) => s + v * olsTrain.betas[i], 0));
      const ssResOos = yTest.reduce((s, v, i) => s + (v - yPred[i]) ** 2, 0);
      const yTestMean = yTest.reduce((s, v) => s + v, 0) / testN;
      const ssTotOos = yTest.reduce((s, v) => s + (v - yTestMean) ** 2, 0);
      r2Oos = ssTotOos > 0 ? round(1 - ssResOos / ssTotOos, 4) : 0;
    }
  }

  const factors: FactorResult[] = factorNames.map((name, i) => ({
    name,
    category: factorCats[i],
    beta: round(betas[i + 1], 4),
    tStat: round(tStats[i + 1]),
    significant: Math.abs(tStats[i + 1]) > 1.96,
    desc: factorDescs[i],
  })).sort((a, b) => Math.abs(b.tStat) - Math.abs(a.tStat));

  return {
    nObs, alpha: round(betas[0], 4),
    r2: round(r2, 4), r2Oos,
    hedgeR2: round(hedgeR2, 4), arbR2: round(arbR2, 4), structuralR2: round(structR2, 4),
    factors,
  };
}

// ─── Layer 3: Sector Context ─────────────────────────────────

interface SectorItem {
  name: string;
  etf: string;
  betaType: string;
  ret3m: number;
  ret6m: number;
  alpha3m: number;
  isStock: boolean;
}

interface Layer3Result {
  stockSector: string;
  stockSectorEtf: string;
  stockBetaType: string;
  defCycSpread: number;
  regime: string;
  sectors: SectorItem[];
}

async function computeLayer3(sector: string): Promise<Layer3Result | null> {
  const sectorInfo = SECTOR_MAP[sector];
  if (!sectorInfo) return null;

  const spyHist = await getHistory("SPY", 1);
  if (spyHist.length < 126) return null;

  const retFromHist = (hist: { close: number }[], days: number) => {
    if (hist.length <= days) return 0;
    return (hist[hist.length - 1].close / hist[hist.length - 1 - days].close - 1) * 100;
  };
  const spyRet3m = retFromHist(spyHist, 63);

  const sectors: SectorItem[] = [];
  await Promise.all(ALL_SECTOR_ETFS.map(async (s) => {
    const hist = await getHistory(s.etf, 1);
    if (hist.length < 126) return;
    const ret3m = round(retFromHist(hist, 63));
    const ret6m = round(retFromHist(hist, 126));
    const alpha3m = round(ret3m - spyRet3m);
    sectors.push({
      name: s.name, etf: s.etf, betaType: s.betaType,
      ret3m, ret6m, alpha3m, isStock: s.etf === sectorInfo.etf,
    });
  }));

  sectors.sort((a, b) => b.alpha3m - a.alpha3m);

  const defensives = sectors.filter(s => s.betaType === "defensive");
  const cyclicals = sectors.filter(s => s.betaType === "cyclical");
  const defAlpha = defensives.length ? defensives.reduce((s, x) => s + x.alpha3m, 0) / defensives.length : 0;
  const cycAlpha = cyclicals.length ? cyclicals.reduce((s, x) => s + x.alpha3m, 0) / cyclicals.length : 0;
  const spread = round(defAlpha - cycAlpha);

  let regime: string;
  if (spread > 5) regime = "COOLING";
  else if (spread > 2) regime = "LATE-CYCLE";
  else if (spread > -2) regime = "TRANSITION";
  else if (spread > -5) regime = "EXPANSION";
  else regime = "BOOM";

  return {
    stockSector: sectorInfo.name,
    stockSectorEtf: sectorInfo.etf,
    stockBetaType: sectorInfo.betaType,
    defCycSpread: spread,
    regime,
    sectors,
  };
}

// ─── Layer 4: Blueprint Score ────────────────────────────────

interface Layer4Result {
  alpha10y: number | null;
  blueprintScore: number;
  opMargin: number;
  grossMargin: number;
  roic: number;
  fcfYield: number;
  revGrowth: number;
  details: string[];
}

async function computeLayer4(
  symbol: string,
  stockWeekly: Map<string, number>
): Promise<Layer4Result> {
  // Fundamentals via Yahoo Finance
  let opMargin = 0, grossMargin = 0, roic = 0, fcfYield = 0, revGrowth = 0;
  const details: string[] = [];
  try {
    const summary = await cachedSummary(symbol, ["financialData", "defaultKeyStatistics"]) as Record<string, Record<string, number>> | null;
    if (summary) {
      const fd = summary.financialData;
      const ks = summary.defaultKeyStatistics;
      if (fd) {
        opMargin = fd.operatingMargins ?? 0;
        grossMargin = fd.grossMargins ?? 0;
        revGrowth = fd.revenueGrowth ?? 0;
        roic = fd.returnOnEquity ?? ks?.returnOnAssets ?? 0;
        fcfYield = (fd.freeCashflow && fd.totalRevenue && fd.totalRevenue > 0)
          ? fd.freeCashflow / fd.totalRevenue : 0;
      }
    }
  } catch { /* fundamentals unavailable */ }

  let score = 0;
  if (opMargin > 0.15) { score++; details.push("OpMargin > 15%"); }
  if (roic > 0.15) { score++; details.push("ROIC > 15%"); }
  if (grossMargin > 0.40) { score++; details.push("Gross Margin > 40%"); }
  if (fcfYield > 0.10) { score++; details.push("FCF/Revenue > 10%"); }
  if (revGrowth > 0.10) { score++; details.push("Rev Growth > 10%"); }
  if (opMargin > 0.25 && roic > 0.25) { score++; details.push("Elite profitability (OpM>25% + ROIC>25%)"); }

  // 10Y macro-adjusted alpha
  let alpha10y: number | null = null;
  try {
    const factorWeekly = new Map<string, Map<string, number>>();
    await Promise.all(
      Object.values(FACTORS).map(async (fdef) => {
        if (factorWeekly.has(fdef.ticker)) return;
        const hist = await getHistory(fdef.ticker, 10);
        factorWeekly.set(fdef.ticker, toWeekly(hist));
      })
    );

    const longHist = await getHistory(symbol, 10);
    const longWeekly = toWeekly(longHist);

    let weeks = [...longWeekly.keys()].sort();
    for (const fw of factorWeekly.values()) {
      weeks = weeks.filter(w => fw.has(w));
    }

    if (weeks.length >= 200) {
      const yRets: number[] = [];
      const fData: number[][] = Object.values(FACTORS).map(() => []);

      for (let i = 1; i < weeks.length; i++) {
        const prev = longWeekly.get(weeks[i - 1]);
        const curr = longWeekly.get(weeks[i]);
        if (!prev || !curr || prev === 0) continue;
        yRets.push((curr / prev - 1) * 100);

        let valid = true;
        const fRow: number[] = [];
        for (const fdef of Object.values(FACTORS)) {
          const fw = factorWeekly.get(fdef.ticker);
          const p = fw?.get(weeks[i - 1]);
          const c = fw?.get(weeks[i]);
          if (p == null || c == null) { valid = false; break; }
          if (LEVEL_TICKERS.has(fdef.ticker)) fRow.push(c - p);
          else if (p === 0) fRow.push(0);
          else fRow.push((c / p - 1) * 100);
        }
        if (!valid) { yRets.pop(); continue; }
        fRow.forEach((v, fi) => fData[fi].push(v));
      }

      if (yRets.length >= 200) {
        const n = yRets.length;
        const X: number[][] = [];
        for (let i = 0; i < n; i++) {
          const row = [1];
          for (const col of fData) row.push(col[i]);
          X.push(row);
        }
        const ols = olsRegress(X, yRets);
        if (ols) alpha10y = round(ols.betas[0] * 52);
      }
    }
  } catch { /* alpha computation failed */ }

  return {
    alpha10y,
    blueprintScore: score,
    opMargin: round(opMargin * 100),
    grossMargin: round(grossMargin * 100),
    roic: round(roic * 100),
    fcfYield: round(fcfYield * 100),
    revGrowth: round(revGrowth * 100),
    details,
  };
}

// ─── Public API ──────────────────────────────────────────────

export interface StockMacroResult {
  symbol: string;
  name: string;
  sector: string;
  layer1: Layer1Result;
  layer2: Layer2Result | null;
  layer3: Layer3Result | null;
  layer4: Layer4Result;
  computed_at: string;
}

export async function analyzeStockMacro(symbol: string): Promise<StockMacroResult> {
  const sym = symbol.toUpperCase();

  // Get stock info for name and sector
  let name = sym;
  let sector = "";
  try {
    const q = await yahooFinance.quote(sym);
    name = q?.shortName ?? q?.longName ?? sym;
    sector = q?.sector ?? "";
  } catch { /* keep defaults */ }

  // Fetch 3Y history for main analysis, plus weekly conversion
  const stockHist = await getHistory(sym, 3);
  if (stockHist.length < 60) {
    throw new Error(`Insufficient price history for ${sym} (need 60+ days, got ${stockHist.length})`);
  }
  const stockWeekly = toWeekly(stockHist);

  // Run all 4 layers in parallel
  const [layer1, layer2, layer3, layer4] = await Promise.all([
    computeLayer1(sym, stockHist),
    computeLayer2(sym, stockWeekly),
    computeLayer3(sector),
    computeLayer4(sym, stockWeekly),
  ]);

  return {
    symbol: sym, name, sector,
    layer1, layer2, layer3, layer4,
    computed_at: new Date().toISOString(),
  };
}
