import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const YahooFinance = require("yahoo-finance2").default;
const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SP500_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

interface StockReturn {
  ticker: string;
  sector: string;
  return3m: number | null;
  return6m: number | null;
}

async function fetchSP500List(): Promise<{ symbol: string; sector: string }[]> {
  const res = await fetch(SP500_URL);
  const csv = await res.text();
  const lines = csv.trim().split("\n").slice(1);
  return lines.map((line) => {
    const parts = line.split(",");
    return { symbol: parts[0], sector: parts[3] || "Unknown" };
  });
}

const HSI_FALLBACK = [
  "00001.HK","00002.HK","00003.HK","00005.HK","00006.HK","00012.HK",
  "00016.HK","00017.HK","00027.HK","00066.HK","00101.HK","00175.HK","00241.HK",
  "00267.HK","00285.HK","00288.HK","00291.HK","00300.HK","00316.HK","00322.HK",
  "00386.HK","00388.HK","00669.HK","00688.HK","00700.HK","00728.HK",
  "00762.HK","00823.HK","00836.HK","00857.HK","00868.HK","00881.HK","00883.HK",
  "00939.HK","00941.HK","00960.HK","00968.HK","00981.HK","01038.HK","01044.HK",
  "01088.HK","01093.HK","01109.HK","01113.HK","01177.HK","01209.HK","01211.HK",
  "01299.HK","01378.HK","01398.HK","01810.HK","01876.HK","01928.HK","01929.HK",
  "01997.HK","02007.HK","02018.HK","02020.HK","02269.HK","02313.HK","02318.HK",
  "02319.HK","02331.HK","02382.HK","02388.HK","02628.HK","02688.HK","03328.HK",
  "03690.HK","03968.HK","03988.HK","06060.HK","06098.HK","06618.HK","06690.HK",
  "06862.HK","09618.HK","09626.HK","09888.HK","09961.HK","09988.HK","09999.HK",
];
const HSCE_FALLBACK = [
  "00175.HK","00267.HK","00386.HK","00688.HK","00700.HK","00762.HK","00857.HK",
  "00883.HK","00939.HK","00941.HK","00981.HK","00992.HK","01024.HK","01088.HK",
  "01093.HK","01109.HK","01211.HK","01288.HK","01378.HK","01398.HK","01658.HK",
  "01801.HK","01810.HK","02015.HK","02020.HK","02057.HK","02313.HK","02318.HK",
  "02328.HK","02382.HK","02628.HK","03328.HK","03688.HK","03968.HK","03988.HK",
  "06060.HK","06098.HK","06618.HK","06690.HK","06862.HK","09618.HK","09626.HK",
  "09688.HK","09888.HK","09961.HK","09988.HK","09999.HK",
];
const CSI300_FALLBACK = [
  "000001.SZ","000002.SZ","000063.SZ","000100.SZ","000157.SZ","000166.SZ","000301.SZ","000333.SZ","000338.SZ","000408.SZ",
  "000425.SZ","000538.SZ","000568.SZ","000596.SZ","000617.SZ","000625.SZ","000630.SZ","000651.SZ","000661.SZ","000708.SZ",
  "000725.SZ","000768.SZ","000776.SZ","000786.SZ","000792.SZ","000807.SZ","000858.SZ","000876.SZ","000895.SZ","000938.SZ",
  "000963.SZ","000975.SZ","000977.SZ","000983.SZ","000999.SZ","001391.SZ","001965.SZ","001979.SZ","002001.SZ","002027.SZ",
  "002028.SZ","002049.SZ","002050.SZ","002074.SZ","002142.SZ","002179.SZ","002230.SZ","002236.SZ","002241.SZ","002252.SZ",
  "002304.SZ","002311.SZ","002352.SZ","002371.SZ","002384.SZ","002415.SZ","002422.SZ","002459.SZ","002460.SZ","002463.SZ",
  "002466.SZ","002475.SZ","002493.SZ","002594.SZ","002600.SZ","002601.SZ","002625.SZ","002648.SZ","002709.SZ","002714.SZ",
  "002736.SZ","002916.SZ","002920.SZ","002938.SZ","003816.SZ","300014.SZ","300015.SZ","300033.SZ","300059.SZ","300122.SZ",
  "300124.SZ","300251.SZ","300274.SZ","300308.SZ","300316.SZ","300347.SZ","300394.SZ","300408.SZ","300413.SZ","300418.SZ",
  "300433.SZ","300442.SZ","300476.SZ","300498.SZ","300502.SZ","300628.SZ","300661.SZ","300750.SZ","300759.SZ","300760.SZ",
  "300782.SZ","300803.SZ","300832.SZ","300866.SZ","300896.SZ","300979.SZ","300999.SZ","301236.SZ","301269.SZ","302132.SZ",
  "600000.SS","600009.SS","600010.SS","600011.SS","600015.SS","600016.SS","600018.SS","600019.SS","600023.SS","600025.SS",
  "600026.SS","600027.SS","600028.SS","600029.SS","600030.SS","600031.SS","600036.SS","600039.SS","600048.SS","600050.SS",
  "600061.SS","600066.SS","600085.SS","600089.SS","600104.SS","600111.SS","600115.SS","600150.SS","600160.SS","600161.SS",
  "600176.SS","600183.SS","600188.SS","600196.SS","600219.SS","600233.SS","600276.SS","600309.SS","600346.SS","600362.SS",
  "600372.SS","600377.SS","600406.SS","600415.SS","600426.SS","600436.SS","600438.SS","600460.SS","600482.SS","600489.SS",
  "600515.SS","600519.SS","600522.SS","600547.SS","600570.SS","600584.SS","600585.SS","600588.SS","600600.SS","600660.SS",
  "600674.SS","600690.SS","600741.SS","600760.SS","600795.SS","600803.SS","600809.SS","600845.SS","600875.SS","600886.SS",
  "600887.SS","600893.SS","600900.SS","600905.SS","600918.SS","600919.SS","600926.SS","600930.SS","600938.SS","600941.SS",
  "600958.SS","600989.SS","600999.SS","601006.SS","601009.SS","601012.SS","601018.SS","601021.SS","601058.SS","601059.SS",
  "601066.SS","601077.SS","601088.SS","601100.SS","601111.SS","601117.SS","601127.SS","601136.SS","601138.SS","601166.SS",
  "601169.SS","601186.SS","601211.SS","601225.SS","601229.SS","601236.SS","601238.SS","601288.SS","601298.SS","601318.SS",
  "601319.SS","601328.SS","601336.SS","601360.SS","601377.SS","601390.SS","601398.SS","601456.SS","601600.SS","601601.SS",
  "601607.SS","601618.SS","601628.SS","601633.SS","601658.SS","601668.SS","601669.SS","601688.SS","601689.SS","601698.SS",
  "601728.SS","601766.SS","601788.SS","601800.SS","601808.SS","601816.SS","601818.SS","601825.SS","601838.SS","601857.SS",
  "601868.SS","601872.SS","601877.SS","601878.SS","601881.SS","601888.SS","601898.SS","601899.SS","601901.SS","601916.SS",
  "601919.SS","601939.SS","601985.SS","601988.SS","601995.SS","601998.SS","603019.SS","603195.SS","603259.SS","603260.SS",
  "603288.SS","603296.SS","603369.SS","603392.SS","603501.SS","603799.SS","603893.SS","603986.SS","603993.SS","605117.SS",
  "605499.SS","688008.SS","688009.SS","688012.SS","688036.SS","688041.SS","688047.SS","688082.SS","688111.SS","688126.SS",
  "688169.SS","688187.SS","688223.SS","688256.SS","688271.SS","688303.SS","688396.SS","688472.SS","688506.SS","688981.SS",
];

async function fetchAAStocksTickers(indexCode: string): Promise<string[]> {
  try {
    const url = `https://www.aastocks.com/en/stocks/market/index/hk-index-con.aspx?index=${indexCode}&t=3&hk=0`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    const html = await res.text();
    const matches = html.match(/title='(\d{5}\.HK)'/g) || [];
    const tickers = [...new Set(matches.map((m: string) => m.match(/(\d{5}\.HK)/)![1]))];
    if (tickers.length > 10) return tickers;
  } catch { /* fall through */ }
  return [];
}

async function fetchHKList(): Promise<string[]> {
  const [hsi, hsce] = await Promise.all([
    fetchAAStocksTickers("HSI"),
    fetchAAStocksTickers("HSCEI"),
  ]);
  if (hsi.length > 10 || hsce.length > 10) {
    return [...new Set([...hsi, ...hsce])];
  }
  return [...new Set([...HSI_FALLBACK, ...HSCE_FALLBACK])];
}

async function fetchChinaList(): Promise<{ symbol: string; sector: string }[]> {
  const hk = await fetchHKList();
  const hkSet = new Set(hk);

  const csi = CSI300_FALLBACK.filter((t) => {
    const code = t.split(".")[0];
    const hkEquiv = `0${code.slice(-4)}.HK`;
    return !hkSet.has(hkEquiv);
  });

  const all = [...hk, ...csi];
  const seen = new Set<string>();
  const result: { symbol: string; sector: string }[] = [];
  for (const s of all) {
    if (!seen.has(s)) {
      seen.add(s);
      result.push({ symbol: s, sector: "Unknown" });
    }
  }
  return result;
}

async function enrichSector(
  symbol: string
): Promise<string> {
  try {
    const q = await yahooFinance.quoteSummary(symbol, { modules: ["assetProfile"] });
    return q?.assetProfile?.sector || "Unknown";
  } catch {
    return "Unknown";
  }
}

async function fetchReturns(
  symbol: string,
  months: number
): Promise<number | null> {
  try {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);
    const hist = await yahooFinance.historical(symbol, {
      period1: start.toISOString().split("T")[0],
      period2: end.toISOString().split("T")[0],
      interval: "1mo",
    });
    if (!hist || hist.length < 2) return null;
    const first = hist[0].close;
    const last = hist[hist.length - 1].close;
    if (!first || !last) return null;
    return ((last - first) / first) * 100;
  } catch {
    return null;
  }
}

function buildSectorRotation(
  stocks: StockReturn[],
  period: "3m" | "6m",
  topN: number
) {
  const key = period === "3m" ? "return3m" : "return6m";
  const valid = stocks.filter((s) => s[key] !== null);
  valid.sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));

  const winners = new Set(valid.slice(0, topN).map((s) => s.ticker));
  const losers = new Set(valid.slice(-topN).map((s) => s.ticker));

  const sectorMap: Record<string, { winners: number; losers: number }> = {};
  for (const s of valid) {
    if (!sectorMap[s.sector])
      sectorMap[s.sector] = { winners: 0, losers: 0 };
    if (winners.has(s.ticker)) sectorMap[s.sector].winners++;
    if (losers.has(s.ticker)) sectorMap[s.sector].losers++;
  }

  return Object.entries(sectorMap)
    .map(([sector, { winners: w, losers: l }]) => ({
      sector,
      winners: w,
      losers: l,
      net: w - l,
      signal: w - l >= 3 ? "Inflow" : w - l <= -3 ? "Outflow" : "Neutral",
    }))
    .sort((a, b) => b.net - a.net);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const universe = ((body.universe as string) || "SP500").toUpperCase();
  const dbUniverse = universe === "CHINA" ? "CHINA" : "SP500";
  const label = universe === "CHINA" ? "China + HK" : "S&P 500";

  const constituents =
    universe === "CHINA" ? await fetchChinaList() : await fetchSP500List();

  const batchSize = 15;
  const results: StockReturn[] = [];
  let processed = 0;

  for (let i = 0; i < constituents.length; i += batchSize) {
    const batch = constituents.slice(i, i + batchSize);
    const promises = batch.map(async (c) => {
      const [r3, r6, sector] = await Promise.all([
        fetchReturns(c.symbol, 3),
        fetchReturns(c.symbol, 6),
        c.sector === "Unknown" ? enrichSector(c.symbol) : Promise.resolve(c.sector),
      ]);
      return { ticker: c.symbol, sector, return3m: r3, return6m: r6 };
    });
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
    processed += batch.length;
  }

  const topN = Math.max(Math.round(results.length * 0.1), 10);

  const valid6m = results.filter((s) => s.return6m !== null);
  valid6m.sort((a, b) => (b.return6m ?? 0) - (a.return6m ?? 0));
  const top6m = valid6m.slice(0, 10).map((s, i) => ({
    rank: i + 1,
    ticker: s.ticker,
    sector: s.sector,
    return: `${(s.return6m ?? 0) >= 0 ? "+" : ""}${(s.return6m ?? 0).toFixed(1)}%`,
  }));
  const bottom6m = valid6m
    .slice(-10)
    .reverse()
    .map((s, i) => ({
      rank: i + 1,
      ticker: s.ticker,
      sector: s.sector,
      return: `${(s.return6m ?? 0).toFixed(1)}%`,
    }));

  const valid3m = results.filter((s) => s.return3m !== null);
  valid3m.sort((a, b) => (b.return3m ?? 0) - (a.return3m ?? 0));
  const top3m = valid3m.slice(0, 10).map((s, i) => ({
    rank: i + 1,
    ticker: s.ticker,
    sector: s.sector,
    return: `${(s.return3m ?? 0) >= 0 ? "+" : ""}${(s.return3m ?? 0).toFixed(1)}%`,
  }));
  const bottom3m = valid3m
    .slice(-10)
    .reverse()
    .map((s, i) => ({
      rank: i + 1,
      ticker: s.ticker,
      sector: s.sector,
      return: `${(s.return3m ?? 0).toFixed(1)}%`,
    }));

  const rotation6m = buildSectorRotation(results, "6m", topN);
  const rotation3m = buildSectorRotation(results, "3m", topN);

  const today = new Date().toISOString().split("T")[0];
  const sql = getDb();
  const totalValid = valid6m.length;

  for (const period of [
    { weeks: 26, top: top6m, bottom: bottom6m, rotation: rotation6m },
    { weeks: 13, top: top3m, bottom: bottom3m, rotation: rotation3m },
  ]) {
    const md = `# Market Factor Analysis Report\n\n**Universe:** ${label}\n**Period:** ${period.weeks} weeks\n**Date:** ${today}\n**Stocks analyzed:** ${totalValid}\n\nGenerated by WatchingList web PCA runner.`;

    await sql`
      INSERT INTO pca_reports (universe, period_weeks, scope, report_date,
        report_markdown, top_performers, bottom_performers, sector_rotation,
        key_metrics, charts)
      VALUES (
        ${dbUniverse}, ${period.weeks}, 'extremes', ${today}::date,
        ${md}, ${JSON.stringify(period.top)}, ${JSON.stringify(period.bottom)},
        ${JSON.stringify(period.rotation)},
        ${JSON.stringify({ total_stocks: totalValid, period_weeks: period.weeks })},
        ${JSON.stringify({})}
      )
    `;
  }

  return NextResponse.json({
    ok: true,
    universe: label,
    stocks: processed,
    date: today,
    periods: ["3M (13W)", "6M (26W)"],
  });
}
