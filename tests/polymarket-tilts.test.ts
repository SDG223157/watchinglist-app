/**
 * Polymarket overlay consumer tests.
 *
 * Runner: Vitest (not yet installed — add with `pnpm add -D vitest` when
 * you want to run this). Mirrors the skeleton from
 * botboard-private/scripts/fixtures/polymarket_tilts_test_skeleton.ts.
 *
 * Verifies:
 *   1. fetchTiltsFor() reads only horizon_days = 1 rows.
 *   2. horizon = 5 rows are filtered out.
 *   3. Shadow mode (lambda = 0) does not change prior μ at all.
 *   4. lambda = 0.25 applies 0.25 * 0.006 * z per symbol (capped).
 *   5. Missing symbols fall through as z = 0 (no crash, no implicit default).
 *   6. getPolymarketLambda() respects the [0, 0.25] cap.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  deltaMuPrior,
  fetchTiltsFor,
  getPolymarketLambda,
  POLYMARKET_PRIOR_SLOPE,
  type PolymarketTiltMap,
} from "@/lib/polymarket-tilts";

const FIXTURE_PATH = path.join(__dirname, "polymarket_tilts_test_fixture.sql");
const FIXTURE_DATE = "2024-01-15";

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
    const ddl = fs.readFileSync(FIXTURE_PATH, "utf8");
    const stmts = ddl
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter(
        (s) =>
          s.length &&
          !s.startsWith("--") &&
          !/^BEGIN$/i.test(s) &&
          !/^COMMIT$/i.test(s),
      );
    for (const stmt of stmts) {
      // neon-serverless exposes `unsafe` for raw multi-statement-free SQL.
      // @ts-expect-error — neon's unsafe is runtime-only.
      await sql.unsafe(stmt + ";");
    }
  });

  afterAll(async () => {
    const sql = getDb();
    await sql`DELETE FROM polymarket_ticker_tilts
              WHERE as_of_date = ${FIXTURE_DATE}::date`;
  });

  it("reads only horizon_days = 1 for the fixture date", async () => {
    const tilts = await fetchTiltsFor(FIXTURE_DATE, 1);
    expect(Object.keys(tilts).sort()).toEqual(
      ["FXI", "GLD", "LMT", "MSTR", "NVDA", "QQQ", "SPY", "TLT", "USO"],
    );
    expect(tilts.GLD.z).toBeCloseTo(2.27, 2);

    for (const r of Object.values(tilts)) {
      expect(r.z).toBeGreaterThanOrEqual(-3);
      expect(r.z).toBeLessThanOrEqual(3);
    }
  });

  it("shadow mode: lambda = 0 leaves prior μ unchanged", async () => {
    const tilts = await fetchTiltsFor(FIXTURE_DATE, 1);
    const prior = { USO: 0.04, SPY: 0.05, GLD: 0.02, UNKNOWN: 0.01 };
    const after = applyTilt(prior, tilts, 0);
    expect(after).toEqual(prior);
  });

  it("lambda = 0.25 applies 0.25 * slope * z per tilted symbol", async () => {
    const tilts = await fetchTiltsFor(FIXTURE_DATE, 1);
    const prior = { USO: 0.04, SPY: 0.05, GLD: 0.02, UNKNOWN: 0.01 };
    const after = applyTilt(prior, tilts, 0.25);

    expect(after.USO).toBeCloseTo(0.04 + 0.25 * POLYMARKET_PRIOR_SLOPE * 3.0, 10);
    expect(after.SPY).toBeCloseTo(0.05 + 0.25 * POLYMARKET_PRIOR_SLOPE * -1.82, 10);
    expect(after.GLD).toBeCloseTo(0.02 + 0.25 * POLYMARKET_PRIOR_SLOPE * 2.27, 10);
    expect(after.UNKNOWN).toBeCloseTo(0.01, 12);
  });

  it("zero-z symbols round-trip as no-ops", async () => {
    const tilts = await fetchTiltsFor(FIXTURE_DATE, 1);
    expect(tilts.FXI.z).toBe(0);
    const prior = { FXI: 0.03 };
    const after = applyTilt(prior, tilts, 0.25);
    expect(after.FXI).toBeCloseTo(0.03, 12);
  });

  it("missing date returns empty map (no cross-day leakage)", async () => {
    const empty = await fetchTiltsFor("1999-01-01", 1);
    expect(empty).toEqual({});
  });

  it("getPolymarketLambda clamps to [0, 0.25]", () => {
    const orig = process.env.POLYMARKET_LAMBDA;
    try {
      process.env.POLYMARKET_LAMBDA = "0.5";
      expect(getPolymarketLambda()).toBe(0.25);
      process.env.POLYMARKET_LAMBDA = "-1";
      expect(getPolymarketLambda()).toBe(0);
      process.env.POLYMARKET_LAMBDA = "not-a-number";
      expect(getPolymarketLambda()).toBe(0);
      process.env.POLYMARKET_LAMBDA = "0.05";
      expect(getPolymarketLambda()).toBeCloseTo(0.05, 10);
    } finally {
      if (orig === undefined) delete process.env.POLYMARKET_LAMBDA;
      else process.env.POLYMARKET_LAMBDA = orig;
    }
  });
});
