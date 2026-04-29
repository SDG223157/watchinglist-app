UPDATE skill_operation_metadata
SET input_schema = '{
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "input": {"type": "string"},
    "query": {"type": "string"},
    "ticker": {"type": "string"},
    "symbol": {"type": "string"},
    "url": {"type": "string"},
    "source": {"type": "string"},
    "operation_query": {"type": "string"},
    "args": {"type": "array"},
    "options": {"type": "object", "additionalProperties": true},
    "dry_run": {"type": "boolean"}
  }
}'::jsonb,
updated_at = NOW()
WHERE registry_slug NOT IN ('price-structure-analysis', 'polymarket-distiller')
  AND registry_slug IN (
    SELECT slug
    FROM process_registry_items
    WHERE object_type = 'skill'
  );
