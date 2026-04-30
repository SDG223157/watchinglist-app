CREATE TABLE IF NOT EXISTS wpr_asset_catalog (
  asset_type TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  freshness_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  schema_hint JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO wpr_asset_catalog (
  asset_type,
  name,
  description,
  source_kind,
  source_ref,
  freshness_policy,
  schema_hint,
  tags
)
VALUES
  (
    'watchlist_snapshot',
    'Latest Watchlist Snapshot',
    'Latest per-symbol row from watchlist_items, including scores, walls, regimes, valuation fields, TrendWise, sector, and narrative fields.',
    'postgres_table',
    'watchlist_items',
    '{"max_age_hours": 24, "refresh_strategy": "refresh_stock_or_watchlist"}'::jsonb,
    '{"entity_keys": ["symbol", "market"], "primary_time_column": "created_at"}'::jsonb,
    ARRAY['watchlist', 'stock', 'snapshot']
  ),
  (
    'financial_metrics',
    'Financial Metrics As Of',
    'As-of financial growth metrics from financial_metrics_asof.',
    'postgres_table',
    'financial_metrics_asof',
    '{"max_age_days": 30, "refresh_strategy": "backfill_financials"}'::jsonb,
    '{"entity_keys": ["symbol"], "primary_time_column": "computed_at"}'::jsonb,
    ARRAY['financials', 'growth', 'asof']
  ),
  (
    'entropy_state',
    'HMM Entropy State',
    'Cached entropy/HMM profile per symbol from entropy_cache, with watchlist entropy columns as a fallback.',
    'postgres_table',
    'entropy_cache',
    '{"max_age_hours": 24, "refresh_strategy": "entropy_refresh"}'::jsonb,
    '{"entity_keys": ["symbol"], "primary_time_column": "computed_at"}'::jsonb,
    ARRAY['entropy', 'hmm', 'regime']
  ),
  (
    'portfolio_allocation',
    'Portfolio Allocation Artifact',
    'Durable WPR portfolio allocation artifacts produced by portfolio construction skills.',
    'process_artifact',
    'process_artifacts:portfolio_allocation',
    '{"max_age_hours": 24, "refresh_strategy": "rerun_portfolio_construction"}'::jsonb,
    '{"entity_keys": ["market"], "primary_time_column": "created_at"}'::jsonb,
    ARRAY['portfolio', 'allocation', 'artifact']
  ),
  (
    'prior_artifacts',
    'Prior WPR Artifacts',
    'Recent process_artifacts that can provide context to downstream skills.',
    'process_artifact',
    'process_artifacts',
    '{"max_age_days": 7, "refresh_strategy": "prefer_latest_completed_artifact"}'::jsonb,
    '{"entity_keys": ["symbol", "registry_slug", "artifact_type"], "primary_time_column": "created_at"}'::jsonb,
    ARRAY['wpr', 'artifact', 'context']
  ),
  (
    'price_history',
    'Price History',
    'Historical OHLCV price data resolved by runner-specific market data providers such as yahoo-finance2 or cachedHistorical.',
    'market_data_provider',
    'yahoo-finance2',
    '{"max_age_hours": 24, "refresh_strategy": "runner_fetch"}'::jsonb,
    '{"entity_keys": ["symbol"], "primary_time_column": "provider_time"}'::jsonb,
    ARRAY['price', 'ohlcv', 'market-data']
  )
ON CONFLICT (asset_type) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  source_kind = EXCLUDED.source_kind,
  source_ref = EXCLUDED.source_ref,
  freshness_policy = EXCLUDED.freshness_policy,
  schema_hint = EXCLUDED.schema_hint,
  tags = EXCLUDED.tags,
  updated_at = NOW();

UPDATE skill_operation_metadata
SET operation_hints = COALESCE(operation_hints, '{}'::jsonb) || '{
  "required_assets": ["price_history"],
  "optional_assets": ["watchlist_snapshot", "financial_metrics", "entropy_state", "prior_artifacts"],
  "produced_assets": ["price_structure_verdict"]
}'::jsonb,
updated_at = NOW()
WHERE registry_slug = 'price-structure-analysis';

UPDATE skill_operation_metadata
SET operation_hints = COALESCE(operation_hints, '{}'::jsonb) || '{
  "required_assets": [],
  "optional_assets": ["prior_artifacts"],
  "produced_assets": ["polymarket_distillation"]
}'::jsonb,
updated_at = NOW()
WHERE registry_slug = 'polymarket-distiller';

UPDATE skill_operation_metadata
SET operation_hints = COALESCE(operation_hints, '{}'::jsonb) || '{
  "required_assets": ["watchlist_snapshot"],
  "optional_assets": ["entropy_state", "financial_metrics", "prior_artifacts"],
  "produced_assets": ["portfolio_allocation"]
}'::jsonb,
updated_at = NOW()
WHERE registry_slug = 'us-portfolio-construction';

UPDATE skill_operation_metadata
SET operation_hints = COALESCE(operation_hints, '{}'::jsonb) || '{
  "required_assets": ["watchlist_snapshot"],
  "optional_assets": ["price_history", "financial_metrics", "entropy_state", "prior_artifacts"],
  "produced_assets": ["decision_memo"]
}'::jsonb,
updated_at = NOW()
WHERE registry_slug IN (
  'schema-first-stock-analysis',
  'hmm-entropy-analysis',
  'narrative-cycle-analysis',
  'analysis-to-meeting',
  'stock-analysis'
);
