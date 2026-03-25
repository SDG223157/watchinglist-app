import { neon } from "@neondatabase/serverless";

export function getDb() {
  return neon(process.env.DATABASE_URL!);
}

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
  price_to_book: number;
  ev_ebitda: number;
  ev_sales: number;
  dividend_yield: number;
  roe: number;
  roic: number;
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
  altman_z_score: number;
  fcf_yield: number;
  revenue_cagr_3y: number;
  revenue_cagr_5y: number;
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
    SELECT * FROM pca_reports
    WHERE universe = ${universe}
      AND report_date = (
        SELECT MAX(report_date) FROM pca_reports WHERE universe = ${universe}
      )
    ORDER BY scope, period_weeks
  `;
  return rows as unknown as PcaReport[];
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
    SELECT * FROM pca_reports
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
