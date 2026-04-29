CREATE TABLE IF NOT EXISTS skill_operation_metadata (
  registry_slug TEXT PRIMARY KEY REFERENCES process_registry_items(slug) ON DELETE CASCADE,
  source_kind TEXT NOT NULL DEFAULT 'codex_skill_folder',
  source_path TEXT NOT NULL,
  trigger_terms TEXT[] NOT NULL DEFAULT '{}',
  routing_keywords TEXT[] NOT NULL DEFAULT '{}',
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  required_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  side_effects TEXT[] NOT NULL DEFAULT '{}',
  artifact_types TEXT[] NOT NULL DEFAULT '{}',
  approval_requirements TEXT[] NOT NULL DEFAULT '{}',
  operation_hints JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (
    risk_level IN ('low', 'medium', 'high', 'critical')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skill_operation_metadata_trigger_terms
  ON skill_operation_metadata USING GIN (trigger_terms);

CREATE INDEX IF NOT EXISTS idx_skill_operation_metadata_routing_keywords
  ON skill_operation_metadata USING GIN (routing_keywords);

CREATE INDEX IF NOT EXISTS idx_skill_operation_metadata_required_tools
  ON skill_operation_metadata USING GIN (required_tools);

CREATE INDEX IF NOT EXISTS idx_skill_operation_metadata_risk_level
  ON skill_operation_metadata (risk_level);

INSERT INTO skill_operation_metadata (
  registry_slug,
  source_kind,
  source_path,
  trigger_terms,
  routing_keywords,
  input_schema,
  output_schema,
  required_tools,
  side_effects,
  artifact_types,
  approval_requirements,
  operation_hints,
  risk_level
)
VALUES (
  'schema-first-stock-analysis',
  'registry_seed',
  'process_registry_items.config',
  ARRAY['stock', 'ticker', 'analysis', 'snapshot', 'narrative', 'entropy'],
  ARRAY['schema-first-stock-analysis', 'stock', 'ticker', 'watchlist', 'analysis', 'narrative-cycle', 'gravity-walls', 'entropy'],
  '{
    "type": "object",
    "properties": {
      "ticker": {"type": "string"},
      "horizon": {"type": "string"}
    },
    "required": ["ticker"]
  }'::jsonb,
  '{
    "type": "object",
    "properties": {
      "stock_snapshot_id": {"type": "string"},
      "artifact_ids": {"type": "array", "items": {"type": "string"}},
      "risk_flags": {"type": "array", "items": {"type": "string"}}
    }
  }'::jsonb,
  '[{"name": "watchlist_db"}, {"name": "process_registry"}]'::jsonb,
  ARRAY['writes_database'],
  ARRAY['snapshot', 'decision_memo', 'risk_map'],
  ARRAY[]::text[],
  '{
    "source_name": "Schema-First Stock Analysis",
    "source_slug": "schema-first-stock-analysis",
    "operation": "Analyze a ticker and produce typed stock research artifacts."
  }'::jsonb,
  'medium'
)
ON CONFLICT (registry_slug) DO UPDATE SET
  source_kind = EXCLUDED.source_kind,
  source_path = EXCLUDED.source_path,
  trigger_terms = EXCLUDED.trigger_terms,
  routing_keywords = EXCLUDED.routing_keywords,
  input_schema = EXCLUDED.input_schema,
  output_schema = EXCLUDED.output_schema,
  required_tools = EXCLUDED.required_tools,
  side_effects = EXCLUDED.side_effects,
  artifact_types = EXCLUDED.artifact_types,
  approval_requirements = EXCLUDED.approval_requirements,
  operation_hints = EXCLUDED.operation_hints,
  risk_level = EXCLUDED.risk_level,
  updated_at = NOW();
