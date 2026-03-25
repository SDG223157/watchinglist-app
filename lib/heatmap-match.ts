import type { HeatmapRow, WatchlistStock } from "./db";

const SECTOR_ALIAS: Record<string, string> = {
  "科技/互联网": "Technology",
  "消费/白酒": "Consumer Defensive",
  "tech/e-commerce": "Technology",
  "food/biotech ingredients": "Consumer Defensive",
  "consumer discretionary": "Consumer Cyclical",
  "consumer staples": "Consumer Defensive",
  "information technology": "Technology",
  "health care": "Healthcare",
  "financials": "Financial Services",
  "materials": "Basic Materials",
};

export interface StockHeatmapContext {
  sector: HeatmapRow | null;
  industry: HeatmapRow | null;
  universe: string;
}

function stockUniverse(symbol: string): string {
  if (symbol.endsWith(".HK") || symbol.endsWith(".SS") || symbol.endsWith(".SZ"))
    return "China";
  return "SP500";
}

function extractName(rankField: string | null): string | null {
  if (!rankField) return null;
  const match = rankField.match(/^(.+?)\s+3M:/);
  return match ? match[1].trim() : null;
}

function extractSectorName(stock: WatchlistStock): string | null {
  const fromRank = extractName(stock.sector_rank);
  if (fromRank) return fromRank;
  if (!stock.sector) return null;
  const parts = stock.sector.split("/");
  return parts[0].trim();
}

function extractIndustryName(stock: WatchlistStock): string | null {
  if (stock.industry) return stock.industry;
  const fromRank = extractName(stock.industry_rank);
  if (fromRank) return fromRank;
  if (!stock.sector) return null;
  const parts = stock.sector.split("/");
  return parts.length > 1 ? parts[1].trim() : null;
}

function fuzzyMatch(needle: string, haystack: HeatmapRow[]): HeatmapRow | null {
  const lower = needle.toLowerCase();

  const aliased = SECTOR_ALIAS[lower];
  if (aliased) {
    const exact = haystack.find(
      (h) => h.name.toLowerCase() === aliased.toLowerCase()
    );
    if (exact) return exact;
  }

  const exact = haystack.find((h) => h.name.toLowerCase() === lower);
  if (exact) return exact;

  const partial = haystack.find(
    (h) =>
      h.name.toLowerCase().includes(lower) ||
      lower.includes(h.name.toLowerCase())
  );
  if (partial) return partial;

  const words = lower.split(/\s+/);
  for (const w of words) {
    if (w.length < 4) continue;
    const wordMatch = haystack.find((h) =>
      h.name.toLowerCase().includes(w)
    );
    if (wordMatch) return wordMatch;
  }

  return null;
}

export function buildHeatmapLookup(
  heatmapRows: HeatmapRow[]
): Map<string, { sectors: HeatmapRow[]; industries: HeatmapRow[] }> {
  const map = new Map<
    string,
    { sectors: HeatmapRow[]; industries: HeatmapRow[] }
  >();

  for (const r of heatmapRows) {
    if (!map.has(r.universe)) {
      map.set(r.universe, { sectors: [], industries: [] });
    }
    const bucket = map.get(r.universe)!;
    if (r.type === "sector") bucket.sectors.push(r);
    else bucket.industries.push(r);
  }

  return map;
}

export function matchStock(
  stock: WatchlistStock,
  lookup: Map<string, { sectors: HeatmapRow[]; industries: HeatmapRow[] }>
): StockHeatmapContext {
  const universe = stockUniverse(stock.symbol);
  const data = lookup.get(universe);
  if (!data) return { sector: null, industry: null, universe };

  const sectorName = extractSectorName(stock);
  const industryName = extractIndustryName(stock);

  const sector = sectorName ? fuzzyMatch(sectorName, data.sectors) : null;
  const industry = industryName
    ? fuzzyMatch(industryName, data.industries)
    : null;

  return { sector, industry, universe };
}
