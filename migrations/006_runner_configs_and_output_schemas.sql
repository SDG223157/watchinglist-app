UPDATE skill_operation_metadata
SET
  output_schema = '{
    "type": "object",
    "additionalProperties": true,
    "properties": {
      "symbol": {"type": "string"},
      "as_of": {"type": "string"},
      "latest_close": {"type": "number"},
      "structure": {"type": "string"},
      "key_levels": {"type": "object", "additionalProperties": true},
      "indicators": {"type": "object", "additionalProperties": true},
      "evidence": {"type": "object", "additionalProperties": true},
      "trading_implication": {"type": "string"},
      "watch_next": {"type": "string"},
      "markdown": {"type": "string"}
    },
    "required": ["symbol", "as_of", "latest_close", "structure", "markdown"]
  }'::jsonb,
  operation_hints = COALESCE(operation_hints, '{}'::jsonb) || '{
    "runner_config": {
      "runner_kind": "built_in",
      "executor": "price_structure_analysis",
      "artifact_type": "price_structure_verdict",
      "timeout_ms": 120000,
      "env_policy": "process",
      "smoke_inputs": {
        "ticker": "AAPL",
        "source": "wpr_audit_smoke_test"
      }
    }
  }'::jsonb,
  updated_at = NOW()
WHERE registry_slug = 'price-structure-analysis';

UPDATE skill_operation_metadata
SET
  output_schema = '{
    "type": "object",
    "additionalProperties": true,
    "properties": {
      "event": {"type": "object", "additionalProperties": true},
      "markets": {"type": "array", "items": {"type": "object", "additionalProperties": true}},
      "mappings": {"type": "array", "items": {"type": "object", "additionalProperties": true}},
      "summary_md": {"type": "string"},
      "brief_md": {"type": "string"},
      "generated_at": {"type": "string"},
      "runner": {"type": "object", "additionalProperties": true}
    },
    "required": ["event", "markets", "mappings", "summary_md", "brief_md", "generated_at"]
  }'::jsonb,
  operation_hints = COALESCE(operation_hints, '{}'::jsonb) || '{
    "runner_config": {
      "runner_kind": "built_in",
      "executor": "polymarket_distiller",
      "entrypoint": "/Users/sdg223157/.cursor/skills/polymarket-distiller/scripts/distill.py",
      "artifact_type": "polymarket_distillation",
      "timeout_ms": 300000,
      "env_policy": "process",
      "smoke_inputs": {
        "slug": "democratic-presidential-nominee-2028",
        "source": "wpr_audit_smoke_test"
      }
    }
  }'::jsonb,
  updated_at = NOW()
WHERE registry_slug = 'polymarket-distiller';

UPDATE skill_operation_metadata
SET
  output_schema = '{
    "type": "object",
    "additionalProperties": true,
    "properties": {
      "runner": {"type": "object", "additionalProperties": true},
      "skill": {"type": "object", "additionalProperties": true},
      "inputs": {"type": "object", "additionalProperties": true},
      "metadata": {"type": ["object", "null"], "additionalProperties": true},
      "source_preview": {"type": ["string", "null"]},
      "generated_at": {"type": "string"}
    },
    "required": ["runner", "skill", "inputs", "generated_at"]
  }'::jsonb,
  operation_hints = COALESCE(operation_hints, '{}'::jsonb) || '{
    "runner_config": {
      "runner_kind": "generic",
      "executor": "generic_skill_invocation_packet",
      "artifact_type": "skill_invocation_packet",
      "timeout_ms": 30000,
      "env_policy": "none",
      "smoke_inputs": {
        "input": "WPR audit smoke test",
        "source": "wpr_audit_smoke_test",
        "dry_run": true
      }
    }
  }'::jsonb,
  updated_at = NOW()
WHERE registry_slug NOT IN ('price-structure-analysis', 'polymarket-distiller')
  AND registry_slug IN (
    SELECT slug
    FROM process_registry_items
    WHERE object_type = 'skill'
  );
