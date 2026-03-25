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
  revenue_growth_ttm: number;
  revenue_growth_recent_q: number;
  earnings_growth_ttm: number;
  earnings_growth_recent_q: number;
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
