import { cachedHistorical } from "./yf-cache";

export interface EtfSpec {
  ticker: string;
  name: string;
  bucket: string;
}

export interface BounceRow {
  ticker: string;
  name: string;
  bucket: string;
  troughClose: number;
  day1Close: number;
  latestClose: number;
  day1Pct: number;
  sinceDay1Pct: number;
  totalPct: number;
  dailyPct: number;
  days: number;
  latestDate: string;
  tier: "Alpha Leader" | "Beta Leader" | "Market" | "Laggard";
}

export interface BounceLeaderboard {
  market: "us" | "china";
  benchmarkTicker: string;
  benchmarkTotalPct: number;
  troughDate: string;
  day1Date: string;
  latestDate: string;
  rows: BounceRow[];
}

export interface BounceResult {
  troughDate: string;
  day1Date: string;
  detectedAutomatically: boolean;
  us?: BounceLeaderboard;
  china?: BounceLeaderboard;
  crossMarketSync?: {
    usLeader: string;
    chinaLeader: string;
    usLaggard: string;
    chinaLaggard: string;
    synchronized: boolean;
    narrative: string;
  };
  computedAt: string;
}

// US sector ETF universe
export const US_SECTORS: EtfSpec[] = [
  { ticker: "SPY",  name: "S&P 500",          bucket: "Benchmark" },
  { ticker: "QQQ",  name: "Nasdaq 100",       bucket: "Tech Broad" },
  { ticker: "IWM",  name: "Russell 2000",     bucket: "Small Cap" },
  { ticker: "SMH",  name: "Semiconductors",   bucket: "Tech-Semis" },
  { ticker: "XLK",  name: "Technology",       bucket: "Tech" },
  { ticker: "XLC",  name: "Comm Services",    bucket: "Media/Internet" },
  { ticker: "XLY",  name: "Cons Discretionary", bucket: "Consumer Cyc" },
  { ticker: "XLF",  name: "Financials",       bucket: "Financials" },
  { ticker: "XLI",  name: "Industrials",      bucket: "Industrials" },
  { ticker: "XLB",  name: "Materials",        bucket: "Materials" },
  { ticker: "XLE",  name: "Energy",           bucket: "Energy" },
  { ticker: "XLV",  name: "Healthcare",       bucket: "Healthcare" },
  { ticker: "XLP",  name: "Cons Staples",     bucket: "Defensive" },
  { ticker: "XLU",  name: "Utilities",        bucket: "Defensive" },
  { ticker: "XLRE", name: "Real Estate",      bucket: "Defensive" },
];

// China sector ETF universe (A-shares + HK)
export const CHINA_SECTORS: EtfSpec[] = [
  { ticker: "510300.SS", name: "CSI 300",             bucket: "Benchmark" },
  { ticker: "510500.SS", name: "CSI 500",             bucket: "Mid Cap" },
  { ticker: "159949.SZ", name: "ChiNext 50",          bucket: "Growth Small" },
  { ticker: "159915.SZ", name: "ChiNext ETF",         bucket: "Growth" },
  { ticker: "588200.SS", name: "STAR Chip",           bucket: "Semis" },
  { ticker: "512480.SS", name: "Semiconductor",       bucket: "Semis" },
  { ticker: "159995.SZ", name: "Chip ETF",            bucket: "Semis" },
  { ticker: "588000.SS", name: "STAR 50",             bucket: "Tech Growth" },
  { ticker: "588080.SS", name: "STAR 100",            bucket: "Tech Growth" },
  { ticker: "159819.SZ", name: "AI ETF",              bucket: "AI/Tech" },
  { ticker: "512170.SS", name: "Healthcare",          bucket: "Healthcare" },
  { ticker: "510230.SS", name: "Financials",          bucket: "Financials" },
  { ticker: "512880.SS", name: "Securities/Brokers",  bucket: "Brokers" },
  { ticker: "159928.SZ", name: "Consumer",            bucket: "Cons Staples" },
  { ticker: "512690.SS", name: "Liquor ETF",          bucket: "Baijiu Defensive" },
  { ticker: "515030.SS", name: "EV/NEV",              bucket: "Cons Cyc" },
  { ticker: "515790.SS", name: "Solar",               bucket: "Clean Energy" },
  { ticker: "512660.SS", name: "Defense",             bucket: "Defense" },
  { ticker: "512400.SS", name: "Non-ferrous Metal",   bucket: "Materials" },
  { ticker: "515220.SS", name: "Coal ETF",            bucket: "Energy" },
  { ticker: "3033.HK",   name: "Hang Seng Tech",      bucket: "HK Tech" },
  { ticker: "2800.HK",   name: "Hang Seng Index",     bucket: "HK Broad" },
  { ticker: "2828.HK",   name: "HSCEI H-shares",      bucket: "HK Financials" },
];

interface HistBar { date: Date | string; close: number | null }

function dateKey(d: Date | string): string {
  if (d instanceof Date) return d.toISOString().split("T")[0];
  return String(d).split("T")[0];
}

// Find the value closest to (but not after) the target date
function valueOnOrBefore(bars: HistBar[], target: string): { close: number; date: string } | null {
  let best: { close: number; date: string } | null = null;
  for (const bar of bars) {
    if (bar.close == null) continue;
    const k = dateKey(bar.date);
    if (k <= target) {
      if (!best || k > best.date) {
        best = { close: bar.close, date: k };
      }
    }
  }
  return best;
}

// Auto-detect trough: lowest close in last N days of SPY (or other benchmark)
export async function autoDetectTrough(benchmark = "SPY"): Promise<{ troughDate: string; day1Date: string }> {
  const period1 = new Date();
  period1.setDate(period1.getDate() - 90);
  const hist = (await cachedHistorical(benchmark, period1.toISOString().split("T")[0])) as HistBar[];
  const clean = hist.filter((b) => b.close != null) as { date: Date | string; close: number }[];

  // Focus on last 45 trading days
  const last = clean.slice(-45);
  if (last.length < 10) throw new Error("Insufficient benchmark history for auto-detect");

  // Trough = lowest close
  let minIdx = 0;
  for (let i = 1; i < last.length; i++) {
    if (last[i].close < last[minIdx].close) minIdx = i;
  }
  const trough = last[minIdx];
  const troughDate = dateKey(trough.date);

  // Day-1 = first session AFTER trough with >1% gain, else the next session
  let day1: { date: Date | string; close: number } | null = null;
  for (let i = minIdx + 1; i < last.length; i++) {
    const prev = last[i - 1].close;
    const cur = last[i].close;
    const ret = (cur - prev) / prev;
    if (ret > 0.01) {
      day1 = last[i];
      break;
    }
  }
  if (!day1 && minIdx + 1 < last.length) day1 = last[minIdx + 1];
  if (!day1) day1 = trough;

  return { troughDate, day1Date: dateKey(day1.date) };
}

function classifyTier(row: BounceRow, benchmarkDay1: number, benchmarkTotal: number): BounceRow["tier"] {
  if (row.day1Pct < 0 || row.totalPct < 0) return "Laggard";
  const dayRatio = benchmarkDay1 > 0 ? row.day1Pct / benchmarkDay1 : 0;
  const totalRatio = benchmarkTotal > 0 ? row.totalPct / benchmarkTotal : 0;
  if (dayRatio >= 1.5 || totalRatio >= 1.5) return "Alpha Leader";
  if (dayRatio >= 1.0 || totalRatio >= 1.0) return "Beta Leader";
  if (dayRatio >= 0.5 && totalRatio >= 0.5) return "Market";
  return "Laggard";
}

async function computeLeaderboard(
  universe: EtfSpec[],
  troughDate: string,
  day1Date: string,
  market: "us" | "china"
): Promise<BounceLeaderboard> {
  // Fetch 10 days before trough for safe lookup
  const start = new Date(troughDate);
  start.setDate(start.getDate() - 14);
  const startStr = start.toISOString().split("T")[0];

  const results = await Promise.allSettled(
    universe.map(async (etf) => {
      const hist = (await cachedHistorical(etf.ticker, startStr)) as HistBar[];
      if (!hist || hist.length < 2) return null;

      const troughBar = valueOnOrBefore(hist, troughDate);
      const day1Bar = valueOnOrBefore(hist, day1Date);
      const latestBar = hist
        .filter((b) => b.close != null)
        .map((b) => ({ close: b.close!, date: dateKey(b.date) }))
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .slice(-1)[0];

      if (!troughBar || !day1Bar || !latestBar) return null;

      const day1Pct = ((day1Bar.close - troughBar.close) / troughBar.close) * 100;
      const totalPct = ((latestBar.close - troughBar.close) / troughBar.close) * 100;
      const sinceDay1Pct = ((latestBar.close - day1Bar.close) / day1Bar.close) * 100;

      const troughTime = new Date(troughDate).getTime();
      const latestTime = new Date(latestBar.date).getTime();
      const days = Math.max(1, Math.round((latestTime - troughTime) / (1000 * 60 * 60 * 24)));
      const dailyPct = totalPct / days;

      const row: BounceRow = {
        ticker: etf.ticker,
        name: etf.name,
        bucket: etf.bucket,
        troughClose: troughBar.close,
        day1Close: day1Bar.close,
        latestClose: latestBar.close,
        day1Pct,
        sinceDay1Pct,
        totalPct,
        dailyPct,
        days,
        latestDate: latestBar.date,
        tier: "Market",
      };
      return row;
    })
  );

  const rows: BounceRow[] = results
    .filter((r): r is PromiseFulfilledResult<BounceRow | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((r): r is BounceRow => r !== null);

  const benchmarkTicker = market === "us" ? "SPY" : "510300.SS";
  const benchmark = rows.find((r) => r.ticker === benchmarkTicker);
  const benchmarkDay1 = benchmark?.day1Pct ?? 0;
  const benchmarkTotal = benchmark?.totalPct ?? 0;

  for (const r of rows) r.tier = classifyTier(r, benchmarkDay1, benchmarkTotal);

  rows.sort((a, b) => b.totalPct - a.totalPct);

  const latestDate = rows[0]?.latestDate ?? day1Date;

  return {
    market,
    benchmarkTicker,
    benchmarkTotalPct: benchmarkTotal,
    troughDate,
    day1Date,
    latestDate,
    rows,
  };
}

export async function runBounceAnalysis(opts: {
  troughDate?: string;
  day1Date?: string;
  market?: "us" | "china" | "both";
}): Promise<BounceResult> {
  const market = opts.market ?? "both";
  let troughDate = opts.troughDate;
  let day1Date = opts.day1Date;
  let auto = false;

  if (!troughDate || !day1Date) {
    const d = await autoDetectTrough("SPY");
    troughDate = d.troughDate;
    day1Date = d.day1Date;
    auto = true;
  }

  const result: BounceResult = {
    troughDate,
    day1Date,
    detectedAutomatically: auto,
    computedAt: new Date().toISOString(),
  };

  if (market === "us" || market === "both") {
    result.us = await computeLeaderboard(US_SECTORS, troughDate, day1Date, "us");
  }
  if (market === "china" || market === "both") {
    result.china = await computeLeaderboard(CHINA_SECTORS, troughDate, day1Date, "china");
  }

  if (result.us && result.china) {
    const usLeader = [...result.us.rows].sort((a, b) => b.totalPct - a.totalPct)[0];
    const usLaggard = [...result.us.rows].sort((a, b) => a.totalPct - b.totalPct)[0];
    const cnLeader = [...result.china.rows].sort((a, b) => b.totalPct - a.totalPct)[0];
    const cnLaggard = [...result.china.rows].sort((a, b) => a.totalPct - b.totalPct)[0];

    // Synchronized if both leaders are in the same thematic family
    const techLeader = (b: string) =>
      /tech|semi|ai|growth|star|chinext|hang seng tech/i.test(b);
    const defensiveLeader = (b: string) =>
      /defensive|staples|utilities|baijiu|healthcare/i.test(b);
    const cyclicalLeader = (b: string) =>
      /financ|energy|material|industrial|coal/i.test(b);

    let synchronized = false;
    let narrative = "Mixed / rotating";
    if (techLeader(usLeader.bucket) && techLeader(cnLeader.bucket)) {
      synchronized = true;
      narrative = "Global AI/Tech narrative reactivating — high-conviction leadership";
    } else if (cyclicalLeader(usLeader.bucket) && cyclicalLeader(cnLeader.bucket)) {
      synchronized = true;
      narrative = "Global reflation / cyclical recovery";
    } else if (defensiveLeader(usLeader.bucket) && defensiveLeader(cnLeader.bucket)) {
      synchronized = true;
      narrative = "Defensive bid — likely bear-market rally, limited durability";
    }

    result.crossMarketSync = {
      usLeader: `${usLeader.ticker} ${usLeader.name} ${usLeader.totalPct.toFixed(2)}%`,
      chinaLeader: `${cnLeader.ticker} ${cnLeader.name} ${cnLeader.totalPct.toFixed(2)}%`,
      usLaggard: `${usLaggard.ticker} ${usLaggard.name} ${usLaggard.totalPct.toFixed(2)}%`,
      chinaLaggard: `${cnLaggard.ticker} ${cnLaggard.name} ${cnLaggard.totalPct.toFixed(2)}%`,
      synchronized,
      narrative,
    };
  }

  return result;
}
