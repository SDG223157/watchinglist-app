import { cachedHistorical, cachedSummary } from "./yf-cache";

// Universe of stocks across quality tiers
const UNIVERSE: Record<string, string> = {
  AAPL: "Apple", MSFT: "Microsoft", NVDA: "Nvidia", GOOG: "Alphabet",
  AMZN: "Amazon", META: "Meta", COST: "Costco", WMT: "Walmart",
  V: "Visa", MA: "Mastercard", JNJ: "J&J", UNH: "UnitedHealth",
  PG: "Procter & Gamble", HD: "Home Depot", NFLX: "Netflix",
  TSLA: "Tesla", AMD: "AMD", ADBE: "Adobe", CRM: "Salesforce",
  INTC: "Intel", NKE: "Nike", DIS: "Disney", BA: "Boeing",
  PYPL: "PayPal", SNAP: "Snap", F: "Ford", T: "AT&T", VZ: "Verizon",
};

interface FactorDef { ticker: string; category: "hedge" | "arb" | "structural" }
const MACRO_FACTORS: Record<string, FactorDef> = {
  VIX:    { ticker: "^VIX",     category: "hedge" },
  DXY:    { ticker: "DX-Y.NYB", category: "hedge" },
  "10Y":  { ticker: "^TNX",     category: "arb" },
  SPY:    { ticker: "SPY",      category: "arb" },
  Oil:    { ticker: "CL=F",     category: "structural" },
  Gold:   { ticker: "GC=F",     category: "hedge" },
  TIPS:   { ticker: "TIP",      category: "hedge" },
  Credit: { ticker: "HYG",      category: "arb" },
};

const LEVEL_TICKERS = new Set(["^VIX", "^TNX"]);

async function getHistory(ticker: string, years: number) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  const rows = await cachedHistorical(ticker, d.toISOString().split("T")[0]);
  return rows.filter((r: { close?: number }) => r.close != null) as { date: Date; close: number }[];
}

function olsRegress(X: number[][], y: number[]) {
  const n = X.length, k = X[0].length;
  const XtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++)
      for (let r = 0; r < n; r++)
        XtX[i][j] += X[r][i] * X[r][j];

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
    for (let r = 0; r < n; r++)
      Xty[i] += X[r][i] * y[r];

  const betas: number[] = new Array(k).fill(0);
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++)
      betas[i] += XtXInv[i][j] * Xty[j];

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

  return { betas, tStats, r2 };
}

interface StockCrossSection {
  symbol: string;
  name: string;
  alpha10y: number;
  blueprintScore: number;
  opMargin: number;
  roic: number;
  fcfYield: number;
  revGrowth: number;
  grossMargin: number;
}

export interface CrossSectionResult {
  stocks: StockCrossSection[];
  regression: {
    r2: number;
    beta: number;
    intercept: number;
    tStat: number;
  };
  factorBetas: { name: string; beta: number; tStat: number; significant: boolean }[];
  computed_at: string;
}

async function computeAlpha(symbol: string, macroWeekly: Map<string, Map<string, number>>): Promise<number | null> {
  try {
    const hist = await getHistory(symbol, 10);
    if (hist.length < 260) return null;

    const byWeek = new Map<string, number>();
    for (const r of hist) {
      const d = new Date(r.date);
      const fri = new Date(d);
      fri.setDate(d.getDate() + (5 - d.getDay() + 7) % 7);
      byWeek.set(fri.toISOString().split("T")[0], r.close);
    }

    // Find common weeks between stock and all macro factors
    let weeks = [...byWeek.keys()].sort();
    for (const mw of macroWeekly.values()) {
      weeks = weeks.filter((w) => mw.has(w));
    }
    if (weeks.length < 100) return null;

    // Compute weekly returns
    const yRets: number[] = [];
    const factorData: number[][] = [];
    const factorTickers = Object.values(MACRO_FACTORS).map((f) => f.ticker);

    for (let i = 0; i < factorTickers.length; i++) factorData.push([]);

    for (let i = 1; i < weeks.length; i++) {
      const prevClose = byWeek.get(weeks[i - 1]);
      const currClose = byWeek.get(weeks[i]);
      if (!prevClose || !currClose || prevClose === 0) continue;
      yRets.push((currClose / prevClose - 1) * 100);

      let valid = true;
      const fRow: number[] = [];
      for (let fi = 0; fi < factorTickers.length; fi++) {
        const mw = macroWeekly.get(factorTickers[fi]);
        const prev = mw?.get(weeks[i - 1]);
        const curr = mw?.get(weeks[i]);
        if (prev == null || curr == null) { valid = false; break; }
        if (LEVEL_TICKERS.has(factorTickers[fi])) fRow.push(curr - prev);
        else if (prev === 0) fRow.push(0);
        else fRow.push((curr / prev - 1) * 100);
      }
      if (!valid) { yRets.pop(); continue; }
      for (let fi = 0; fi < fRow.length; fi++) factorData[fi].push(fRow[fi]);
    }

    if (yRets.length < 100) return null;

    const n = yRets.length;
    const X: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row = [1];
      for (const col of factorData) row.push(col[i]);
      X.push(row);
    }

    const ols = olsRegress(X, yRets);
    if (!ols) return null;

    return ols.betas[0] * 52; // annualized weekly alpha
  } catch {
    return null;
  }
}

async function fetchFundamentals(symbol: string): Promise<Partial<StockCrossSection> | null> {
  try {
    const summary = await cachedSummary(symbol, ["financialData", "defaultKeyStatistics"]) as Record<string, Record<string, number>> | null;
    if (!summary) return null;
    const fd = summary.financialData;
    const ks = summary.defaultKeyStatistics;
    if (!fd) return null;

    const opMargin = fd.operatingMargins ?? 0;
    const grossMargin = fd.grossMargins ?? 0;
    const revGrowth = fd.revenueGrowth ?? 0;
    const roic = fd.returnOnEquity ?? ks?.returnOnAssets ?? 0;
    const fcfYield = (fd.freeCashflow && fd.totalRevenue && fd.totalRevenue > 0)
      ? fd.freeCashflow / fd.totalRevenue : 0;

    let score = 0;
    if (opMargin > 0.15) score++;
    if (roic > 0.15) score++;
    if (grossMargin > 0.40) score++;
    if (fcfYield > 0.10) score++;
    if (revGrowth > 0.10) score++;
    if (opMargin > 0.25 && roic > 0.25) score++;

    return {
      opMargin: round(opMargin * 100),
      roic: round(roic * 100),
      fcfYield: round(fcfYield * 100),
      revGrowth: round(revGrowth * 100),
      grossMargin: round(grossMargin * 100),
      blueprintScore: score,
    };
  } catch {
    return null;
  }
}

function round(v: number, d = 2) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

export async function runCrossSection(): Promise<CrossSectionResult> {
  // Step 1: Fetch macro factor weekly data (10Y)
  const macroWeekly = new Map<string, Map<string, number>>();
  const factorTickers = [...new Set(Object.values(MACRO_FACTORS).map((f) => f.ticker))];

  await Promise.all(factorTickers.map(async (tk) => {
    const hist = await getHistory(tk, 10);
    const byWeek = new Map<string, number>();
    for (const r of hist) {
      const d = new Date(r.date);
      const fri = new Date(d);
      fri.setDate(d.getDate() + (5 - d.getDay() + 7) % 7);
      byWeek.set(fri.toISOString().split("T")[0], r.close);
    }
    macroWeekly.set(tk, byWeek);
  }));

  // Step 2: Compute alpha + fundamentals for each stock (batch in groups of 5)
  const stocks: StockCrossSection[] = [];
  const symbols = Object.keys(UNIVERSE);

  for (let batch = 0; batch < symbols.length; batch += 5) {
    const chunk = symbols.slice(batch, batch + 5);
    const results = await Promise.all(chunk.map(async (sym) => {
      const [alpha, fundies] = await Promise.all([
        computeAlpha(sym, macroWeekly),
        fetchFundamentals(sym),
      ]);
      if (alpha == null || !fundies) return null;
      return {
        symbol: sym,
        name: UNIVERSE[sym],
        alpha10y: round(alpha),
        blueprintScore: fundies.blueprintScore ?? 0,
        opMargin: fundies.opMargin ?? 0,
        roic: fundies.roic ?? 0,
        fcfYield: fundies.fcfYield ?? 0,
        revGrowth: fundies.revGrowth ?? 0,
        grossMargin: fundies.grossMargin ?? 0,
      };
    }));
    for (const r of results) if (r) stocks.push(r);
  }

  stocks.sort((a, b) => b.alpha10y - a.alpha10y);

  // Step 3: Cross-sectional regression — Alpha = a + b * BlueprintScore
  const n = stocks.length;
  const X: number[][] = stocks.map((s) => [1, s.blueprintScore]);
  const y = stocks.map((s) => s.alpha10y);

  let regression = { r2: 0, beta: 0, intercept: 0, tStat: 0 };
  if (n >= 5) {
    const ols = olsRegress(X, y);
    if (ols) {
      regression = {
        r2: round(ols.r2, 4),
        intercept: round(ols.betas[0], 4),
        beta: round(ols.betas[1], 4),
        tStat: round(ols.tStats[1]),
      };
    }
  }

  // Step 4: Multi-factor regression — Alpha = a + b1*OpMargin + b2*ROIC + b3*FCFYield + b4*RevGrowth
  const factorNames = ["OpMargin", "ROIC", "FCFYield", "RevGrowth"];
  const Xm: number[][] = stocks.map((s) => [1, s.opMargin, s.roic, s.fcfYield, s.revGrowth]);
  let factorBetas: { name: string; beta: number; tStat: number; significant: boolean }[] = [];
  if (n >= 8) {
    const olsM = olsRegress(Xm, y);
    if (olsM) {
      factorBetas = factorNames.map((name, i) => ({
        name,
        beta: round(olsM.betas[i + 1], 4),
        tStat: round(olsM.tStats[i + 1]),
        significant: Math.abs(olsM.tStats[i + 1]) > 1.96,
      }));
    }
  }

  return {
    stocks,
    regression,
    factorBetas,
    computed_at: new Date().toISOString(),
  };
}
