-- Futures watchlist: track user's selected futures varieties and analysis reports
CREATE TABLE IF NOT EXISTS futures_watchlist (
  id SERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  variety_code TEXT NOT NULL,
  variety_name TEXT NOT NULL,
  exchange TEXT NOT NULL,
  multiplier NUMERIC,
  latest_price NUMERIC,
  price_change_pct NUMERIC,
  notes TEXT DEFAULT '',
  analysis_report TEXT,
  analysis_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_email, variety_code)
);

CREATE INDEX IF NOT EXISTS idx_futures_watchlist_user
  ON futures_watchlist (user_email);
CREATE INDEX IF NOT EXISTS idx_futures_watchlist_code
  ON futures_watchlist (variety_code);
