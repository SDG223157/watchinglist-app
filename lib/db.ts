import { neon } from "@neondatabase/serverless";
import { unstable_cache } from "next/cache";

export function getDb() {
  return neon(process.env.DATABASE_URL!);
}

/**
 * Cached DB query wrappers.
 * Pages use these for fast reads; API routes call revalidateTag()
 * after mutations to bust the cache immediately.
 */
export const getCachedStocks = unstable_cache(
  async () => fetchAllLatest(),
  ["watchlist-stocks"],
  { revalidate: 60, tags: ["stocks"] }
);

export const getCachedHeatmap = unstable_cache(
  async () => fetchAllHeatmapLatest(),
  ["heatmap-all"],
  { revalidate: 300, tags: ["heatmap"] }
);

export const getCachedHeatmapByUniverse = (universe: string, type: string) =>
  unstable_cache(
    async () => fetchHeatmap(universe, type),
    [`heatmap-${universe}-${type}`],
    { revalidate: 300, tags: ["heatmap"] }
  )();

export const getCachedHeatmapDate = (universe: string) =>
  unstable_cache(
    async () => fetchHeatmapDate(universe),
    [`heatmap-date-${universe}`],
    { revalidate: 300, tags: ["heatmap"] }
  )();

export const getCachedPcaReports = (universe: string) =>
  unstable_cache(
    async () => fetchLatestPcaReports(universe),
    [`pca-${universe}`],
    { revalidate: 300, tags: ["pca"] }
  )();

export const getCachedPcaDates = (universe: string) =>
  unstable_cache(
    async () => fetchPcaReportDates(universe),
    [`pca-dates-${universe}`],
    { revalidate: 300, tags: ["pca"] }
  )();

export interface WatchlistStock {
  id: number;
  symbol: string;
  name: string;
  market: string;
  sector: string;
  industry: string;
  price: number;
  market_cap: number;
  pe_ratio: number;
  pe_ttm: number;
  forward_pe: number;
  forward_eps: number;
  peg_ratio: number;
  price_to_book: number;
  price_to_sales: number;
  price_to_fcf: number;
  ev_ebitda: number;
  ev_sales: number;
  earnings_yield: number;
  dividend_yield: number;
  roe: number;
  roic: number;
  roa: number;
  roce: number;
  gross_margin: number;
  operating_margin: number;
  net_margin: number;
  ebitda_margin: number;
  revenue: number;
  fcf: number;
  eps: number;
  debt_to_equity: number;
  beta: number;
  high_52w: number;
  low_52w: number;
  distance_from_ath: string;
  piotroski_score: number;
  fmp_rating: string;
  fmp_rating_score: number;
  altman_z_score: number;
  owner_earnings: number;
  dcf_fair_value: number;
  dcf_levered: number;
  revenue_ttm: number;
  net_income_ttm: number;
  ebitda_ttm: number;
  fcf_ttm: number;
  total_assets: number;
  total_debt: number;
  net_debt: number;
  cash_and_equivalents: number;
  green_walls: number;
  yellow_walls: number;
  red_walls: number;
  extreme_score: number;
  clock_position: string;
  phase: string;
  corporate_stage: string;
  geometric_order: number;
  geometric_details: string;
  trend_signal: string;
  trend_entry_date: string;
  trend_entry_price: number;
  action: string;
  notes: string;
  buy_reason: string;
  narrative: string;
  narrative_cycle_history: string;
  wall_revenue: string;
  wall_margins: string;
  wall_capital: string;
  wall_discount: string;
  sector_rank: string;
  industry_rank: string;
  sector_momentum: number;
  industry_momentum: number;
  sector_3m_return: number;
  sector_6m_return: number;
  sector_12m_return: number;
  industry_3m_return: number;
  industry_6m_return: number;
  industry_12m_return: number;
  heatmap_date: string;
  analysis_report: string;
  moat_type: string;
  moat_width: string;
  moat_trend: string;
  moat_sources: string;
  composite_score: number;
  fcf_yield: number;
  shareholder_yield: number;
  revenue_cagr_3y: number;
  revenue_cagr_5y: number;
  earnings_cagr_3y: number;
  revenue_growth_annual: number;
  earnings_growth_annual: number;
  revenue_growth_ttm: number;
  revenue_growth_recent_q: number;
  earnings_growth_ttm: number;
  earnings_growth_recent_q: number;
  current_ratio: number;
  debt_to_ebitda: number;
  interest_coverage: number;
  data_sources: string;
  created_at: string;
}

export async function fetchAllLatest(): Promise<WatchlistStock[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT DISTINCT ON (symbol) *
    FROM watchlist_items
    ORDER BY symbol, created_at DESC
  `;
  return rows as unknown as WatchlistStock[];
}

export async function fetchStock(symbol: string): Promise<WatchlistStock | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM watchlist_items
    WHERE symbol = ${symbol}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return (rows[0] as unknown as WatchlistStock) ?? null;
}

export async function fetchStockHistory(
  symbol: string,
  limit = 10
): Promise<WatchlistStock[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM watchlist_items
    WHERE symbol = ${symbol}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as unknown as WatchlistStock[];
}

export interface HeatmapRow {
  id: number;
  universe: string;
  type: string;
  name: string;
  return_3m: number | null;
  return_6m: number | null;
  return_12m: number | null;
  shift: number | null;
  momentum: string | null;
  rank: number | null;
  report_date: string;
}

export async function fetchHeatmap(
  universe: string,
  type: string
): Promise<HeatmapRow[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM heatmap_data
    WHERE universe = ${universe}
      AND type = ${type}
      AND report_date = (
        SELECT MAX(report_date) FROM heatmap_data WHERE universe = ${universe}
      )
    ORDER BY
      CASE WHEN type = 'sector' THEN return_12m END DESC NULLS LAST,
      CASE WHEN type = 'industry' THEN rank END ASC NULLS LAST
  `;
  return rows as unknown as HeatmapRow[];
}

export async function fetchHeatmapDate(universe: string): Promise<string | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT MAX(report_date)::text as d FROM heatmap_data WHERE universe = ${universe}
  `;
  return (rows[0] as unknown as { d: string | null })?.d ?? null;
}

export interface PcaReport {
  id: number;
  universe: string;
  period_weeks: number;
  scope: string;
  report_date: string;
  report_markdown: string;
  top_performers: { rank: number; ticker: string; sector: string; return: string }[];
  bottom_performers: { rank: number; ticker: string; sector: string; return: string }[];
  sector_rotation: { sector: string; winners: number; losers: number; net: number; signal: string }[];
  key_metrics: Record<string, unknown>;
  charts: Record<string, string>;
  created_at: string;
}

export async function fetchLatestPcaReports(universe: string): Promise<PcaReport[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT id, universe, period_weeks, scope,
      report_date::text as report_date,
      report_markdown, top_performers, bottom_performers,
      sector_rotation, key_metrics,
      created_at::text as created_at
    FROM pca_reports
    WHERE universe = ${universe}
      AND report_date = (
        SELECT MAX(report_date) FROM pca_reports WHERE universe = ${universe}
      )
    ORDER BY scope, period_weeks
  `;
  return rows.map((r: unknown) => ({ ...(r as Record<string, unknown>), charts: {} })) as unknown as PcaReport[];
}

export async function fetchPcaReportDates(universe: string): Promise<string[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT DISTINCT report_date::text as d
    FROM pca_reports
    WHERE universe = ${universe}
    ORDER BY d DESC
    LIMIT 20
  `;
  return rows.map((r: unknown) => (r as { d: string }).d);
}

export async function fetchPcaReportsByDate(
  universe: string,
  reportDate: string
): Promise<PcaReport[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT *, report_date::text as report_date, created_at::text as created_at
    FROM pca_reports
    WHERE universe = ${universe}
      AND report_date = ${reportDate}::date
    ORDER BY scope, period_weeks
  `;
  return rows as unknown as PcaReport[];
}

export async function fetchAllHeatmapLatest(): Promise<HeatmapRow[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT h.* FROM heatmap_data h
    INNER JOIN (
      SELECT universe, MAX(report_date) as max_date
      FROM heatmap_data GROUP BY universe
    ) m ON h.universe = m.universe AND h.report_date = m.max_date
    ORDER BY h.universe, h.type, h.return_12m DESC NULLS LAST
  `;
  return rows as unknown as HeatmapRow[];
}
