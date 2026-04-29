CREATE TABLE IF NOT EXISTS process_registry_versions (
  id BIGSERIAL PRIMARY KEY,
  registry_slug TEXT NOT NULL REFERENCES process_registry_items(slug) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  object_type TEXT NOT NULL,
  status TEXT NOT NULL,
  definition_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  runner_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_hash TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (registry_slug, version)
);

CREATE INDEX IF NOT EXISTS idx_process_registry_versions_slug_created
  ON process_registry_versions (registry_slug, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_process_registry_versions_hash
  ON process_registry_versions (registry_slug, source_hash);

ALTER TABLE process_runs
  ADD COLUMN IF NOT EXISTS registry_version_id BIGINT REFERENCES process_registry_versions(id);

CREATE INDEX IF NOT EXISTS idx_process_runs_registry_version_id
  ON process_runs (registry_version_id);

INSERT INTO process_registry_versions (
  registry_slug,
  version,
  object_type,
  status,
  definition_snapshot,
  metadata_snapshot,
  runner_snapshot,
  source_hash,
  created_by,
  activated_at
)
SELECT
  r.slug,
  r.version,
  r.object_type,
  r.status,
  to_jsonb(r) - 'created_at' - 'updated_at',
  COALESCE(to_jsonb(m) - 'created_at' - 'updated_at', '{}'::jsonb),
  COALESCE(m.operation_hints->'runner_config', '{}'::jsonb),
  md5(
    (to_jsonb(r) - 'created_at' - 'updated_at')::text ||
    COALESCE((to_jsonb(m) - 'created_at' - 'updated_at')::text, '{}') ||
    COALESCE((m.operation_hints->'runner_config')::text, '{}')
  ),
  'migration_008_backfill',
  CASE WHEN r.status = 'active' THEN NOW() ELSE NULL END
FROM process_registry_items r
LEFT JOIN skill_operation_metadata m ON m.registry_slug = r.slug
ON CONFLICT (registry_slug, version) DO NOTHING;

UPDATE process_runs pr
SET registry_version_id = prv.id
FROM process_registry_versions prv
WHERE pr.registry_version_id IS NULL
  AND prv.registry_slug = pr.registry_slug
  AND prv.version = pr.registry_version;
