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
const YFIUA_BASE = "https://yfiua.github.io/index-constituents";

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

async function fetchYfiuaIndex(
  index: string
): Promise<{ symbol: string; sector: string }[]> {
  try {
    const res = await fetch(`${YFIUA_BASE}/${index}/constituents.json`, {
      headers: { "User-Agent": "WatchingList/1.0" },
    });
    const data: { Symbol: string; Name?: string }[] = await res.json();
    return data.map((r) => ({ symbol: r.Symbol, sector: "Unknown" }));
  } catch {
    return [];
  }
}

async function fetchChinaList(): Promise<{ symbol: string; sector: string }[]> {
  const [csi, hsi, hsce] = await Promise.all([
    fetchYfiuaIndex("csi300"),
    fetchYfiuaIndex("hsi"),
    fetchYfiuaIndex("hsce"),
  ]);
  const seen = new Set<string>();
  const all: { symbol: string; sector: string }[] = [];
  for (const item of [...csi, ...hsi, ...hsce]) {
    if (!seen.has(item.symbol)) {
      seen.add(item.symbol);
      all.push(item);
    }
  }
  return all;
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
