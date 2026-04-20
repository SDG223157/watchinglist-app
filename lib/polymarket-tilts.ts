/**
 * Polymarket overlay — read + apply per-ticker tilts to the Recipe Portfolio.
 *
 * Producer: botboard-private/scripts/polymarket_signal.py --to-db
 * Table:    polymarket_ticker_tilts (one row per (as_of_date, symbol, horizon_days))
 * Gov:      polymarket_mapping_lambdas_best (per-(mapping, ticker) lambda_final)
 * Docs:     botboard-private/docs/polymarket-watchinglist-integration.md
 *
 * Two z values travel with every tilt:
 *
 *   z        — unweighted aggregate across ALL matched mappings.
 *              Surfaces in the UI as the "raw" Polymarket view. Never
 *              nudges weights directly.
 *   z_live   — governance-weighted aggregate. Each contribution is
 *              multiplied by its (mapping, ticker) lambda_final before
 *              summing, so only mappings that passed BH-FDR in the
 *              producer backtest contribute. Safe to feed into blended μ.
 *
 * The app nudges prior μ by:
 *
 *     Δμ_prior = POLYMARKET_LAMBDA * PRIOR_SLOPE * z_live
 *
 * where POLYMARKET_LAMBDA is now a global kill-switch in [0, 1], not a
 * per-mapping weight. 0 = shadow (keep reading z_live but don't nudge),
 * 1 = trust the Neon governance table fully.
 */
import { getDb } from "./db";

export interface PolymarketTilt {
  symbol: string;
  /** Unweighted z (all mappings). UI only. */
  z: number;
  /** Raw (uncapped) z. UI only. */
  z_raw: number;
  /** Governance-weighted z. What actually feeds Δμ_prior. */
  z_live: number;
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
 * Global kill-switch dial. Read from env so ops can flip it without a deploy.
 * Capped at 1.0 because z_live is already per-mapping weighted in the
 * producer — this lambda is now a simple on/off multiplier, not a
 * promotion tier.
 *
 *   POLYMARKET_LAMBDA=0     shadow (default — read z_live but don't nudge)
 *   POLYMARKET_LAMBDA=0.5   half-strength (first live week)
 *   POLYMARKET_LAMBDA=1     trust governance table fully (steady state)
 */
export function getPolymarketLambda(): number {
  const raw = Number(process.env.POLYMARKET_LAMBDA);
  if (!Number.isFinite(raw)) return 0;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

function rowToTilt(r: Record<string, unknown>): PolymarketTilt {
  return {
    symbol: String(r.symbol),
    z: Number(r.z) || 0,
    z_raw: Number(r.z_raw) || 0,
    z_live: Number(r.z_live) || 0,
    n_events: Number(r.n_events) || 0,
    n_contributions: Number(r.n_contributions) || 0,
    top_reason: (r.top_reason as string | null) ?? null,
  };
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
             COALESCE(z_live, 0)::float AS z_live,
             n_events,
             n_contributions,
             top_reason
      FROM polymarket_ticker_tilts
      WHERE as_of_date = CURRENT_DATE
        AND horizon_days = ${horizonDays}
    `) as Array<Record<string, unknown>>;
    const map: PolymarketTiltMap = {};
    for (const r of rows) {
      const tilt = rowToTilt(r);
      map[tilt.symbol] = tilt;
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
             COALESCE(z_live, 0)::float AS z_live,
             n_events,
             n_contributions,
             top_reason
      FROM polymarket_ticker_tilts
      WHERE as_of_date = ${date}::date
        AND horizon_days = ${horizonDays}
    `) as Array<Record<string, unknown>>;
    const map: PolymarketTiltMap = {};
    for (const r of rows) {
      const tilt = rowToTilt(r);
      map[tilt.symbol] = tilt;
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Return the Δμ_prior (annualized log-return) this symbol should receive.
 *
 *     Δμ_prior = lambda * PRIOR_SLOPE * z_live
 *
 * z_live is already per-mapping weighted by the producer's governance
 * table; lambda is just the global kill-switch. Falls back to z = 0
 * (no nudge) for symbols not in the map.
 */
export function deltaMuPrior(
  tilts: PolymarketTiltMap,
  symbol: string,
  lambda: number
): number {
  const t = tilts[symbol];
  if (!t) return 0;
  return lambda * POLYMARKET_PRIOR_SLOPE * t.z_live;
}
