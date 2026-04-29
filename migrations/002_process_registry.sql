CREATE TABLE IF NOT EXISTS process_registry_items (
  slug TEXT PRIMARY KEY,
  object_type TEXT NOT NULL CHECK (
    object_type IN ('skill', 'pipeline', 'process', 'application', 'template')
  ),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'active', 'review', 'archived')
  ),
  version INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_process_registry_items_type_status
  ON process_registry_items (object_type, status);

CREATE TABLE IF NOT EXISTS process_runs (
  id BIGSERIAL PRIMARY KEY,
  registry_slug TEXT NOT NULL REFERENCES process_registry_items(slug),
  registry_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'running', 'blocked', 'failed', 'completed', 'superseded')
  ),
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  outputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_process_runs_registry_created
  ON process_runs (registry_slug, created_at DESC);

CREATE TABLE IF NOT EXISTS process_artifacts (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT REFERENCES process_runs(id),
  registry_slug TEXT REFERENCES process_registry_items(slug),
  artifact_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'needs_review' CHECK (
    status IN ('needs_review', 'approved', 'published', 'archived')
  ),
  content_uri TEXT,
  json_content JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_step TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_process_artifacts_status_created
  ON process_artifacts (status, created_at DESC);

CREATE TABLE IF NOT EXISTS process_audit_events (
  id BIGSERIAL PRIMARY KEY,
  registry_slug TEXT REFERENCES process_registry_items(slug),
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO process_registry_items
  (slug, object_type, name, status, version, description, tags, config)
VALUES
  (
    'schema-first-stock-analysis',
    'skill',
    'Schema-First Stock Analysis',
    'active',
    1,
    'Consumes a ticker and produces typed outputs: snapshot, narrative cycle, gravity walls, entropy state, and required artifacts.',
    ARRAY['schema', 'stock', 'analysis'],
    '{
      "input_schema": {"ticker": "string", "horizon": "short|medium|long"},
      "output_schema": {
        "stock_snapshot_id": "string",
        "artifact_ids": "string[]",
        "risk_flags": "string[]"
      },
      "artifact_types": ["snapshot", "decision_memo", "risk_map"],
      "quality_checks": ["has_geometric_order", "has_fresh_snapshot"]
    }'::jsonb
  ),
  (
    'stock-to-meeting-pipeline',
    'pipeline',
    'Stock to Meeting Pipeline',
    'draft',
    1,
    'Turns a watchlist ticker into a structured research package and BotBoard-ready discussion topic.',
    ARRAY['pipeline', 'meeting', 'research'],
    '{
      "graph": [
        "load_latest_snapshot",
        "refresh_if_stale",
        "run_schema_first_analysis",
        "create_meeting_topic",
        "save_artifacts"
      ],
      "approval_points": ["before_external_publish"],
      "failure_modes": ["stale_market_data", "missing_references"]
    }'::jsonb
  ),
  (
    'daily-watchlist-operating-loop',
    'process',
    'Daily Watchlist Operating Loop',
    'review',
    1,
    'A durable process that watches snapshot freshness, trigger events, approvals, and generated artifacts for the portfolio.',
    ARRAY['process', 'watchlist', 'daily'],
    '{
      "trigger_type": "schedule",
      "state": "ready",
      "memory": ["latest_successful_run", "pending_approvals", "known_blockers"],
      "scorecard": ["reliability", "artifact_usefulness", "human_edit_distance"]
    }'::jsonb
  ),
  (
    'artifact-inbox',
    'application',
    'Artifact Inbox',
    'draft',
    1,
    'A review surface for reports, meeting topics, decision memos, charts, datasets, and publishable assets.',
    ARRAY['application', 'artifacts', 'review'],
    '{
      "route": "/processes/artifacts",
      "artifact_states": ["needs_review", "approved", "published", "archived"],
      "views": ["by_process", "by_stock", "by_status"]
    }'::jsonb
  ),
  (
    'company-research-template',
    'template',
    'Company Research Template',
    'active',
    1,
    'Instantiates a stock research process with input form, pipeline, artifact archive, approval gates, and run history.',
    ARRAY['template', 'company', 'research'],
    '{
      "required_inputs": ["ticker", "audience", "depth"],
      "generated_objects": ["process", "pipeline", "application", "triggers"],
      "default_triggers": ["manual", "snapshot_stale", "threshold_crossed"]
    }'::jsonb
  )
ON CONFLICT (slug) DO UPDATE SET
  object_type = EXCLUDED.object_type,
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  version = EXCLUDED.version,
  description = EXCLUDED.description,
  tags = EXCLUDED.tags,
  config = EXCLUDED.config,
  updated_at = NOW();
