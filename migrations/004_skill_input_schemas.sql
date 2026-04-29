UPDATE skill_operation_metadata
SET input_schema = '{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "ticker": {"type": "string", "minLength": 1},
    "symbol": {"type": "string", "minLength": 1},
    "operation_query": {"type": "string"},
    "source": {"type": "string"}
  },
  "anyOf": [
    {"required": ["ticker"]},
    {"required": ["symbol"]}
  ]
}'::jsonb,
updated_at = NOW()
WHERE registry_slug = 'price-structure-analysis';

UPDATE skill_operation_metadata
SET input_schema = '{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "query": {"type": "string", "minLength": 1},
    "slug": {"type": "string", "minLength": 1},
    "event_id": {"type": ["string", "integer"], "minLength": 1},
    "url": {"type": "string", "minLength": 1},
    "event": {"type": "string", "minLength": 1},
    "input": {"type": "string", "minLength": 1},
    "ticker": {"type": "string", "minLength": 1},
    "symbol": {"type": "string", "minLength": 1},
    "mapped_only": {"type": "boolean"},
    "operation_query": {"type": "string"},
    "source": {"type": "string"}
  },
  "anyOf": [
    {"required": ["query"]},
    {"required": ["slug"]},
    {"required": ["event_id"]},
    {"required": ["url"]},
    {"required": ["event"]},
    {"required": ["input"]},
    {"required": ["ticker"]},
    {"required": ["symbol"]}
  ]
}'::jsonb,
updated_at = NOW()
WHERE registry_slug = 'polymarket-distiller';
