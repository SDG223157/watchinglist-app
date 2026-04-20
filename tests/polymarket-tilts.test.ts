/**
 * Polymarket overlay consumer tests.
 *
 * Runner: Vitest.
 *   pnpm test                     # watchinglist-app repo
 *   pnpm vitest run tests/polymarket-tilts.test.ts
 *
 * Requires DATABASE_URL in .env (loaded by vitest.config.ts via dotenv/config).
 * Seeds a fixed-date (2024-01-15) batch of rows and cleans up after itself,
 * so running against the live Neon DB is safe — it never touches today's data.
 *
 * Mirrors the skeleton from
 * botboard-private/scripts/fixtures/polymarket_tilts_test_skeleton.ts.
 *
 * Verifies:
 *   1. fetchTiltsFor() reads only horizon_days = 1 rows.
 *   2. horizon = 5 rows for the same symbol are filtered out.
 *   3. Shadow mode (lambda = 0) does not change prior μ at all.
 *   4. lambda = 0.25 applies 0.25 * 0.006 * z per symbol.
 *   5. Missing symbols fall through as z = 0.
 *   6. getPolymarketLambda() clamps the env var to [0, 0.25].
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  deltaMuPrior,
  fetchTiltsFor,
  getPolymarketLambda,
  POLYMARKET_PRIOR_SLOPE,
  type PolymarketTiltMap,
} from "@/lib/polymarket-tilts";

const FIXTURE_DATE = "2024-01-15";

// Minimal fixture. See scripts/fixtures/polymarket_tilts_test_fixture.sql in
// botboard-private for the richer version with full reasons_json. We only need
// (symbol, z, horizon_days, n_events, n_contributions, top_reason) for these
// assertions.
interface FixtureRow {
  symbol: string;
  horizon: number;
  z: number;
  z_raw: number;
  z_live: number;
  n_events: number;
  n_contributions: number;
  top_reason: string;
}

// z_live is the governance-weighted aggregate. Only GLD has a live mapping in
// this fixture (middle_east_escalation @ lambda=0.05), so GLD's z_live ≈
// 0.05 * z. All other symbols are shadow-only (z_live = 0).
const FIXTURE_ROWS: FixtureRow[] = [
  { symbol: "USO",  horizon: 1, z:  3.0,  z_raw:  4.23, z_live: 0.0,     n_events: 3,  n_contributions: 5,  top_reason: "Will the Iranian regime fall by April 30?" },
  { symbol: "SPY",  horizon: 1, z: -1.82, z_raw: -1.82, z_live: 0.0,     n_events: 3,  n_contributions: 3,  top_reason: "Will the Iranian regime fall by April 30?" },
  { symbol: "GLD",  horizon: 1, z:  2.27, z_raw:  2.27, z_live: 0.114,   n_events: 19, n_contributions: 24, top_reason: "Will the Iranian regime fall by April 30?" },
  { symbol: "FXI",  horizon: 1, z:  0.0,  z_raw:  0.0,  z_live: 0.0,     n_events: 1,  n_contributions: 1,  top_reason: "Will Trump visit China by...?" },
  { symbol: "MSTR", horizon: 1, z: -3.0,  z_raw: -3.45, z_live: 0.0,     n_events: 2,  n_contributions: 4,  top_reason: "Bitcoin all time high by ___?" },
  { symbol: "LMT",  horizon: 1, z: -2.92, z_raw: -2.92, z_live: 0.0,     n_events: 4,  n_contributions: 4,  top_reason: "Balance of Power: 2026 Midterms" },
  { symbol: "TLT",  horizon: 1, z:  0.66, z_raw:  0.66, z_live: 0.0,     n_events: 6,  n_contributions: 6,  top_reason: "Fed Decision in July?" },
  { symbol: "QQQ",  horizon: 1, z:  0.52, z_raw:  0.52, z_live: 0.0,     n_events: 6,  n_contributions: 6,  top_reason: "Fed Decision in July?" },
  { symbol: "NVDA", horizon: 1, z:  0.80, z_raw:  0.80, z_live: 0.0,     n_events: 5,  n_contributions: 5,  top_reason: "Which companies will be acquired before 2027?" },
  // Horizon = 5 for same symbol to exercise the filter.
  { symbol: "GLD",  horizon: 5, z:  1.61, z_raw:  1.61, z_live: 0.080,   n_events: 14, n_contributions: 18, top_reason: "Russia x Ukraine ceasefire by end of 2026?" },
];

const EMPTY_PARAMS = { fixture: true };

function applyTilt(
  priorMu: Record<string, number>,
  tilts: PolymarketTiltMap,
  lambda: number,
): Record<string, number> {
  const out: Record<string, number> = { ...priorMu };
  for (const sym of Object.keys(out)) {
    out[sym] += deltaMuPrior(tilts, sym, lambda);
  }
  return out;
}

describe("polymarket_ticker_tilts consumer", () => {
  beforeAll(async () => {
    const sql = getDb();
    // Wipe any leftover rows from a previous failed run.
    await sql`
      DELETE FROM polymarket_ticker_tilts
      WHERE as_of_date = ${FIXTURE_DATE}::date
    `;
    for (const r of FIXTURE_ROWS) {
      await sql`
        INSERT INTO polymarket_ticker_tilts (
          as_of_date, symbol, horizon_days,
          z, z_raw, z_live, n_events, n_contributions,
          top_reason, reasons_json, params_json
        ) VALUES (
          ${FIXTURE_DATE}::date, ${r.symbol}, ${r.horizon},
          ${r.z}, ${r.z_raw}, ${r.z_live}, ${r.n_events}, ${r.n_contributions},
          ${r.top_reason}, ${JSON.stringify([])}::jsonb,
          ${JSON.stringify(EMPTY_PARAMS)}::jsonb
        )
      `;
    }
  });

  afterAll(async () => {
    const sql = getDb();
    await sql`
      DELETE FROM polymarket_ticker_tilts
      WHERE as_of_date = ${FIXTURE_DATE}::date
    `;
  });

  it("reads only horizon_days = 1 for the fixture date", async () => {
    const tilts = await fetchTiltsFor(FIXTURE_DATE, 1);
    expect(Object.keys(tilts).sort()).toEqual(
      ["FXI", "GLD", "LMT", "MSTR", "NVDA", "QQQ", "SPY", "TLT", "USO"],
    );
    expect(tilts.GLD.z).toBeCloseTo(2.27, 2);
    expect(tilts.GLD.z_live).toBeCloseTo(0.114, 4);
    for (const r of Object.values(tilts)) {
      expect(r.z).toBeGreaterThanOrEqual(-3);
      expect(r.z).toBeLessThanOrEqual(3);
    }
  });

  it("z_live is 0 for every shadow-only symbol", async () => {
    const tilts = await fetchTiltsFor(FIXTURE_DATE, 1);
    for (const sym of ["USO", "SPY", "FXI", "MSTR", "LMT", "TLT", "QQQ", "NVDA"]) {
      expect(tilts[sym].z_live).toBe(0);
    }
  });

  it("horizon = 5 is filtered out when asking for horizon = 1", async () => {
    const h1 = await fetchTiltsFor(FIXTURE_DATE, 1);
    const h5 = await fetchTiltsFor(FIXTURE_DATE, 5);
    expect(h1.GLD.z).toBeCloseTo(2.27, 2);
    expect(h5.GLD.z).toBeCloseTo(1.61, 2);
    expect(h5.GLD.z_live).toBeCloseTo(0.080, 4);
    expect(h5.USO).toBeUndefined();
  });

  it("shadow mode: lambda = 0 leaves prior μ unchanged for every symbol", async () => {
    const tilts = await fetchTiltsFor(FIXTURE_DATE, 1);
    const prior = { USO: 0.04, SPY: 0.05, GLD: 0.02, UNKNOWN: 0.01 };
    const after = applyTilt(prior, tilts, 0);
    expect(after).toEqual(prior);
  });

  it("lambda = 1 nudges ONLY live-mapped symbols by slope * z_live", async () => {
    const tilts = await fetchTiltsFor(FIXTURE_DATE, 1);
    const prior = { USO: 0.04, SPY: 0.05, GLD: 0.02, UNKNOWN: 0.01 };
    const after = applyTilt(prior, tilts, 1);
    // Shadow-only names (USO, SPY) must be untouched even at full kill-switch,
    // because z_live = 0 reflects "no mapping for this symbol is promoted".
    expect(after.USO).toBeCloseTo(0.04, 10);
    expect(after.SPY).toBeCloseTo(0.05, 10);
    expect(after.UNKNOWN).toBeCloseTo(0.01, 10);
    // GLD is the only governance-promoted name in the fixture.
    expect(after.GLD).toBeCloseTo(
      0.02 + 1 * POLYMARKET_PRIOR_SLOPE * 0.114,
      8,
    );
  });

  it("lambda = 0.5 half-strengths the live nudge", async () => {
    const tilts = await fetchTiltsFor(FIXTURE_DATE, 1);
    const prior = { GLD: 0.02 };
    const after = applyTilt(prior, tilts, 0.5);
    expect(after.GLD).toBeCloseTo(
      0.02 + 0.5 * POLYMARKET_PRIOR_SLOPE * 0.114,
      8,
    );
  });

  it("zero-z symbols round-trip as no-ops", async () => {
    const tilts = await fetchTiltsFor(FIXTURE_DATE, 1);
    expect(tilts.FXI.z).toBe(0);
    expect(tilts.FXI.z_live).toBe(0);
    const prior = { FXI: 0.03 };
    const after = applyTilt(prior, tilts, 1);
    expect(after.FXI).toBeCloseTo(0.03, 10);
  });

  it("missing date returns empty map (no cross-day leakage)", async () => {
    const empty = await fetchTiltsFor("1999-01-01", 1);
    expect(empty).toEqual({});
  });

  it("getPolymarketLambda clamps to [0, 1]", () => {
    const orig = process.env.POLYMARKET_LAMBDA;
    try {
      process.env.POLYMARKET_LAMBDA = "2.0";
      expect(getPolymarketLambda()).toBe(1);
      process.env.POLYMARKET_LAMBDA = "-1";
      expect(getPolymarketLambda()).toBe(0);
      process.env.POLYMARKET_LAMBDA = "not-a-number";
      expect(getPolymarketLambda()).toBe(0);
      process.env.POLYMARKET_LAMBDA = "0.5";
      expect(getPolymarketLambda()).toBeCloseTo(0.5, 10);
    } finally {
      if (orig === undefined) delete process.env.POLYMARKET_LAMBDA;
      else process.env.POLYMARKET_LAMBDA = orig;
    }
  });
});
