INSERT INTO process_registry_items (
  slug,
  object_type,
  name,
  status,
  version,
  description,
  tags,
  config
)
VALUES (
  'us-portfolio-construction',
  'skill',
  'US Portfolio Construction',
  'active',
  1,
  'Builds a US stock model portfolio allocation from the BotBoard US watchlist rules and saves a durable WPR portfolio artifact.',
  ARRAY['portfolio', 'allocation', 'us-stocks', 'watchlist'],
  '{
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "market": {"type": "string", "enum": ["US"]},
        "max_holdings": {"type": "integer", "minimum": 1, "maximum": 100},
        "capital_usd": {"type": "number", "minimum": 1},
        "source": {"type": "string"},
        "fetch": {"type": "boolean"}
      },
      "required": ["market", "max_holdings", "capital_usd"]
    },
    "artifact_types": ["portfolio_allocation"]
  }'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  object_type = EXCLUDED.object_type,
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  description = EXCLUDED.description,
  tags = EXCLUDED.tags,
  config = EXCLUDED.config,
  updated_at = NOW();

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
  'us-portfolio-construction',
  'built_in_runner',
  '/Users/sdg223157/botboard-private/scripts/build_us_portfolio_from_watchlist.py',
  ARRAY['portfolio', 'allocation', 'holdings', 'positions', 'us stocks', 'watchlist portfolio'],
  ARRAY['portfolio', 'allocation', 'us', 'usa', 'stocks', 'holdings', 'position sizing', 'watchlist', 'botboard'],
  '{
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "market": {"type": "string", "enum": ["US"]},
      "max_holdings": {"type": "integer", "minimum": 1, "maximum": 100},
      "capital_usd": {"type": "number", "minimum": 1},
      "source": {"type": "string"},
      "fetch": {"type": "boolean"}
    },
    "required": ["market", "max_holdings", "capital_usd"]
  }'::jsonb,
  '{
    "type": "object",
    "additionalProperties": true,
    "properties": {
      "market": {"type": "string"},
      "capital_usd": {"type": "number"},
      "max_holdings": {"type": "integer"},
      "count": {"type": "integer"},
      "total_weight_pct": {"type": "number"},
      "total_amount_usd": {"type": "number"},
      "holdings": {"type": "array", "items": {"type": "object", "additionalProperties": true}},
      "markdown": {"type": "string"},
      "disclaimer": {"type": "string"},
      "generated_at": {"type": "string"},
      "source": {"type": "string"},
      "runner": {"type": "object", "additionalProperties": true}
    },
    "required": ["market", "capital_usd", "max_holdings", "count", "holdings", "markdown", "generated_at"]
  }'::jsonb,
  '[{"name": "botboard_api"}, {"name": "botboard_watchlist"}, {"name": "python3"}]'::jsonb,
  ARRAY['reads_external_api', 'writes_wpr_artifact'],
  ARRAY['portfolio_allocation'],
  ARRAY[]::text[],
  '{
    "source_name": "US Portfolio Construction",
    "source_slug": "us-portfolio-construction",
    "operation": "Build a US stock model portfolio allocation from BotBoard watchlist data.",
    "runner_config": {
      "runner_kind": "built_in",
      "executor": "us_portfolio_construction",
      "entrypoint": "/Users/sdg223157/botboard-private/scripts/build_us_portfolio_from_watchlist.py",
      "artifact_type": "portfolio_allocation",
      "timeout_ms": 180000,
      "max_attempts": 2,
      "retry_backoff_ms": 10000,
      "env_policy": "process",
      "smoke_inputs": {
        "market": "US",
        "max_holdings": 25,
        "capital_usd": 10000000,
        "source": "wpr_audit_smoke_test",
        "fetch": true
      }
    }
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
