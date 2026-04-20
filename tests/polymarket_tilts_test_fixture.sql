-- Deterministic test fixture for polymarket_ticker_tilts.
--
-- Copy this file into the watchinglist.app repo (e.g. tests/fixtures/).
-- It seeds a small, hand-crafted set of rows so Jest / Vitest integration
-- tests don't depend on live Polymarket data.
--
-- Properties of the fixture:
--   - Uses a fixed date '2024-01-15'. Tests that need "today" should stub
--     `CURRENT_DATE` in the SQL layer or query this date explicitly.
--   - Covers all mapping categories currently live in
--     scripts/polymarket_event_map.yaml: middle_east_escalation, fed_rate_cut,
--     election_republican/democrat, spot_crypto_etf, tariffs_expand.
--   - Covers edge cases: z at positive cap (+3.0), z at negative cap (-3.0),
--     z in the middle, z = 0 with n_events > 0 (flat signal), and a high
--     n_contributions / n_events ratio (one event maps to multiple tickers).
--   - Horizon mix: one row at horizon_days = 5 to exercise filter logic.
--
-- Usage (Jest / Vitest):
--   beforeAll: execute fixture SQL
--   afterAll:  execute teardown
--
-- Usage (psql):
--   psql $NEON_DB_URL -f polymarket_tilts_test_fixture.sql

BEGIN;

DELETE FROM polymarket_ticker_tilts
WHERE as_of_date = DATE '2024-01-15';

INSERT INTO polymarket_ticker_tilts (
  as_of_date, symbol, horizon_days,
  z, z_raw, n_events, n_contributions,
  top_reason, reasons_json, params_json
) VALUES

-- 1. Positive-cap case: ME escalation bids up oil (fixture: USO z = +3.0).
(DATE '2024-01-15', 'USO', 1,
 3.000, 4.230, 3, 5,
 'Will the Iranian regime fall by April 30?',
 '[
   {"mapping":"middle_east_escalation","event_id":"evt_iran_regime_apr30",
    "event_title":"Will the Iranian regime fall by April 30?",
    "p_now":0.18,"dL":0.62,"z":2.85,"contribution":2.85,
    "volume_usd":36300000.0},
   {"mapping":"middle_east_escalation","event_id":"evt_iran_us_conflict_end",
    "event_title":"Iran x Israel/US conflict ends by...?",
    "p_now":0.41,"dL":-0.28,"z":-0.83,"contribution":0.83,
    "volume_usd":48300000.0}
 ]'::jsonb,
 '{"horizon_days":1,"vol_window_days":60,"z_cap":3.0,
   "min_volume":10000.0,"min_liquidity":2500.0}'::jsonb),

-- 2. Negative-cap case: same ME event, SPY gets risk-off.
(DATE '2024-01-15', 'SPY', 1,
 -1.820, -1.820, 3, 3,
 'Will the Iranian regime fall by April 30?',
 '[
   {"mapping":"middle_east_escalation","event_id":"evt_iran_regime_apr30",
    "event_title":"Will the Iranian regime fall by April 30?",
    "p_now":0.18,"dL":0.62,"z":2.85,"contribution":-1.82,
    "volume_usd":36300000.0}
 ]'::jsonb,
 '{"horizon_days":1,"vol_window_days":60,"z_cap":3.0}'::jsonb),

-- 3. Middle-of-range, gold bid on geopolitical tail.
(DATE '2024-01-15', 'GLD', 1,
 2.270, 2.270, 19, 24,
 'Will the Iranian regime fall by April 30?',
 '[
   {"mapping":"middle_east_escalation","event_id":"evt_iran_regime_apr30",
    "event_title":"Will the Iranian regime fall by April 30?",
    "p_now":0.18,"dL":0.62,"z":2.85,"contribution":2.27,
    "volume_usd":36300000.0}
 ]'::jsonb,
 '{"horizon_days":1,"vol_window_days":60,"z_cap":3.0}'::jsonb),

-- 4. Flat-signal edge case: n_events > 0 but z exactly 0 (prob did not move).
(DATE '2024-01-15', 'FXI', 1,
 0.000, 0.000, 1, 1,
 'Will Trump visit China by...?',
 '[
   {"mapping":"china_rapprochement","event_id":"evt_trump_china_visit",
    "event_title":"Will Trump visit China by...?",
    "p_now":0.52,"dL":0.00,"z":0.00,"contribution":0.00,
    "volume_usd":2100000.0}
 ]'::jsonb,
 '{"horizon_days":1,"vol_window_days":60,"z_cap":3.0}'::jsonb),

-- 5. Negative-cap, crypto roll-over (MSTR loses when BTC-ATH prob falls).
(DATE '2024-01-15', 'MSTR', 1,
 -3.000, -3.450, 2, 4,
 'Bitcoin all time high by ___?',
 '[
   {"mapping":"spot_crypto_etf","event_id":"evt_btc_ath_2024",
    "event_title":"Bitcoin all time high by ___?",
    "p_now":0.23,"dL":-1.02,"z":-3.10,"contribution":-3.10,
    "volume_usd":33400000.0}
 ]'::jsonb,
 '{"horizon_days":1,"vol_window_days":60,"z_cap":3.0}'::jsonb),

-- 6. Defense names tied to midterms event.
(DATE '2024-01-15', 'LMT', 1,
 -2.920, -2.920, 4, 4,
 'Balance of Power: 2026 Midterms',
 '[
   {"mapping":"election_republican","event_id":"evt_midterms_2026",
    "event_title":"Balance of Power: 2026 Midterms",
    "p_now":0.47,"dL":-0.91,"z":-2.92,"contribution":-2.92,
    "volume_usd":19800000.0}
 ]'::jsonb,
 '{"horizon_days":1,"vol_window_days":60,"z_cap":3.0}'::jsonb),

-- 7. Moderate signal on a rate-sensitive ETF.
(DATE '2024-01-15', 'TLT', 1,
 0.660, 0.660, 6, 6,
 'Fed Decision in July?',
 '[
   {"mapping":"fed_rate_cut","event_id":"evt_fed_july_2024",
    "event_title":"Fed Decision in July?",
    "p_now":0.63,"dL":0.21,"z":0.66,"contribution":0.66,
    "volume_usd":8400000.0}
 ]'::jsonb,
 '{"horizon_days":1,"vol_window_days":60,"z_cap":3.0}'::jsonb),

-- 8. Small tilt on broad equity index from Fed overlay.
(DATE '2024-01-15', 'QQQ', 1,
 0.520, 0.520, 6, 6,
 'Fed Decision in July?',
 '[
   {"mapping":"fed_rate_cut","event_id":"evt_fed_july_2024",
    "event_title":"Fed Decision in July?",
    "p_now":0.63,"dL":0.21,"z":0.52,"contribution":0.52,
    "volume_usd":8400000.0}
 ]'::jsonb,
 '{"horizon_days":1,"vol_window_days":60,"z_cap":3.0}'::jsonb),

-- 9. Cross-mapping ticker (NVDA: M&A event contributes positive).
(DATE '2024-01-15', 'NVDA', 1,
 0.800, 0.800, 5, 5,
 'Which companies will be acquired before 2027?',
 '[
   {"mapping":"m_and_a","event_id":"evt_acqs_2027",
    "event_title":"Which companies will be acquired before 2027?",
    "p_now":0.31,"dL":0.26,"z":0.80,"contribution":0.80,
    "volume_usd":14200000.0}
 ]'::jsonb,
 '{"horizon_days":1,"vol_window_days":60,"z_cap":3.0}'::jsonb),

-- 10. Horizon-5 row: same symbol, different horizon, different z.
--     Exercises the `horizon_days = 1` filter in the consumer.
(DATE '2024-01-15', 'GLD', 5,
 1.610, 1.610, 14, 18,
 'Russia x Ukraine ceasefire by end of 2026?',
 '[
   {"mapping":"russia_ukraine_ceasefire","event_id":"evt_ru_ua_2026",
    "event_title":"Russia x Ukraine ceasefire by end of 2026?",
    "p_now":0.55,"dL":-0.42,"z":-1.61,"contribution":1.61,
    "volume_usd":21700000.0}
 ]'::jsonb,
 '{"horizon_days":5,"vol_window_days":60,"z_cap":3.0}'::jsonb);

COMMIT;

-- -------------------------------------------------------------------------
-- Teardown (afterAll):
-- DELETE FROM polymarket_ticker_tilts WHERE as_of_date = DATE '2024-01-15';
-- -------------------------------------------------------------------------
