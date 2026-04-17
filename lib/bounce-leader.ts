import { cachedHistorical } from "./yf-cache";
import { fetchEastmoneyAsYahooShape } from "./eastmoney";

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
  week1Close: number | null;       // close at trough + 5 trading days, null if not yet reached
  latestClose: number;
  day1Pct: number;                  // return from trough to Day-1
  week1Pct: number | null;          // return from trough to Week-1 (5th session)
  sinceDay1Pct: number;
  totalPct: number;
  dailyPct: number;
  days: number;
  latestDate: string;
  tier: "Alpha Leader" | "Beta Leader" | "Market" | "Laggard";
  // Agreement: whether the sector is in top-tercile by BOTH Day-1 AND Week-1 signals.
  // "BOTH" = high conviction structural winner (Day-1 fast + Week-1 stable agree)
  // "DAY1_ONLY" = fading leader (led initial but dropped out of Week-1 top)
  // "WEEK1_ONLY" = late-joiner (not Day-1 top but entered Week-1 top)
  // "NEITHER" = laggard or mid-pack
  agreement?: "BOTH" | "DAY1_ONLY" | "WEEK1_ONLY" | "NEITHER";
}

export interface BounceLeaderboard {
  market: "us" | "china" | "qdii";
  benchmarkTicker: string;
  benchmarkTotalPct: number;
  troughDate: string;
  day1Date: string;
  week1Date: string | null;     // date of 5th session after trough (null if not yet reached)
  latestDate: string;
  rows: BounceRow[];
}

export interface BounceResult {
  troughDate: string;
  day1Date: string;
  endDate?: string;        // effective cutoff date used (if set)
  daysRequested?: number;  // requested days-since-trough window (if set)
  detectedAutomatically: boolean;
  us?: BounceLeaderboard;
  china?: BounceLeaderboard;
  qdii?: BounceLeaderboard;
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

// QDII / Cross-border ETF universe — A-share listed, RMB-denominated.
// Deduplicated: one product per unique underlying. LOFs tracked via
// Eastmoney fallback (Yahoo doesn't have data for Shenzhen LOFs like
// 161125-161128, 164824, 501225). All S&P-tracked 易方达 LOFs included
// for comprehensive S&P sector coverage.
export const QDII_SECTORS: EtfSpec[] = [
  // Semis
  { ticker: "513310.SS", name: "中韩半导体 China-Korea Semi",    bucket: "Semis" },
  { ticker: "501225.SS", name: "全球芯片 Global Chip LOF",       bucket: "Semis" },

  // US Tech / Regional Tech
  { ticker: "159509.SZ", name: "纳指科技 Nasdaq Tech",           bucket: "US Tech" },
  { ticker: "161128.SZ", name: "标普信息科技 S&P Info Tech LOF", bucket: "US Tech" },
  { ticker: "513730.SS", name: "东南亚科技 SE Asia Tech",        bucket: "SE Asia Tech" },

  // US Broad — S&P, Nasdaq, Dow
  { ticker: "159941.SZ", name: "纳指ETF Nasdaq 100 (广发)",      bucket: "US Broad" },
  { ticker: "513500.SS", name: "标普500 S&P 500 ETF",            bucket: "US Broad" },
  { ticker: "161125.SZ", name: "标普500LOF S&P 500 LOF",         bucket: "US Broad" },
  { ticker: "513400.SS", name: "道琼斯 Dow Jones",               bucket: "US Value" },
  { ticker: "159577.SZ", name: "美国50 US Top 50",               bucket: "US Broad" },

  // US Sectors — all S&P sector LOFs included
  { ticker: "159518.SZ", name: "标普油气 S&P Oil & Gas",         bucket: "US Energy" },
  { ticker: "159502.SZ", name: "标普生物科技 S&P Biotech ETF",   bucket: "US Biotech" },
  { ticker: "161127.SZ", name: "标普生物科技 S&P Biotech LOF",   bucket: "US Biotech" },
  { ticker: "161126.SZ", name: "标普医疗保健 S&P Healthcare LOF", bucket: "US Healthcare" },
  { ticker: "159529.SZ", name: "标普消费 S&P Consumer",          bucket: "US Consumer" },
  { ticker: "160140.SZ", name: "美国REIT精选 US REITs LOF",      bucket: "US REITs" },

  // Commodities
  { ticker: "518880.SS", name: "黄金ETF Gold (华安)",            bucket: "Gold" },

  // Europe — one per country
  { ticker: "159561.SZ", name: "德国 Germany DAX",               bucket: "Europe" },
  { ticker: "513080.SS", name: "法国 France CAC40",              bucket: "Europe" },

  // Japan
  { ticker: "513520.SS", name: "日经 Japan Nikkei 225",          bucket: "Japan" },

  // Emerging Markets — one per country / region
  { ticker: "520870.SS", name: "巴西 Brazil IBOVESPA",           bucket: "EM Brazil" },
  { ticker: "159329.SZ", name: "沙特 Saudi FTSE",                bucket: "EM Saudi" },
  { ticker: "164824.SZ", name: "印度 India LOF",                 bucket: "EM India" },
  { ticker: "159687.SZ", name: "亚太精选 Asia-Pacific",          bucket: "Asia-Pacific" },

  // HK / China ADR — one per unique exposure
  { ticker: "513180.SS", name: "恒生科技 HS Tech (华夏)",        bucket: "HK Tech" },
  { ticker: "513050.SS", name: "中概互联网 China Internet ADR",  bucket: "China Internet" },
  { ticker: "513060.SS", name: "恒生医疗 HS Healthcare",         bucket: "HK Healthcare" },
  { ticker: "513120.SS", name: "港股创新药 HK Biotech (广发)",   bucket: "HK Biotech" },
  { ticker: "513090.SS", name: "香港证券 HK Securities",         bucket: "HK Financials" },
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

// Fetch history via Yahoo first; if insufficient and ticker is Chinese-listed,
// fall back to Eastmoney (covers LOFs Yahoo doesn't track: 161128, 501225, etc.)
async function fetchHistory(ticker: string, startStr: string): Promise<HistBar[]> {
  const yh = (await cachedHistorical(ticker, startStr)) as HistBar[];
  if (yh && yh.length >= 5) return yh;

  const isChinese = /\.(SS|SZ|SH)$/i.test(ticker);
  if (!isChinese) return yh ?? [];

  try {
    const em = await fetchEastmoneyAsYahooShape(ticker, startStr);
    if (em && em.length >= 5) return em as HistBar[];
  } catch {
    // fallback failed, return whatever Yahoo gave us
  }
  return yh ?? [];
}

async function computeLeaderboard(
  universe: EtfSpec[],
  troughDate: string,
  day1Date: string,
  market: "us" | "china" | "qdii",
  endDate?: string
): Promise<BounceLeaderboard> {
  // Fetch 10 days before trough for safe lookup
  const start = new Date(troughDate);
  start.setDate(start.getDate() - 14);
  const startStr = start.toISOString().split("T")[0];

  const results = await Promise.allSettled(
    universe.map(async (etf) => {
      const hist = await fetchHistory(etf.ticker, startStr);
      if (!hist || hist.length < 2) return null;

      const troughBar = valueOnOrBefore(hist, troughDate);
      const day1Bar = valueOnOrBefore(hist, day1Date);
      // If endDate is specified, snap to the closest trading day <= endDate.
      // Otherwise use the latest available bar.
      const latestBar = endDate
        ? valueOnOrBefore(hist, endDate)
        : hist
            .filter((b) => b.close != null)
            .map((b) => ({ close: b.close!, date: dateKey(b.date) }))
            .sort((a, b) => (a.date < b.date ? -1 : 1))
            .slice(-1)[0];

      if (!troughBar || !day1Bar || !latestBar) return null;

      // Week-1 = 5th trading session AFTER the trough (index 5 in the sorted bars).
      // Reports null if the effective cutoff is before Week-1 (still in the first 5 sessions).
      const sortedAfterTrough = hist
        .filter((b) => b.close != null)
        .map((b) => ({ close: b.close!, date: dateKey(b.date) }))
        .filter((b) => b.date >= troughBar.date)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const week1BarRaw = sortedAfterTrough.length > 5 ? sortedAfterTrough[5] : null;
      // Only accept Week-1 if it falls on or before the effective cutoff (latestBar.date)
      const week1Bar =
        week1BarRaw && week1BarRaw.date <= latestBar.date ? week1BarRaw : null;

      const day1Pct = ((day1Bar.close - troughBar.close) / troughBar.close) * 100;
      const totalPct = ((latestBar.close - troughBar.close) / troughBar.close) * 100;
      const sinceDay1Pct = ((latestBar.close - day1Bar.close) / day1Bar.close) * 100;
      const week1Pct = week1Bar
        ? ((week1Bar.close - troughBar.close) / troughBar.close) * 100
        : null;

      const troughTime = new Date(troughDate).getTime();
      const latestTime = new Date(latestBar.date).getTime();
      const days = Math.max(1, Math.round((latestTime - troughTime) / (1000 * 60 * 60 * 24)));
      const dailyPct = totalPct / days;

      const row: BounceRow & { _week1Date?: string } = {
        ticker: etf.ticker,
        name: etf.name,
        bucket: etf.bucket,
        troughClose: troughBar.close,
        day1Close: day1Bar.close,
        week1Close: week1Bar ? week1Bar.close : null,
        latestClose: latestBar.close,
        day1Pct,
        week1Pct,
        sinceDay1Pct,
        totalPct,
        dailyPct,
        days,
        latestDate: latestBar.date,
        tier: "Market",
        _week1Date: week1Bar?.date, // internal: actual 5th-session calendar date
      };
      return row;
    })
  );

  const rows: BounceRow[] = results
    .filter((r): r is PromiseFulfilledResult<BounceRow | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((r): r is BounceRow => r !== null);

  const benchmarkTicker =
    market === "us" ? "SPY" :
    market === "china" ? "510300.SS" :
    "513500.SS"; // QDII benchmark = 标普500
  const benchmark = rows.find((r) => r.ticker === benchmarkTicker);
  const benchmarkDay1 = benchmark?.day1Pct ?? 0;
  const benchmarkTotal = benchmark?.totalPct ?? 0;

  for (const r of rows) r.tier = classifyTier(r, benchmarkDay1, benchmarkTotal);

  // Compute Agreement field: top-tercile by Day-1 AND top-tercile by Week-1 → BOTH
  // This is the highest-conviction tag per the FAJ paper finding that
  // agreement between Day-1 and Week-1 signals predicts durable leadership.
  if (rows.length >= 6) {
    const tercile = Math.max(1, Math.ceil(rows.length / 3));
    const byDay1 = [...rows].sort((a, b) => b.day1Pct - a.day1Pct);
    const topDay1 = new Set(byDay1.slice(0, tercile).map((r) => r.ticker));

    const rowsWithW1 = rows.filter((r) => r.week1Pct != null);
    const byWeek1 = [...rowsWithW1].sort((a, b) => (b.week1Pct! - a.week1Pct!));
    const topWeek1 = new Set(byWeek1.slice(0, tercile).map((r) => r.ticker));

    for (const r of rows) {
      if (r.week1Pct == null) {
        // Week-1 not yet available; agreement unknown
        r.agreement = undefined;
        continue;
      }
      const inD1 = topDay1.has(r.ticker);
      const inW1 = topWeek1.has(r.ticker);
      if (inD1 && inW1) r.agreement = "BOTH";
      else if (inD1 && !inW1) r.agreement = "DAY1_ONLY";
      else if (!inD1 && inW1) r.agreement = "WEEK1_ONLY";
      else r.agreement = "NEITHER";
    }
  }

  rows.sort((a, b) => b.totalPct - a.totalPct);

  const latestDate = rows[0]?.latestDate ?? day1Date;
  // Week-1 date = actual 5th trading session after the trough, taken from
  // the most liquid reference (benchmark) or any ticker that reached it.
  const benchmarkWithW1 = rows.find((r) => r.ticker === benchmarkTicker);
  const anyWithW1 = rows.find(
    (r) => (r as BounceRow & { _week1Date?: string })._week1Date
  );
  const week1Date =
    ((benchmarkWithW1 as BounceRow & { _week1Date?: string })?._week1Date) ??
    ((anyWithW1 as BounceRow & { _week1Date?: string })?._week1Date) ??
    null;

  // Strip internal _week1Date field before returning
  for (const r of rows) {
    delete (r as BounceRow & { _week1Date?: string })._week1Date;
  }

  return {
    market,
    benchmarkTicker,
    benchmarkTotalPct: benchmarkTotal,
    troughDate,
    day1Date,
    week1Date,
    latestDate,
    rows,
  };
}

export async function runBounceAnalysis(opts: {
  troughDate?: string;
  day1Date?: string;
  endDate?: string;     // explicit YYYY-MM-DD cutoff (takes precedence over days)
  days?: number;        // N calendar days after trough — auto-computes endDate
  market?: "us" | "china" | "qdii" | "both" | "all";
}): Promise<BounceResult> {
  const market = opts.market ?? "all";
  let troughDate = opts.troughDate;
  let day1Date = opts.day1Date;
  let auto = false;

  if (!troughDate || !day1Date) {
    const d = await autoDetectTrough("SPY");
    troughDate = d.troughDate;
    day1Date = d.day1Date;
    auto = true;
  }

  // Resolve effective end date
  let endDate = opts.endDate;
  if (!endDate && typeof opts.days === "number" && opts.days > 0) {
    const t = new Date(troughDate);
    t.setDate(t.getDate() + opts.days);
    endDate = t.toISOString().split("T")[0];
  }

  const result: BounceResult = {
    troughDate,
    day1Date,
    endDate,
    daysRequested: opts.days,
    detectedAutomatically: auto,
    computedAt: new Date().toISOString(),
  };

  const includeUs = market === "us" || market === "both" || market === "all";
  const includeChina = market === "china" || market === "both" || market === "all";
  const includeQdii = market === "qdii" || market === "all";

  if (includeUs) {
    result.us = await computeLeaderboard(US_SECTORS, troughDate, day1Date, "us", endDate);
  }
  if (includeChina) {
    result.china = await computeLeaderboard(CHINA_SECTORS, troughDate, day1Date, "china", endDate);
  }
  if (includeQdii) {
    result.qdii = await computeLeaderboard(QDII_SECTORS, troughDate, day1Date, "qdii", endDate);
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
