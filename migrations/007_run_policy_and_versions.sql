ALTER TABLE process_runs
  ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS timeout_ms INTEGER,
  ADD COLUMN IF NOT EXISTS retry_backoff_ms INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_category TEXT,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS frozen_registry JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS frozen_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS frozen_runner JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_process_runs_pending_retry
  ON process_runs (status, next_retry_at, created_at);

CREATE INDEX IF NOT EXISTS idx_process_runs_failure_category
  ON process_runs (failure_category);

UPDATE skill_operation_metadata
SET operation_hints = jsonb_set(
  COALESCE(operation_hints, '{}'::jsonb),
  '{runner_config}',
  COALESCE(operation_hints->'runner_config', '{}'::jsonb) || '{
    "max_attempts": 2,
    "retry_backoff_ms": 5000
  }'::jsonb,
  true
)
WHERE operation_hints ? 'runner_config'
  AND registry_slug = 'price-structure-analysis';

UPDATE skill_operation_metadata
SET operation_hints = jsonb_set(
  COALESCE(operation_hints, '{}'::jsonb),
  '{runner_config}',
  COALESCE(operation_hints->'runner_config', '{}'::jsonb) || '{
    "max_attempts": 2,
    "retry_backoff_ms": 15000
  }'::jsonb,
  true
)
WHERE operation_hints ? 'runner_config'
  AND registry_slug = 'polymarket-distiller';

UPDATE skill_operation_metadata
SET operation_hints = jsonb_set(
  COALESCE(operation_hints, '{}'::jsonb),
  '{runner_config}',
  COALESCE(operation_hints->'runner_config', '{}'::jsonb) || '{
    "max_attempts": 1,
    "retry_backoff_ms": 0
  }'::jsonb,
  true
)
WHERE operation_hints ? 'runner_config'
  AND registry_slug NOT IN ('price-structure-analysis', 'polymarket-distiller');
