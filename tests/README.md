# Tests

## polymarket-tilts.test.ts

Vitest suite for the Polymarket overlay consumer (`lib/polymarket-tilts.ts`)
and the nudge formula used by `lib/recipe-portfolio.ts`.

### Running

Vitest is not installed by default. To run:

```bash
pnpm add -D vitest @vitest/ui
pnpm vitest run tests/polymarket-tilts.test.ts
```

The test seeds `polymarket_ticker_tilts` with
`tests/polymarket_tilts_test_fixture.sql` (10 hand-crafted rows against
date `2024-01-15`) and tears it down in `afterAll`.

Because Neon serverless HTTP doesn't support multi-statement tagged
templates, the fixture is split on `;` and each statement is executed
with `sql.unsafe(...)`.

### What it verifies

1. `fetchTiltsFor(date, 1)` reads only `horizon_days = 1` rows.
2. A `horizon_days = 5` row for the same symbol is filtered out.
3. Shadow mode (`lambda = 0`) leaves prior μ unchanged.
4. `lambda = 0.25` applies `0.25 * 0.006 * z` per symbol.
5. Missing symbols pass through with `z = 0`.
6. `getPolymarketLambda()` clamps the env var to `[0, 0.25]`.

### Data contract

See `docs/polymarket-watchinglist-integration.md` in the
`botboard-private` repo for the producer-side spec.
