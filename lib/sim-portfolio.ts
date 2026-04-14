import { getDb } from "./db";
import type { WatchlistStock } from "./db";

export interface SimHolding {
  symbol: string;
  name: string;
  sector: string;
  shares: number;
  entry_price: number;
  current_price: number;
  weight_pct: number;
  amount: number;
  pnl: number;
  pnl_pct: number;
  composite_score: number;
  entropy_phase: number;
  phase_label: string;
  hmm_regime: string;
  green_walls: number;
}

export interface SimSnapshot {
  id: number;
  portfolio_id: string;
  snapshot_date: string;
  total_value: number;
  cash: number;
  invested: number;
  holdings_count: number;
  return_pct: number;
  cumulative_return_pct: number;
  holdings_json: string;
}

export interface SimPortfolio {
  id: string;
  name: string;
  universe: "us" | "china";
  currency: string;
  initial_capital: number;
  current_value: number;
  cash: number;
  return_pct: number;
  holdings: SimHolding[];
  last_rebalance: string;
  created_at: string;
}

export async function ensureSimTables() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS sim_portfolios (
      id VARCHAR(30) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      universe VARCHAR(10) NOT NULL,
      currency VARCHAR(5) NOT NULL DEFAULT 'USD',
      initial_capital FLOAT NOT NULL,
      current_value FLOAT NOT NULL,
      cash FLOAT NOT NULL DEFAULT 0,
      holdings_json JSONB NOT NULL DEFAULT '[]',
      last_rebalance TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS sim_snapshots (
      id SERIAL PRIMARY KEY,
      portfolio_id VARCHAR(30) NOT NULL REFERENCES sim_portfolios(id),
      snapshot_date DATE NOT NULL,
      total_value FLOAT NOT NULL,
      cash FLOAT NOT NULL,
      invested FLOAT NOT NULL,
      holdings_count INT NOT NULL,
      return_pct FLOAT NOT NULL DEFAULT 0,
      cumulative_return_pct FLOAT NOT NULL DEFAULT 0,
      holdings_json JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(portfolio_id, snapshot_date)
    )
  `;
}

const CN_SUFFIXES = [".HK", ".SS", ".SZ"];

function isChina(symbol: string): boolean {
  return CN_SUFFIXES.some((s) => symbol.toUpperCase().endsWith(s));
}

function isUS(symbol: string): boolean {
  const s = symbol.toUpperCase();
  return !isChina(s) && !s.startsWith("^") && !s.includes("-");
}

export function selectTop30(
  stocks: WatchlistStock[],
  universe: "us" | "china",
): WatchlistStock[] {
  const filtered = stocks.filter((s) => {
    if (universe === "china") return isChina(s.symbol);
    return isUS(s.symbol);
  });

  const scored = filtered
    .filter((s) => {
      const rw = s.red_walls || 0;
      return rw <= 3 && s.price > 0 && s.market_cap > 0;
    })
    .map((s) => {
      const base = s.composite_score || 0;
      const gw = s.green_walls || 0;
      const analyzed = (gw + (s.yellow_walls || 0) + (s.red_walls || 0)) > 0;
      // Analyzed stocks with walls get a boost; unanalyzed use raw composite or market-cap-based rank
      const effectiveScore = analyzed ? base + gw * 2 : (base > 0 ? base : 30);
      return { stock: s, effectiveScore };
    })
    .sort((a, b) => b.effectiveScore - a.effectiveScore)
    .map((x) => x.stock);

  return scored.slice(0, 30);
}

export function buildAllocations(
  stocks: WatchlistStock[],
  capital: number,
): SimHolding[] {
  if (stocks.length === 0) return [];

  const totalScore = stocks.reduce((s, st) => s + (st.composite_score || 50), 0);
  const holdings: SimHolding[] = [];
  let totalAllocated = 0;

  for (const st of stocks) {
    const score = st.composite_score || 50;
    const rawWeight = score / totalScore;
    const cappedWeight = Math.min(rawWeight, 0.08);
    const amount = capital * 0.95 * cappedWeight; // 5% cash reserve
    const shares = Math.floor(amount / st.price);
    const actualAmount = shares * st.price;
    totalAllocated += actualAmount;

    holdings.push({
      symbol: st.symbol,
      name: st.name || st.symbol,
      sector: st.sector || "N/A",
      shares,
      entry_price: st.price,
      current_price: st.price,
      weight_pct: 0,
      amount: actualAmount,
      pnl: 0,
      pnl_pct: 0,
      composite_score: score,
      entropy_phase: 0,
      phase_label: "NEUTRAL",
      hmm_regime: st.hmm_regime || "N/A",
      green_walls: st.green_walls || 0,
    });
  }

  for (const h of holdings) {
    h.weight_pct = totalAllocated > 0 ? (h.amount / totalAllocated) * 100 : 0;
  }

  return holdings;
}

export async function getPortfolio(id: string): Promise<SimPortfolio | null> {
  const sql = getDb();
  const rows = await sql`SELECT * FROM sim_portfolios WHERE id = ${id}`;
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    universe: r.universe as "us" | "china",
    currency: r.currency,
    initial_capital: r.initial_capital,
    current_value: r.current_value,
    cash: r.cash,
    return_pct: ((r.current_value - r.initial_capital) / r.initial_capital) * 100,
    holdings: (r.holdings_json || []) as SimHolding[],
    last_rebalance: r.last_rebalance ? String(r.last_rebalance) : "",
    created_at: String(r.created_at),
  };
}

export async function getSnapshots(portfolioId: string): Promise<SimSnapshot[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM sim_snapshots
    WHERE portfolio_id = ${portfolioId}
    ORDER BY snapshot_date ASC
  `;
  return rows as unknown as SimSnapshot[];
}

export async function createPortfolio(
  id: string,
  name: string,
  universe: "us" | "china",
  currency: string,
  capital: number,
  stocks: WatchlistStock[],
): Promise<SimPortfolio> {
  const sql = getDb();
  await ensureSimTables();

  const top30 = selectTop30(stocks, universe);
  const holdings = buildAllocations(top30, capital);
  const invested = holdings.reduce((s, h) => s + h.amount, 0);
  const cash = capital - invested;

  await sql`
    INSERT INTO sim_portfolios (id, name, universe, currency, initial_capital, current_value, cash, holdings_json, last_rebalance)
    VALUES (${id}, ${name}, ${universe}, ${currency}, ${capital}, ${capital}, ${cash}, ${JSON.stringify(holdings)}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      holdings_json = ${JSON.stringify(holdings)},
      current_value = ${capital},
      cash = ${cash},
      last_rebalance = NOW(),
      updated_at = NOW()
  `;

  const today = new Date().toISOString().split("T")[0];
  await sql`
    INSERT INTO sim_snapshots (portfolio_id, snapshot_date, total_value, cash, invested, holdings_count, return_pct, cumulative_return_pct, holdings_json)
    VALUES (${id}, ${today}, ${capital}, ${cash}, ${invested}, ${holdings.length}, 0, 0, ${JSON.stringify(holdings)})
    ON CONFLICT (portfolio_id, snapshot_date) DO UPDATE SET
      total_value = ${capital}, cash = ${cash}, invested = ${invested},
      holdings_count = ${holdings.length}, holdings_json = ${JSON.stringify(holdings)}
  `;

  return {
    id, name, universe, currency,
    initial_capital: capital,
    current_value: capital,
    cash,
    return_pct: 0,
    holdings,
    last_rebalance: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}

export async function updatePrices(
  portfolioId: string,
  latestStocks: WatchlistStock[],
): Promise<SimPortfolio | null> {
  const sql = getDb();
  const portfolio = await getPortfolio(portfolioId);
  if (!portfolio) return null;

  const priceMap = new Map(latestStocks.map((s) => [s.symbol, s]));
  let invested = 0;

  for (const h of portfolio.holdings) {
    const stock = priceMap.get(h.symbol);
    if (stock && stock.price > 0) {
      h.current_price = stock.price;
      h.composite_score = stock.composite_score || h.composite_score;
      h.hmm_regime = stock.hmm_regime || h.hmm_regime;
      h.green_walls = stock.green_walls || h.green_walls;
    }
    h.amount = h.shares * h.current_price;
    h.pnl = (h.current_price - h.entry_price) * h.shares;
    h.pnl_pct = h.entry_price > 0 ? ((h.current_price - h.entry_price) / h.entry_price) * 100 : 0;
    invested += h.amount;
  }

  const totalValue = invested + portfolio.cash;
  const returnPct = ((totalValue - portfolio.initial_capital) / portfolio.initial_capital) * 100;

  await sql`
    UPDATE sim_portfolios SET
      holdings_json = ${JSON.stringify(portfolio.holdings)},
      current_value = ${totalValue},
      updated_at = NOW()
    WHERE id = ${portfolioId}
  `;

  portfolio.current_value = totalValue;
  portfolio.return_pct = returnPct;
  return portfolio;
}

export async function takeSnapshot(portfolioId: string): Promise<void> {
  const sql = getDb();
  const portfolio = await getPortfolio(portfolioId);
  if (!portfolio) return;

  const invested = portfolio.holdings.reduce((s, h) => s + h.amount, 0);
  const cumulReturn = ((portfolio.current_value - portfolio.initial_capital) / portfolio.initial_capital) * 100;

  const prevSnapshots = await getSnapshots(portfolioId);
  const prev = prevSnapshots.length > 0 ? prevSnapshots[prevSnapshots.length - 1] : null;
  const periodReturn = prev ? ((portfolio.current_value - prev.total_value) / prev.total_value) * 100 : 0;

  const today = new Date().toISOString().split("T")[0];
  await sql`
    INSERT INTO sim_snapshots (portfolio_id, snapshot_date, total_value, cash, invested, holdings_count, return_pct, cumulative_return_pct, holdings_json)
    VALUES (${portfolioId}, ${today}, ${portfolio.current_value}, ${portfolio.cash}, ${invested}, ${portfolio.holdings.length}, ${periodReturn}, ${cumulReturn}, ${JSON.stringify(portfolio.holdings)})
    ON CONFLICT (portfolio_id, snapshot_date) DO UPDATE SET
      total_value = ${portfolio.current_value}, cash = ${portfolio.cash}, invested = ${invested},
      holdings_count = ${portfolio.holdings.length}, return_pct = ${periodReturn},
      cumulative_return_pct = ${cumulReturn}, holdings_json = ${JSON.stringify(portfolio.holdings)}
  `;
}

export async function rebalance(
  portfolioId: string,
  allStocks: WatchlistStock[],
): Promise<SimPortfolio | null> {
  const sql = getDb();
  const portfolio = await getPortfolio(portfolioId);
  if (!portfolio) return null;

  await takeSnapshot(portfolioId);

  const capital = portfolio.current_value;
  const top30 = selectTop30(allStocks, portfolio.universe);
  const holdings = buildAllocations(top30, capital);
  const invested = holdings.reduce((s, h) => s + h.amount, 0);
  const cash = capital - invested;

  await sql`
    UPDATE sim_portfolios SET
      holdings_json = ${JSON.stringify(holdings)},
      cash = ${cash},
      current_value = ${capital},
      last_rebalance = NOW(),
      updated_at = NOW()
    WHERE id = ${portfolioId}
  `;

  return {
    ...portfolio,
    holdings,
    cash,
    last_rebalance: new Date().toISOString(),
  };
}
