CREATE TABLE IF NOT EXISTS financials_annual (
  symbol TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL,
  period_end_date DATE NOT NULL,
  revenue NUMERIC,
  net_income NUMERIC,
  ebitda NUMERIC,
  operating_income NUMERIC,
  gross_profit NUMERIC,
  eps NUMERIC,
  source TEXT NOT NULL DEFAULT 'fmp',
  raw_json JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, fiscal_year, period_end_date)
);

CREATE INDEX IF NOT EXISTS idx_financials_annual_symbol_date
  ON financials_annual (symbol, period_end_date DESC);

CREATE TABLE IF NOT EXISTS financials_quarterly (
  symbol TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL,
  period TEXT NOT NULL,
  period_end_date DATE NOT NULL,
  revenue NUMERIC,
  net_income NUMERIC,
  ebitda NUMERIC,
  operating_income NUMERIC,
  gross_profit NUMERIC,
  eps NUMERIC,
  source TEXT NOT NULL DEFAULT 'fmp',
  raw_json JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, fiscal_year, period, period_end_date)
);

CREATE INDEX IF NOT EXISTS idx_financials_quarterly_symbol_date
  ON financials_quarterly (symbol, period_end_date DESC);

CREATE TABLE IF NOT EXISTS financial_metrics_asof (
  symbol TEXT NOT NULL,
  as_of_date DATE NOT NULL,
  revenue_growth_recent_q NUMERIC,
  revenue_growth_ttm NUMERIC,
  revenue_cagr_3y NUMERIC,
  revenue_cagr_5y NUMERIC,
  source_periods_used JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_financial_metrics_asof_symbol_date
  ON financial_metrics_asof (symbol, as_of_date DESC);
