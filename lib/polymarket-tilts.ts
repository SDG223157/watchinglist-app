/**
 * Polymarket overlay — read + apply per-ticker tilts to the Recipe Portfolio.
 *
 * Producer: botboard-private/scripts/polymarket_signal.py --to-db
 * Table:    polymarket_ticker_tilts (one row per (as_of_date, symbol, horizon_days))
 * Docs:     botboard-private/docs/polymarket-watchinglist-integration.md
 *
 * Shadow-mode first. Default lambda = 0 means tilts are surfaced in the UI
 * but do not change weights. Flip via env var POLYMARKET_LAMBDA once a
 * mapping has passed the BH-FDR backtest in the producer repo.
 */
import { getDb } from "./db";

export interface PolymarketTilt {
  symbol: string;
  z: number;
  z_raw: number;
  n_events: number;
  n_contributions: number;
  top_reason: string | null;
}

export type PolymarketTiltMap = Record<string, PolymarketTilt>;

/**
 * Prior-mu slope that matches scripts/portfolio_allocation.py.
 * 60 bps of annual prior-μ per composite-score point above 50.
 * The Polymarket nudge reuses this slope so one "z unit" has a
 * well-calibrated, interpretable size in return space.
 */
export const POLYMARKET_PRIOR_SLOPE = 0.006;

/**
 * Global lambda dial. Read from env so ops can flip it without a deploy.
 * Capped at 0.25 to match the producer's governance contract — no mapping
 * may ever move more than 0.25 * slope * z_cap = 4.5 bps/yr per ticker
 * of prior-μ, which then gets further diluted by the Bayesian posterior.
 *
 *   POLYMARKET_LAMBDA=0      shadow mode (default, safest)
 *   POLYMARKET_LAMBDA=0.05   first live tier after backtest promotion
 *   POLYMARKET_LAMBDA=0.25   steady-state after 60 days of clean shadow
 */
export function getPolymarketLambda(): number {
  const raw = Number(process.env.POLYMARKET_LAMBDA);
  if (!Number.isFinite(raw)) return 0;
  if (raw < 0) return 0;
  if (raw > 0.25) return 0.25;
  return raw;
}

/**
 * Load today's horizon=1 tilts from Neon. Returns an empty map on any error
 * (DB down, table missing, no rows). Never throws — the overlay is optional
 * and a failure must not break the main rebalance.
 */
export async function fetchTiltsForToday(
  horizonDays: number = 1
): Promise<PolymarketTiltMap> {
  try {
    const sql = getDb();
    const rows = (await sql`
      SELECT symbol,
             z::float        AS z,
             z_raw::float    AS z_raw,
             n_events,
             n_contributions,
             top_reason
      FROM polymarket_ticker_tilts
      WHERE as_of_date = CURRENT_DATE
        AND horizon_days = ${horizonDays}
    `) as Array<PolymarketTilt>;
    const map: PolymarketTiltMap = {};
    for (const r of rows) {
      map[r.symbol] = {
        symbol: r.symbol,
        z: Number(r.z) || 0,
        z_raw: Number(r.z_raw) || 0,
        n_events: Number(r.n_events) || 0,
        n_contributions: Number(r.n_contributions) || 0,
        top_reason: r.top_reason ?? null,
      };
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Fixture-pinned variant of fetchTiltsForToday. Production reads CURRENT_DATE;
 * tests call this with a fixed date to avoid clock dependencies.
 */
export async function fetchTiltsFor(
  date: string,
  horizonDays: number = 1
): Promise<PolymarketTiltMap> {
  try {
    const sql = getDb();
    const rows = (await sql`
      SELECT symbol,
             z::float        AS z,
             z_raw::float    AS z_raw,
             n_events,
             n_contributions,
             top_reason
      FROM polymarket_ticker_tilts
      WHERE as_of_date = ${date}::date
        AND horizon_days = ${horizonDays}
    `) as Array<PolymarketTilt>;
    const map: PolymarketTiltMap = {};
    for (const r of rows) {
      map[r.symbol] = {
        symbol: r.symbol,
        z: Number(r.z) || 0,
        z_raw: Number(r.z_raw) || 0,
        n_events: Number(r.n_events) || 0,
        n_contributions: Number(r.n_contributions) || 0,
        top_reason: r.top_reason ?? null,
      };
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Return the Δμ_prior (annualized log-return) this symbol should receive.
 * Formula mirrors scripts/portfolio_allocation.py:
 *
 *     Δμ_prior = lambda * PRIOR_SLOPE * z
 *
 * With the default lambda = 0, this is always zero — the overlay only
 * reports tilts until explicitly promoted.
 */
export function deltaMuPrior(
  tilts: PolymarketTiltMap,
  symbol: string,
  lambda: number
): number {
  const t = tilts[symbol];
  if (!t) return 0;
  return lambda * POLYMARKET_PRIOR_SLOPE * t.z;
}
