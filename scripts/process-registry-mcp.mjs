#!/usr/bin/env node

import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import YahooFinance from "yahoo-finance2";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(rootDir, ".env.local"), quiet: true });
dotenv.config({ path: resolve(rootDir, ".env"), quiet: true });

const SERVER_INFO = {
  name: "watchinglist-process-registry",
  version: "0.1.0",
};

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});
const execFileAsync = promisify(execFile);
const POLYMARKET_DISTILLER_PYTHON =
  process.env.POLYMARKET_DISTILLER_PYTHON || "/usr/local/bin/python3";
const POLYMARKET_DISTILLER_SCRIPT =
  "/Users/sdg223157/.cursor/skills/polymarket-distiller/scripts/distill.py";
const BOTBOARD_PRIVATE_DIR = "/Users/sdg223157/botboard-private";
const GENERIC_SKILL_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    input: { type: "string" },
    query: { type: "string" },
    ticker: { type: "string" },
    symbol: { type: "string" },
    url: { type: "string" },
    source: { type: "string" },
    operation_query: { type: "string" },
    args: { type: "array" },
    options: { type: "object", additionalProperties: true },
    dry_run: { type: "boolean" },
  },
};
const GENERIC_SKILL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    runner: { type: "object", additionalProperties: true },
    skill: { type: "object", additionalProperties: true },
    inputs: { type: "object", additionalProperties: true },
    metadata: { type: ["object", "null"], additionalProperties: true },
    source_preview: { type: ["string", "null"] },
    generated_at: { type: "string" },
  },
  required: ["runner", "skill", "inputs", "generated_at"],
};
const BUILT_IN_INPUT_SCHEMAS = {
  "price-structure-analysis": {
    type: "object",
    additionalProperties: false,
    properties: {
      ticker: { type: "string", minLength: 1 },
      symbol: { type: "string", minLength: 1 },
      operation_query: { type: "string" },
      source: { type: "string" },
    },
    anyOf: [{ required: ["ticker"] }, { required: ["symbol"] }],
  },
  "polymarket-distiller": {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", minLength: 1 },
      slug: { type: "string", minLength: 1 },
      event_id: { type: ["string", "integer"], minLength: 1 },
      url: { type: "string", minLength: 1 },
      event: { type: "string", minLength: 1 },
      input: { type: "string", minLength: 1 },
      ticker: { type: "string", minLength: 1 },
      symbol: { type: "string", minLength: 1 },
      mapped_only: { type: "boolean" },
      operation_query: { type: "string" },
      source: { type: "string" },
    },
    anyOf: [
      { required: ["query"] },
      { required: ["slug"] },
      { required: ["event_id"] },
      { required: ["url"] },
      { required: ["event"] },
      { required: ["input"] },
      { required: ["ticker"] },
      { required: ["symbol"] },
    ],
  },
};
const OUTPUT_SCHEMAS_BY_ARTIFACT_TYPE = {
  price_structure_verdict: {
    type: "object",
    additionalProperties: true,
    properties: {
      symbol: { type: "string" },
      as_of: { type: "string" },
      latest_close: { type: "number" },
      structure: { type: "string" },
      key_levels: { type: "object", additionalProperties: true },
      indicators: { type: "object", additionalProperties: true },
      evidence: { type: "object", additionalProperties: true },
      trading_implication: { type: "string" },
      watch_next: { type: "string" },
      markdown: { type: "string" },
    },
    required: ["symbol", "as_of", "latest_close", "structure", "markdown"],
  },
  polymarket_distillation: {
    type: "object",
    additionalProperties: true,
    properties: {
      event: { type: "object", additionalProperties: true },
      markets: { type: "array", items: { type: "object", additionalProperties: true } },
      mappings: { type: "array", items: { type: "object", additionalProperties: true } },
      summary_md: { type: "string" },
      brief_md: { type: "string" },
      generated_at: { type: "string" },
      runner: { type: "object", additionalProperties: true },
    },
    required: ["event", "markets", "mappings", "summary_md", "brief_md", "generated_at"],
  },
  skill_invocation_packet: GENERIC_SKILL_OUTPUT_SCHEMA,
};
const DEFAULT_RUNNER_CONFIGS = {
  "price-structure-analysis": {
    runner_kind: "built_in",
    executor: "price_structure_analysis",
    artifact_type: "price_structure_verdict",
    timeout_ms: 120000,
    env_policy: "process",
    smoke_inputs: {
      ticker: "AAPL",
      source: "wpr_audit_smoke_test",
    },
    artifact_contract: OUTPUT_SCHEMAS_BY_ARTIFACT_TYPE.price_structure_verdict,
  },
  "polymarket-distiller": {
    runner_kind: "built_in",
    executor: "polymarket_distiller",
    entrypoint: POLYMARKET_DISTILLER_SCRIPT,
    artifact_type: "polymarket_distillation",
    timeout_ms: 300000,
    env_policy: "process",
    smoke_inputs: {
      slug: "democratic-presidential-nominee-2028",
      source: "wpr_audit_smoke_test",
    },
    artifact_contract: OUTPUT_SCHEMAS_BY_ARTIFACT_TYPE.polymarket_distillation,
  },
};
const GENERIC_RUNNER_CONFIG = {
  runner_kind: "generic",
  executor: "generic_skill_invocation_packet",
  artifact_type: "skill_invocation_packet",
  timeout_ms: 30000,
  env_policy: "none",
  smoke_inputs: {
    input: "WPR audit smoke test",
    source: "wpr_audit_smoke_test",
    dry_run: true,
  },
  artifact_contract: OUTPUT_SCHEMAS_BY_ARTIFACT_TYPE.skill_invocation_packet,
};

const TOOLS = [
  {
    name: "list_process_registry",
    description:
      "List WatchingList Process Registry objects, optionally filtered by object type or status.",
    inputSchema: {
      type: "object",
      properties: {
        object_type: {
          type: "string",
          enum: ["skill", "pipeline", "process", "application", "template"],
        },
        status: {
          type: "string",
          enum: ["draft", "active", "review", "archived"],
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_process_registry_item",
    description: "Get one Process Registry object by slug.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
      },
      required: ["slug"],
      additionalProperties: false,
    },
  },
  {
    name: "get_skill_operation_metadata",
    description:
      "Get normalized operational metadata for a registry skill, including routing keywords, schemas, required tools, side effects, artifacts, approvals, and risk level.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
      },
      required: ["slug"],
      additionalProperties: false,
    },
  },
  {
    name: "create_process_run",
    description:
      "Create a pending process_runs row for an active registry object. This does not execute the run.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        inputs: {
          type: "object",
          additionalProperties: true,
        },
      },
      required: ["slug"],
      additionalProperties: false,
    },
  },
  {
    name: "trigger_process_run",
    description:
      "Execute a pending process run when a built-in runner exists, then save artifacts and update run status.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: {
          type: "integer",
          description: "process_runs.id to execute.",
        },
      },
      required: ["run_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_process_runs",
    description: "List recent process_runs rows for a registry object.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
      required: ["slug"],
      additionalProperties: false,
    },
  },
  {
    name: "list_process_artifacts",
    description:
      "List recent process_artifacts rows, optionally filtered by registry slug or artifact status.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        status: {
          type: "string",
          enum: ["needs_review", "approved", "published", "archived"],
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "suggest_data_operations",
    description:
      "Given an input such as AAPL, suggest available WatchingList operations, app URLs, and MCP tool calls for that data.",
    inputSchema: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "Ticker, slug, company name, or other data identifier.",
        },
      },
      required: ["input"],
      additionalProperties: false,
    },
  },
  {
    name: "resolve_operation_path",
    description:
      "Resolve shorthand paths like wpr/aapl/price structure into a WatchingList data input, matched operation, and next MCP/app action.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Slash path such as wpr/aapl/price structure, aapl/price structure, or AAPL/hmm entropy.",
        },
        execute: {
          type: "boolean",
          default: false,
          description:
            "When true, creates a pending run only if the matched registry object is active. Draft matches are never executed.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "import_skills_from_directory",
    description:
      "Import SKILL.md files from a local skills directory into process_registry_items as draft skill records.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description:
            "Directory containing skill subfolders. Defaults to /Users/sdg223157/.codex/skills.",
        },
        dry_run: {
          type: "boolean",
          default: false,
          description:
            "When true, parses files and returns planned rows without writing to Postgres.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "audit_process_registry_skills",
    description:
      "Audit all DB skills for metadata, input schemas, built-in runner coverage, and optional artifact-producing runner smoke tests.",
    inputSchema: {
      type: "object",
      properties: {
        run_built_ins: {
          type: "boolean",
          default: false,
          description:
            "When true, create and execute smoke-test runs for skills with built-in runners.",
        },
        run_all: {
          type: "boolean",
          default: false,
          description:
            "When true, create and execute smoke-test runs for every skill with any WPR runner, including generic safe runners.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "suggest_task_plan",
    description:
      "Given a natural-language user intent, suggest relevant WPR skills as building blocks and compile candidate task plans without executing them.",
    inputSchema: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "Natural-language user request or task intent.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 12,
        },
      },
      required: ["input"],
      additionalProperties: false,
    },
  },
];

let db;

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured in .env.local or .env");
  }
  db ??= neon(process.env.DATABASE_URL);
  return db;
}

function asJsonContent(value) {
  return [
    {
      type: "text",
      text: JSON.stringify(value, null, 2),
    },
  ];
}

function getLimit(value) {
  const n = Number(value ?? 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(50, Math.trunc(n)));
}

function normalizeInput(value) {
  return String(value ?? "").trim();
}

function looksLikeTicker(value) {
  return /^[A-Z0-9]{1,10}([.-][A-Z0-9]{1,6})?$/.test(value.toUpperCase());
}

function slugify(value) {
  return normalizeInput(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseFrontmatter(content) {
  if (!content.startsWith("---\n")) return {};

  const end = content.indexOf("\n---", 4);
  if (end === -1) return {};

  const lines = content.slice(4, end).split("\n");
  const frontmatter = {};

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.trim();

    if (value === ">-" || value === ">" || value === "|" || value === "|-") {
      const parts = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (/^[A-Za-z0-9_-]+:\s*/.test(next)) break;
        i += 1;
        if (next.trim()) parts.push(next.trim());
      }
      frontmatter[key] = parts.join(" ");
      continue;
    }

    frontmatter[key] = value.replace(/^['"]|['"]$/g, "");
  }

  return frontmatter;
}

function getBodyPreview(content) {
  const bodyStart = content.startsWith("---\n")
    ? content.indexOf("\n---", 4) + 4
    : 0;

  return content
    .slice(Math.max(bodyStart, 0))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function wordsFromText(text) {
  return unique(
    normalizeInput(text)
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []
  );
}

function parseCsvField(value) {
  if (!value) return [];
  return normalizeInput(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractRequiredTools(frontmatter, content) {
  const values = [
    ...parseCsvField(frontmatter.tools),
    ...parseCsvField(frontmatter["allowed-tools"]),
  ];
  const text = content.toLowerCase();

  const commonTools = [
    ["mcp", "mcp"],
    ["psql", "psql"],
    ["python", "python"],
    ["node", "node"],
    ["npm", "npm"],
    ["yfinance", "yfinance"],
    ["ffmpeg", "ffmpeg"],
    ["manim", "manim"],
    ["notebooklm", "notebooklm"],
    ["youtube", "youtube"],
    ["obsidian", "obsidian"],
    ["tmux", "tmux"],
  ];

  for (const [needle, tool] of commonTools) {
    if (text.includes(needle)) values.push(tool);
  }

  return unique(values).map((name) => ({ name }));
}

function inferSideEffects(content) {
  const text = content.toLowerCase();
  const sideEffects = [];

  if (text.includes("save") || text.includes("write")) sideEffects.push("writes_files");
  if (text.includes("database") || text.includes("db") || text.includes("neon")) {
    sideEffects.push("writes_database");
  }
  if (text.includes("post to x") || text.includes("tweet")) sideEffects.push("external_post");
  if (text.includes("youtube") || text.includes("upload")) sideEffects.push("external_upload");
  if (text.includes("create meeting") || text.includes("create_post")) {
    sideEffects.push("creates_meeting");
  }
  if (text.includes("send") || text.includes("notify")) sideEffects.push("sends_notification");

  return unique(sideEffects);
}

function inferArtifactTypes(content) {
  const text = content.toLowerCase();
  const artifactTypes = [];

  if (text.includes("report")) artifactTypes.push("report");
  if (text.includes("chart")) artifactTypes.push("chart");
  if (text.includes("dataset") || text.includes("csv")) artifactTypes.push("dataset");
  if (text.includes("meeting")) artifactTypes.push("meeting_topic");
  if (text.includes("video")) artifactTypes.push("video");
  if (text.includes("audio") || text.includes("podcast")) artifactTypes.push("audio");
  if (text.includes("slide")) artifactTypes.push("slides");
  if (text.includes("image") || text.includes("thumbnail")) artifactTypes.push("image");
  if (text.includes("thread") || text.includes("tweet")) artifactTypes.push("social_post");
  if (text.includes("memo") || text.includes("verdict")) artifactTypes.push("decision_memo");

  return unique(artifactTypes);
}

function inferApprovalRequirements(content, sideEffects) {
  const text = content.toLowerCase();
  const approvals = [];

  if (text.includes("stop") || text.includes("approval")) approvals.push("human_review");
  if (sideEffects.includes("external_post")) approvals.push("before_external_post");
  if (sideEffects.includes("external_upload")) approvals.push("before_external_upload");
  if (sideEffects.includes("creates_meeting")) approvals.push("before_meeting_creation");

  return unique(approvals);
}

function inferRiskLevel(sideEffects, approvalRequirements) {
  if (
    sideEffects.includes("external_post") ||
    sideEffects.includes("external_upload")
  ) {
    return "high";
  }
  if (
    sideEffects.includes("writes_database") ||
    sideEffects.includes("creates_meeting") ||
    approvalRequirements.length > 0
  ) {
    return "medium";
  }
  return "low";
}

function buildSkillOperationMetadata(skill, content, frontmatter) {
  const descriptionWords = wordsFromText(skill.description);
  const bodyWords = wordsFromText(content).slice(0, 80);
  const routingKeywords = unique([
    skill.slug,
    skill.name,
    ...(skill.tags ?? []),
    ...descriptionWords.slice(0, 35),
  ]);
  const triggerTerms = unique([
    ...(frontmatter.name ? [frontmatter.name] : []),
    ...descriptionWords.slice(0, 25),
  ]);
  const sideEffects = inferSideEffects(content);
  const artifactTypes = inferArtifactTypes(content);
  const approvalRequirements = inferApprovalRequirements(content, sideEffects);
  const inputSchema = BUILT_IN_INPUT_SCHEMAS[skill.slug] ?? GENERIC_SKILL_INPUT_SCHEMA;
  const runnerConfig = DEFAULT_RUNNER_CONFIGS[skill.slug] ?? GENERIC_RUNNER_CONFIG;
  const outputSchema =
    runnerConfig.artifact_contract ?? OUTPUT_SCHEMAS_BY_ARTIFACT_TYPE[runnerConfig.artifact_type] ?? {
      type: "object",
      additionalProperties: true,
    };

  return {
    registry_slug: skill.slug,
    source_kind: "codex_skill_folder",
    source_path: skill.config.source_path,
    trigger_terms: triggerTerms,
    routing_keywords: routingKeywords,
    input_schema: inputSchema,
    output_schema: {
      ...outputSchema,
    },
    required_tools: extractRequiredTools(frontmatter, content),
    side_effects: sideEffects,
    artifact_types: artifactTypes,
    approval_requirements: approvalRequirements,
    operation_hints: {
      source_name: frontmatter.name ?? skill.name,
      source_slug: skill.config.source_slug,
      description_terms: descriptionWords.slice(0, 50),
      body_terms: bodyWords,
      runner_config: runnerConfig,
    },
    risk_level: inferRiskLevel(sideEffects, approvalRequirements),
  };
}

async function readSkillFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const skillDir = resolve(directory, entry.name);
    const skillPath = resolve(skillDir, "SKILL.md");

    try {
      const content = await readFile(skillPath, "utf8");
      const frontmatter = parseFrontmatter(content);
      const sourceSlug = slugify(entry.name);
      const name = frontmatter.name || entry.name;
      const description =
        frontmatter.description || `Imported Codex skill from ${skillPath}`;

      skills.push({
        slug: sourceSlug,
        object_type: "skill",
        name,
        status: "draft",
        version: 1,
        description,
        tags: ["skill", "imported", sourceSlug],
        config: {
          source: "codex_skill_folder",
          source_path: skillPath,
          source_slug: entry.name,
          source_name: frontmatter.name ?? null,
          frontmatter,
          body_preview: getBodyPreview(content),
        },
        operation_metadata: null,
      });
      skills[skills.length - 1].operation_metadata = buildSkillOperationMetadata(
        skills[skills.length - 1],
        content,
        frontmatter
      );
    } catch (err) {
      if (err?.code !== "ENOENT" && err?.code !== "ENOTDIR") {
        throw err;
      }
    }
  }

  return skills.sort((a, b) => a.slug.localeCompare(b.slug));
}

function summarizeRegistry(items) {
  const summary = {
    total: items.length,
    active: 0,
    draft: 0,
    review: 0,
    archived: 0,
    byType: {
      skill: 0,
      pipeline: 0,
      process: 0,
      application: 0,
      template: 0,
    },
  };

  for (const item of items) {
    summary[item.status] += 1;
    summary.byType[item.object_type] += 1;
  }

  return summary;
}

async function listProcessRegistry(args = {}) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      slug,
      object_type,
      name,
      status,
      version,
      description,
      tags,
      config,
      updated_at::text AS updated_at
    FROM process_registry_items
    WHERE (${args.object_type ?? null}::text IS NULL OR object_type = ${args.object_type ?? null})
      AND (${args.status ?? null}::text IS NULL OR status = ${args.status ?? null})
    ORDER BY
      CASE object_type
        WHEN 'skill' THEN 1
        WHEN 'pipeline' THEN 2
        WHEN 'process' THEN 3
        WHEN 'application' THEN 4
        WHEN 'template' THEN 5
        ELSE 6
      END,
      name
  `;

  return {
    summary: summarizeRegistry(rows),
    items: rows,
  };
}

async function getProcessRegistryItem(args = {}) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      slug,
      object_type,
      name,
      status,
      version,
      description,
      tags,
      config,
      updated_at::text AS updated_at
    FROM process_registry_items
    WHERE slug = ${args.slug}
    LIMIT 1
  `;

  if (!rows[0]) {
    throw new Error(`No registry item found for slug: ${args.slug}`);
  }

  return rows[0];
}

async function getSkillOperationMetadata(args = {}) {
  const sql = getDb();
  const rows = await sql`
    SELECT
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
      risk_level,
      updated_at::text AS updated_at
    FROM skill_operation_metadata
    WHERE registry_slug = ${args.slug}
    LIMIT 1
  `;

  if (!rows[0]) {
    throw new Error(`No skill operation metadata found for slug: ${args.slug}`);
  }

  return rows[0];
}

async function getSkillOperationMetadataOptional(slug) {
  try {
    return await getSkillOperationMetadata({ slug });
  } catch (err) {
    if (err instanceof Error && err.message.includes("No skill operation metadata")) {
      return null;
    }
    throw err;
  }
}

function getInputSchema(item, metadata) {
  const schema = metadata?.input_schema ?? item.config?.input_schema ?? {};
  if (schema?.inferred && BUILT_IN_INPUT_SCHEMAS[item.slug]) {
    return BUILT_IN_INPUT_SCHEMAS[item.slug];
  }
  if (schema?.inferred && item.object_type === "skill") {
    return GENERIC_SKILL_INPUT_SCHEMA;
  }
  return schema;
}

function getRequiredInputFields(item, metadata) {
  const schema = getInputSchema(item, metadata);
  return unique([
    ...(Array.isArray(schema.required) ? schema.required : []),
    ...(Array.isArray(item.config?.required_inputs) ? item.config.required_inputs : []),
  ]);
}

function hasInputValue(inputs, key) {
  const value = inputs?.[key];
  if (value == null) return false;
  return typeof value !== "string" || value.trim().length > 0;
}

function getMissingRequiredInputs(item, inputs = {}, metadata = null) {
  return getRequiredInputFields(item, metadata).filter((key) => !hasInputValue(inputs, key));
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function getValueType(value) {
  if (value == null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function formatSchemaPath(path) {
  return path || "inputs";
}

function matchesJsonType(value, type) {
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isPlainObject(value);
  if (type === "null") return value == null;
  return typeof value === type;
}

function validateJsonValueAgainstSchema(value, schema = {}, path = "inputs") {
  if (!isPlainObject(schema)) return [];

  const errors = [];
  const allowedTypes = Array.isArray(schema.type)
    ? schema.type
    : schema.type
    ? [schema.type]
    : [];

  if (allowedTypes.length && !allowedTypes.some((type) => matchesJsonType(value, type))) {
    errors.push(
      `${formatSchemaPath(path)} must be ${allowedTypes.join(" or ")}, got ${getValueType(value)}`
    );
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${formatSchemaPath(path)} must be one of: ${schema.enum.join(", ")}`);
  }

  if (typeof value === "string") {
    if (schema.minLength != null && value.length < Number(schema.minLength)) {
      errors.push(`${formatSchemaPath(path)} must have length >= ${schema.minLength}`);
    }
    if (schema.maxLength != null && value.length > Number(schema.maxLength)) {
      errors.push(`${formatSchemaPath(path)} must have length <= ${schema.maxLength}`);
    }
    if (schema.pattern) {
      const pattern = new RegExp(schema.pattern);
      if (!pattern.test(value)) {
        errors.push(`${formatSchemaPath(path)} must match /${schema.pattern}/`);
      }
    }
  }

  if (typeof value === "number") {
    if (schema.minimum != null && value < Number(schema.minimum)) {
      errors.push(`${formatSchemaPath(path)} must be >= ${schema.minimum}`);
    }
    if (schema.maximum != null && value > Number(schema.maximum)) {
      errors.push(`${formatSchemaPath(path)} must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < Number(schema.minItems)) {
      errors.push(`${formatSchemaPath(path)} must contain at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems != null && value.length > Number(schema.maxItems)) {
      errors.push(`${formatSchemaPath(path)} must contain at most ${schema.maxItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateJsonValueAgainstSchema(item, schema.items, `${path}[${index}]`));
      });
    }
  }

  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};

    const requiredKeys = Array.isArray(schema.required) ? schema.required : [];
    for (const key of requiredKeys) {
      if (!hasInputValue(value, key)) {
        errors.push(`${formatSchemaPath(path)}.${key} is required`);
      }
    }

    if (schema.additionalProperties === false) {
      const allowedKeys = new Set(Object.keys(properties));
      for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
          errors.push(`${formatSchemaPath(path)}.${key} is not allowed`);
        }
      }
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (value[key] == null) continue;
      errors.push(...validateJsonValueAgainstSchema(value[key], propertySchema, `${path}.${key}`));
    }
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const optionErrors = schema.anyOf.map((option) =>
      validateJsonValueAgainstSchema(value, option, path)
    );
    if (!optionErrors.some((option) => option.length === 0)) {
      errors.push(
        `${formatSchemaPath(path)} must satisfy at least one argument shape: ${optionErrors
          .map((option) => option[0])
          .filter(Boolean)
          .join("; ")}`
      );
    }
  }

  return errors;
}

function validateProcessRunInputs(item, inputs, metadata) {
  const missing = getMissingRequiredInputs(item, inputs, metadata);
  const schemaErrors = validateJsonValueAgainstSchema(inputs, getInputSchema(item, metadata));
  const errors = [
    ...missing.map((key) => `missing required input: ${key}`),
    ...schemaErrors,
  ];

  if (errors.length === 0) return;

  throw new Error(
    `Invalid inputs for ${item.slug}: ${errors.join("; ")}`
  );
}

function getOutputSchema(metadata, runner, artifactType) {
  const metadataSchema = metadata?.output_schema;
  if (hasConcreteInputSchema(metadataSchema)) return metadataSchema;
  if (runner?.artifact_contract) return runner.artifact_contract;
  return OUTPUT_SCHEMAS_BY_ARTIFACT_TYPE[artifactType] ?? {
    type: "object",
    additionalProperties: true,
  };
}

function validateArtifactJsonContent(registrySlug, artifactType, jsonContent, metadata, runner) {
  const schema = getOutputSchema(metadata, runner, artifactType);
  const errors = validateJsonValueAgainstSchema(jsonContent, schema, "artifact.json_content");
  if (errors.length === 0) return;

  throw new Error(
    `Invalid artifact for ${registrySlug}/${artifactType}: ${errors.join("; ")}`
  );
}

async function createProcessRun(args = {}) {
  const sql = getDb();
  const item = await getProcessRegistryItem(args);

  if (item.status !== "active") {
    throw new Error(
      `Registry item ${item.slug} is ${item.status}; only active objects can create runs.`
    );
  }

  const inputs = args.inputs ?? {};
  const metadata = await getSkillOperationMetadataOptional(item.slug);
  validateProcessRunInputs(item, inputs, metadata);

  const rows = await sql`
    INSERT INTO process_runs (
      registry_slug,
      registry_version,
      status,
      inputs,
      state
    )
    VALUES (
      ${item.slug},
      ${item.version},
      'pending',
      ${JSON.stringify(inputs)}::jsonb,
      ${JSON.stringify({ created_by: SERVER_INFO.name })}::jsonb
    )
    RETURNING
      id,
      registry_slug,
      registry_version,
      status,
      inputs,
      state,
      created_at::text AS created_at
  `;

  return rows[0];
}

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function average(values) {
  const nums = values.map(numeric).filter((value) => value != null);
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function movingAverage(bars, days, field = "close") {
  if (bars.length < days) return null;
  return average(bars.slice(-days).map((bar) => bar[field]));
}

function round(value, digits = 2) {
  const n = numeric(value);
  if (n == null) return null;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function pct(value, digits = 2) {
  const n = numeric(value);
  if (n == null) return null;
  return round(n * 100, digits);
}

async function fetchDailyBars(symbol) {
  const period2 = new Date();
  const period1 = new Date();
  period1.setDate(period1.getDate() - 430);

  const rows = await yahooFinance.historical(symbol.toUpperCase(), {
    period1,
    period2,
    interval: "1d",
  });

  return rows
    .map((row) => ({
      date: row.date,
      open: numeric(row.open),
      high: numeric(row.high),
      low: numeric(row.low),
      close: numeric(row.close),
      volume: numeric(row.volume),
    }))
    .filter(
      (row) =>
        row.date instanceof Date &&
        row.high != null &&
        row.low != null &&
        row.close != null
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function classifyTrendSequence(bars) {
  if (bars.length < 45) return "Insufficient history";

  const recent = bars.slice(-20);
  const previous = bars.slice(-40, -20);
  const recentHigh = Math.max(...recent.map((bar) => bar.high));
  const recentLow = Math.min(...recent.map((bar) => bar.low));
  const previousHigh = Math.max(...previous.map((bar) => bar.high));
  const previousLow = Math.min(...previous.map((bar) => bar.low));

  if (recentHigh > previousHigh && recentLow > previousLow) {
    return "Bullish: higher high + higher low";
  }
  if (recentHigh < previousHigh && recentLow < previousLow) {
    return "Bearish: lower high + lower low";
  }
  if (recentHigh > previousHigh && recentLow < previousLow) {
    return "Expanding volatility: higher high + lower low";
  }
  if (recentHigh < previousHigh && recentLow > previousLow) {
    return "Compression: lower high + higher low";
  }
  return "Range/noise";
}

function buildPriceStructureMarkdown(analysis) {
  const levels = analysis.key_levels;

  return `## Price Structure Verdict

**Structure:** ${analysis.structure}

**Key levels:** Support = ${levels.support}, resistance = ${levels.resistance}, invalidation = ${levels.invalidation}

**Evidence:**
- Range: ${analysis.evidence.range}
- Breakout/hold/fail: ${analysis.evidence.breakout_quality}
- Trend sequence: ${analysis.evidence.trend_sequence}
- Moving averages: ${analysis.evidence.moving_averages}
- Volume/volatility: ${analysis.evidence.volume_volatility}
- Slope/order: ${analysis.evidence.slope_order}

**Trading implication:**
${analysis.trading_implication}

**Watch next:**
${analysis.watch_next}
`;
}

function analyzePriceStructure(symbol, bars) {
  if (bars.length < 80) {
    throw new Error(`Need at least 80 daily bars for price structure; got ${bars.length}`);
  }

  const latest = bars[bars.length - 1];
  const prior = bars[bars.length - 2];
  const rangeBars = bars.slice(-61, -1);
  const rangeHigh = Math.max(...rangeBars.map((bar) => bar.high));
  const rangeLow = Math.min(...rangeBars.map((bar) => bar.low));
  const rangeMid = (rangeHigh + rangeLow) / 2;
  const ma20 = movingAverage(bars, 20);
  const ma50 = movingAverage(bars, 50);
  const ma200 = movingAverage(bars, 200);
  const avgVolume20 = average(bars.slice(-21, -1).map((bar) => bar.volume));
  const volumeRatio =
    avgVolume20 && latest.volume ? latest.volume / avgVolume20 : null;
  const trendSequence = classifyTrendSequence(bars);
  const rangeWidthPct = (rangeHigh - rangeLow) / rangeMid;
  const distanceFromMa20 = ma20 ? latest.close / ma20 - 1 : null;

  let breakoutQuality = "Inside active range";
  if (latest.close > rangeHigh) {
    breakoutQuality = prior.close > rangeHigh ? "Breakout holding above range" : "Early breakout above range";
  } else if (latest.high > rangeHigh && latest.close <= rangeHigh) {
    breakoutQuality = "Failed breakout risk: intraday break closed back below resistance";
  } else if (latest.close < rangeLow) {
    breakoutQuality = "Breakdown below range support";
  }

  let movingAverages = "Mixed/unclear moving-average alignment";
  if (ma20 && ma50 && latest.close > ma20 && ma20 > ma50 && (!ma200 || ma50 > ma200)) {
    movingAverages = "Bullish alignment: price above rising short/intermediate structure";
  } else if (ma20 && ma50 && latest.close < ma20 && ma20 < ma50) {
    movingAverages = "Bearish alignment: price below short/intermediate structure";
  } else if (ma20 && latest.close > ma20) {
    movingAverages = "Constructive but not fully aligned";
  }

  const volumeText =
    volumeRatio == null
      ? "Volume confirmation unavailable"
      : volumeRatio >= 1.3
        ? `Volume confirms expansion at ${round(volumeRatio, 2)}x recent average`
        : `Volume is not strongly confirming at ${round(volumeRatio, 2)}x recent average`;

  const isExtended = distanceFromMa20 != null && distanceFromMa20 > 0.12;
  let slopeOrder = "Normal slope/order";
  if (isExtended && volumeRatio != null && volumeRatio > 1.5) {
    slopeOrder = "Unstable momentum risk: extended above 20-day average with heavy volume";
  } else if (distanceFromMa20 != null && distanceFromMa20 > 0.06) {
    slopeOrder = "Momentum: price extended above short-term mean";
  } else if (rangeWidthPct < 0.08) {
    slopeOrder = "Compression: narrow range, breakout pending";
  }

  let structure = "Range";
  let tradingImplication =
    "Volatility expansion alone is not enough; direction needs breakout quality and follow-through.";
  let watchNext = `The decisive test is whether ${symbol} can hold above ${round(rangeHigh)} or lose ${round(rangeLow)}.`;
  let invalidation = rangeLow;

  if (breakoutQuality.startsWith("Failed")) {
    structure = "Failed Breakout Risk";
    invalidation = rangeHigh;
    tradingImplication =
      "Breakout quality is weak because price could not hold above resistance.";
  } else if (latest.close > rangeHigh && trendSequence.startsWith("Bullish")) {
    structure = volumeRatio != null && volumeRatio >= 1.1
      ? "Bullish Breakout"
      : "Early Breakout, Unconfirmed";
    invalidation = rangeHigh;
    tradingImplication =
      "Direction is constructive if old resistance becomes support and follow-through continues.";
    watchNext = `Watch whether ${symbol} holds old resistance near ${round(rangeHigh)} as support.`;
  } else if (latest.close < rangeLow) {
    structure = "Bearish Breakdown";
    invalidation = rangeLow;
    tradingImplication =
      "Structure is bearish until price recovers the broken support area.";
    watchNext = `Watch whether ${symbol} can reclaim support near ${round(rangeLow)}.`;
  } else if (trendSequence.startsWith("Compression")) {
    structure = "Compression";
  } else if (slopeOrder.startsWith("Unstable")) {
    structure = "Unstable Momentum";
  }

  const analysis = {
    symbol,
    as_of: latest.date.toISOString().slice(0, 10),
    latest_close: round(latest.close),
    structure,
    key_levels: {
      support: round(rangeLow),
      resistance: round(rangeHigh),
      midpoint: round(rangeMid),
      invalidation: round(invalidation),
    },
    indicators: {
      ma20: round(ma20),
      ma50: round(ma50),
      ma200: round(ma200),
      volume_ratio_20d: round(volumeRatio, 2),
      distance_from_ma20_pct: pct(distanceFromMa20),
      range_width_pct: pct(rangeWidthPct),
    },
    evidence: {
      range: `Last 60-session range is ${round(rangeLow)} to ${round(rangeHigh)}; current close is ${round(latest.close)}.`,
      breakout_quality: breakoutQuality,
      trend_sequence: trendSequence,
      moving_averages: movingAverages,
      volume_volatility: volumeText,
      slope_order: slopeOrder,
    },
    trading_implication: tradingImplication,
    watch_next: watchNext,
  };

  return {
    ...analysis,
    markdown: buildPriceStructureMarkdown(analysis),
  };
}

async function executePriceStructureRun(run) {
  const symbol = normalizeInput(run.inputs?.ticker || run.inputs?.symbol).toUpperCase();
  if (!symbol) throw new Error("price-structure-analysis requires inputs.ticker");

  const bars = await fetchDailyBars(symbol);
  const analysis = analyzePriceStructure(symbol, bars);
  const metadata = await getSkillOperationMetadataOptional(run.registry_slug);
  const runner = getRunnerInfo(run.registry_slug, metadata);
  validateArtifactJsonContent(
    run.registry_slug,
    "price_structure_verdict",
    analysis,
    metadata,
    runner
  );
  const sql = getDb();
  const artifactRows = await sql`
    INSERT INTO process_artifacts (
      run_id,
      registry_slug,
      artifact_type,
      title,
      status,
      json_content,
      created_by_step,
      visibility
    )
    VALUES (
      ${run.id},
      ${run.registry_slug},
      'price_structure_verdict',
      ${`${symbol} Price Structure Verdict`},
      'needs_review',
      ${JSON.stringify(analysis)}::jsonb,
      'execute_price_structure_run',
      'private'
    )
    RETURNING
      id,
      run_id,
      registry_slug,
      artifact_type,
      title,
      status,
      json_content,
      created_at::text AS created_at
  `;

  return {
    output: {
      symbol,
      structure: analysis.structure,
      latest_close: analysis.latest_close,
      artifact_id: artifactRows[0].id,
    },
    artifacts: artifactRows,
  };
}

function buildPolymarketDistillerArgs(inputs = {}) {
  const args = [POLYMARKET_DISTILLER_SCRIPT];

  if (inputs.event_id) {
    args.push("--event-id", String(inputs.event_id));
  } else if (inputs.slug) {
    args.push("--slug", String(inputs.slug));
  } else {
    const query = normalizeInput(
      inputs.query || inputs.url || inputs.event || inputs.input || inputs.ticker || inputs.symbol
    );
    if (!query) {
      throw new Error(
        "polymarket-distiller requires inputs.query, inputs.slug, inputs.event_id, inputs.url, or inputs.ticker"
      );
    }
    args.push(query);
  }

  if (inputs.mapped_only === true) args.push("--mapped-only");
  args.push("--json");
  return args;
}

function parsePolymarketDistillerOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) throw new Error("polymarket-distiller returned empty output");

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `polymarket-distiller returned non-JSON output: ${text.slice(0, 500)}`
    );
  }
}

async function executePolymarketDistillerRun(run) {
  const args = buildPolymarketDistillerArgs(run.inputs ?? {});
  let stdout = "";
  let stderr = "";

  try {
    const result = await execFileAsync(POLYMARKET_DISTILLER_PYTHON, args, {
      cwd: BOTBOARD_PRIVATE_DIR,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err) {
    stdout = err?.stdout ?? "";
    stderr = err?.stderr ?? "";
    const detail = stderr || stdout || (err instanceof Error ? err.message : String(err));
    throw new Error(`polymarket-distiller failed: ${String(detail).trim().slice(0, 1000)}`);
  }

  const distillation = parsePolymarketDistillerOutput(stdout);
  const event = distillation.event ?? {};
  const artifactContent = {
    ...distillation,
    runner: {
      command: POLYMARKET_DISTILLER_PYTHON,
      args,
      stderr: stderr.trim() || null,
    },
  };
  const metadata = await getSkillOperationMetadataOptional(run.registry_slug);
  const runner = getRunnerInfo(run.registry_slug, metadata);
  validateArtifactJsonContent(
    run.registry_slug,
    "polymarket_distillation",
    artifactContent,
    metadata,
    runner
  );
  const sql = getDb();
  const artifactRows = await sql`
    INSERT INTO process_artifacts (
      run_id,
      registry_slug,
      artifact_type,
      title,
      status,
      json_content,
      created_by_step,
      visibility
    )
    VALUES (
      ${run.id},
      ${run.registry_slug},
      'polymarket_distillation',
      ${`Polymarket Distillation - ${event.title ?? event.slug ?? "event"}`},
      'needs_review',
      ${JSON.stringify(artifactContent)}::jsonb,
      'execute_polymarket_distiller_run',
      'private'
    )
    RETURNING
      id,
      run_id,
      registry_slug,
      artifact_type,
      title,
      status,
      json_content,
      created_at::text AS created_at
  `;

  return {
    output: {
      event_id: event.id ?? null,
      event_slug: event.slug ?? null,
      event_title: event.title ?? null,
      market_count: distillation.markets?.length ?? 0,
      mapping_count: distillation.mappings?.length ?? 0,
      artifact_id: artifactRows[0].id,
    },
    artifacts: artifactRows,
  };
}

function getBuiltInRunnerInfo(slug) {
  return normalizeRunnerConfig(slug, DEFAULT_RUNNER_CONFIGS[slug]);
}

function normalizeRunnerConfig(slug, config) {
  if (!isPlainObject(config)) return null;
  return {
    slug,
    name:
      config.name ??
      (config.runner_kind === "generic"
        ? "Generic Skill Invocation Packet"
        : config.executor ?? config.runner_kind),
    runner_kind: config.runner_kind,
    executor: config.executor ?? config.runner_kind,
    entrypoint: config.entrypoint ?? null,
    artifact_type: config.artifact_type,
    timeout_ms: config.timeout_ms ?? null,
    env_policy: config.env_policy ?? "none",
    smoke_inputs: config.smoke_inputs ?? {},
    artifact_contract:
      config.artifact_contract ??
      OUTPUT_SCHEMAS_BY_ARTIFACT_TYPE[config.artifact_type] ??
      null,
  };
}

function getRunnerInfo(itemOrSlug, metadata = null) {
  const slug = typeof itemOrSlug === "string" ? itemOrSlug : itemOrSlug?.slug;
  const dbRunner = normalizeRunnerConfig(slug, metadata?.operation_hints?.runner_config);
  if (dbRunner) return dbRunner;

  const builtIn = getBuiltInRunnerInfo(slug);
  if (builtIn) return { ...builtIn, runner_kind: "built_in" };

  const objectType = typeof itemOrSlug === "string" ? "skill" : itemOrSlug?.object_type;
  if (objectType === "skill") {
    return normalizeRunnerConfig(slug, GENERIC_RUNNER_CONFIG);
  }

  return null;
}

async function executeGenericSkillRun(run) {
  const item = await getProcessRegistryItem({ slug: run.registry_slug });
  const metadata = await getSkillOperationMetadataOptional(run.registry_slug);
  const sourcePath = metadata?.source_path ?? item.config?.source_path ?? null;
  let sourcePreview = null;

  if (sourcePath) {
    try {
      sourcePreview = (await readFile(sourcePath, "utf8")).slice(0, 12000);
    } catch (err) {
      sourcePreview = `Unable to read source path ${sourcePath}: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }

  const packet = {
    runner: {
      kind: "generic_skill_invocation_packet",
      note:
        "This safe WPR runner creates a durable invocation artifact. It does not perform external side effects or execute the skill-specific workflow.",
    },
    skill: {
      slug: item.slug,
      name: item.name,
      status: item.status,
      version: item.version,
      description: item.description,
      tags: item.tags ?? [],
      source_path: sourcePath,
    },
    inputs: run.inputs ?? {},
    metadata: metadata
      ? {
          risk_level: metadata.risk_level,
          required_tools: metadata.required_tools ?? [],
          side_effects: metadata.side_effects ?? [],
          artifact_types: metadata.artifact_types ?? [],
          approval_requirements: metadata.approval_requirements ?? [],
          input_schema: getInputSchema(item, metadata),
        }
      : null,
    source_preview: sourcePreview,
    generated_at: new Date().toISOString(),
  };
  const runner = getRunnerInfo(item, metadata);
  validateArtifactJsonContent(
    run.registry_slug,
    "skill_invocation_packet",
    packet,
    metadata,
    runner
  );

  const sql = getDb();
  const artifactRows = await sql`
    INSERT INTO process_artifacts (
      run_id,
      registry_slug,
      artifact_type,
      title,
      status,
      json_content,
      created_by_step,
      visibility
    )
    VALUES (
      ${run.id},
      ${run.registry_slug},
      'skill_invocation_packet',
      ${`${item.name} WPR Invocation Packet`},
      'needs_review',
      ${JSON.stringify(packet)}::jsonb,
      'execute_generic_skill_run',
      'private'
    )
    RETURNING
      id,
      run_id,
      registry_slug,
      artifact_type,
      title,
      status,
      json_content,
      created_at::text AS created_at
  `;

  return {
    output: {
      runner_kind: "generic",
      artifact_id: artifactRows[0].id,
      artifact_type: "skill_invocation_packet",
      source_path: sourcePath,
    },
    artifacts: artifactRows,
  };
}

function hasConcreteInputSchema(schema = {}) {
  if (!isPlainObject(schema)) return false;
  if (schema.inferred === true) return false;
  return Boolean(
    schema.properties ||
      schema.required ||
      schema.anyOf ||
      schema.oneOf ||
      schema.additionalProperties === false
  );
}

function getSchemaStatus(schema = {}) {
  if (!isPlainObject(schema) || Object.keys(schema).length === 0) return "missing";
  if (schema.inferred === true) return "inferred";
  if (hasConcreteInputSchema(schema)) return "typed";
  return "permissive";
}

async function auditProcessRegistrySkills(args = {}) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      r.slug,
      r.object_type,
      r.name,
      r.status,
      r.version,
      r.description,
      r.tags,
      r.config,
      r.updated_at::text AS updated_at,
      m.registry_slug AS metadata_slug,
      m.input_schema,
      m.output_schema,
      m.required_tools,
      m.side_effects,
      m.artifact_types,
      m.approval_requirements,
      m.operation_hints,
      m.risk_level
    FROM process_registry_items r
    LEFT JOIN skill_operation_metadata m ON m.registry_slug = r.slug
    WHERE r.object_type = 'skill'
    ORDER BY r.slug
  `;

  const skills = rows.map((row) => {
    const item = {
      slug: row.slug,
      object_type: row.object_type,
      name: row.name,
      status: row.status,
      version: row.version,
      description: row.description,
      tags: row.tags,
      config: row.config,
      updated_at: row.updated_at,
    };
    const metadata = row.metadata_slug
      ? {
          input_schema: row.input_schema ?? {},
          output_schema: row.output_schema ?? {},
          required_tools: row.required_tools ?? [],
          side_effects: row.side_effects ?? [],
          artifact_types: row.artifact_types ?? [],
          approval_requirements: row.approval_requirements ?? [],
          operation_hints: row.operation_hints ?? {},
          risk_level: row.risk_level ?? "low",
        }
      : null;
    const inputSchema = getInputSchema(item, metadata);
    const runner = getRunnerInfo(item, metadata);
    const validationErrors = [];

    if (!metadata) validationErrors.push("missing skill_operation_metadata");
    if (getSchemaStatus(inputSchema) !== "typed") validationErrors.push("input schema is not typed");
    if (!runner) validationErrors.push("no WPR runner");

    if (runner) {
      try {
        validateProcessRunInputs(item, runner.smoke_inputs, metadata);
      } catch (err) {
        validationErrors.push(err instanceof Error ? err.message : String(err));
      }
    }

    return {
      slug: row.slug,
      name: row.name,
      status: row.status,
      metadata_present: Boolean(metadata),
      input_schema_status: getSchemaStatus(inputSchema),
      runner_status: runner?.runner_kind ?? "missing",
      runner_artifact_type: runner?.artifact_type ?? null,
      smoke_inputs: runner?.smoke_inputs ?? null,
      issues: validationErrors,
    };
  });

  const smokeRuns = [];
  if (args.run_built_ins === true || args.run_all === true) {
    const smokeableSkills = skills.filter((entry) =>
      args.run_all === true
        ? entry.runner_status !== "missing"
        : entry.runner_status === "built_in"
    );
    for (const skill of smokeableSkills) {
      try {
        const run = await createProcessRun({
          slug: skill.slug,
          inputs: skill.smoke_inputs,
        });
        const result = await triggerProcessRun({ run_id: Number(run.id) });
        smokeRuns.push({
          slug: skill.slug,
          run_id: result.run?.id ?? run.id,
          status: result.run?.status ?? result.status,
          artifact_ids: (result.artifacts ?? []).map((artifact) => artifact.id),
          artifact_count: result.artifacts?.length ?? 0,
          output: result.run?.outputs ?? null,
          error: null,
        });
      } catch (err) {
        smokeRuns.push({
          slug: skill.slug,
          run_id: null,
          status: "failed",
          artifact_ids: [],
          artifact_count: 0,
          output: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const summary = {
    total_skills: skills.length,
    active_skills: skills.filter((skill) => skill.status === "active").length,
    metadata_present: skills.filter((skill) => skill.metadata_present).length,
    typed_input_schema: skills.filter((skill) => skill.input_schema_status === "typed").length,
    inferred_or_permissive_input_schema: skills.filter((skill) =>
      ["inferred", "permissive", "missing"].includes(skill.input_schema_status)
    ).length,
    built_in_runners: skills.filter((skill) => skill.runner_status === "built_in").length,
    generic_runners: skills.filter((skill) => skill.runner_status === "generic").length,
    missing_runners: skills.filter((skill) => skill.runner_status === "missing").length,
    smoke_runs: smokeRuns.length,
    smoke_completed: smokeRuns.filter(
      (run) => run.status === "completed" && run.artifact_count > 0
    ).length,
    smoke_failed: smokeRuns.filter(
      (run) => run.status !== "completed" || run.artifact_count === 0
    ).length,
  };

  return {
    summary,
    skills,
    smoke_runs: smokeRuns,
  };
}

async function executeRunningProcessRun(run) {
  const sql = getDb();

  try {
    let result;
    const item = await getProcessRegistryItem({ slug: run.registry_slug });
    const metadata = await getSkillOperationMetadataOptional(run.registry_slug);
    const runner = getRunnerInfo(item, metadata);

    if (runner?.executor === "price_structure_analysis") {
      result = await executePriceStructureRun(run);
    } else if (runner?.executor === "polymarket_distiller") {
      result = await executePolymarketDistillerRun(run);
    } else if (runner?.executor === "generic_skill_invocation_packet") {
        result = await executeGenericSkillRun(run);
    } else {
      await sql`
        UPDATE process_runs
        SET status = 'blocked',
          state = COALESCE(state, '{}'::jsonb) || ${JSON.stringify({ blocker: "No WPR runner configured for registry_slug" })}::jsonb,
          completed_at = NOW()
        WHERE id = ${run.id}
      `;
      return {
        id: run.id,
        registry_slug: run.registry_slug,
        status: "blocked",
        message: "No WPR runner is configured for this registry object yet.",
      };
    }

    const completedRows = await sql`
      UPDATE process_runs
      SET status = 'completed',
        outputs = ${JSON.stringify(result.output)}::jsonb,
        state = COALESCE(state, '{}'::jsonb) || ${JSON.stringify({ completed_by: SERVER_INFO.name })}::jsonb,
        completed_at = NOW()
      WHERE id = ${run.id}
      RETURNING
        id,
        registry_slug,
        registry_version,
        status,
        inputs,
        outputs,
        state,
        started_at::text AS started_at,
        completed_at::text AS completed_at
    `;

    return {
      run: completedRows[0],
      artifacts: result.artifacts,
    };
  } catch (err) {
    await sql`
      UPDATE process_runs
      SET status = 'failed',
        state = COALESCE(state, '{}'::jsonb) || ${JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        })}::jsonb,
        completed_at = NOW()
      WHERE id = ${run.id}
    `;
    throw err;
  }
}

async function claimPendingProcessRun(args = {}) {
  const claimedBy = args.claimed_by ?? SERVER_INFO.name;
  const sql = getDb();
  const rows = await sql`
    WITH next_run AS (
      SELECT id
      FROM process_runs
      WHERE status = 'pending'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE process_runs r
    SET status = 'running',
      started_at = COALESCE(r.started_at, NOW()),
      state = COALESCE(r.state, '{}'::jsonb) || ${JSON.stringify({ claimed_by: claimedBy })}::jsonb
    FROM next_run
    WHERE r.id = next_run.id
    RETURNING
      r.id,
      r.registry_slug,
      r.registry_version,
      r.status,
      r.inputs,
      r.outputs,
      r.state,
      r.created_at::text AS created_at,
      r.started_at::text AS started_at
  `;

  return rows[0] ?? null;
}

async function triggerProcessRun(args = {}) {
  const sql = getDb();
  const rows = await sql`
    UPDATE process_runs
    SET status = 'running',
      started_at = COALESCE(started_at, NOW()),
      state = COALESCE(state, '{}'::jsonb) || ${JSON.stringify({ triggered_by: SERVER_INFO.name })}::jsonb
    WHERE id = ${args.run_id}
      AND status = 'pending'
    RETURNING
      id,
      registry_slug,
      registry_version,
      status,
      inputs,
      outputs,
      state,
      created_at::text AS created_at,
      started_at::text AS started_at
  `;
  const run = rows[0];

  if (!run) {
    const existing = await sql`
      SELECT id, status
      FROM process_runs
      WHERE id = ${args.run_id}
      LIMIT 1
    `;
    if (!existing[0]) throw new Error(`No process run found for id: ${args.run_id}`);
    throw new Error(`Run ${existing[0].id} is ${existing[0].status}; only pending runs can be triggered.`);
  }

  return executeRunningProcessRun(run);
}

async function listProcessRuns(args = {}) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      id,
      registry_slug,
      registry_version,
      status,
      inputs,
      outputs,
      state,
      started_at::text AS started_at,
      completed_at::text AS completed_at,
      created_at::text AS created_at
    FROM process_runs
    WHERE registry_slug = ${args.slug}
    ORDER BY created_at DESC
    LIMIT ${getLimit(args.limit)}
  `;

  return { runs: rows };
}

async function listProcessArtifacts(args = {}) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      id,
      run_id,
      registry_slug,
      artifact_type,
      title,
      status,
      content_uri,
      json_content,
      created_by_step,
      visibility,
      created_at::text AS created_at
    FROM process_artifacts
    WHERE (${args.slug ?? null}::text IS NULL OR registry_slug = ${args.slug ?? null})
      AND (${args.status ?? null}::text IS NULL OR status = ${args.status ?? null})
    ORDER BY created_at DESC
    LIMIT ${getLimit(args.limit)}
  `;

  return { artifacts: rows };
}

async function getLatestWatchlistStock(symbol) {
  const sql = getDb();
  const rows = await sql`
    SELECT DISTINCT ON (symbol)
      symbol,
      name,
      market,
      sector,
      industry,
      price,
      created_at::text AS created_at
    FROM watchlist_items
    WHERE UPPER(symbol) = ${symbol.toUpperCase()}
    ORDER BY symbol, created_at DESC
    LIMIT 1
  `;

  return rows[0] ?? null;
}

function buildRunOption(item, input, options = {}) {
  const source = options.source ?? "suggest_data_operations";
  const inputs = buildRunInputs(input, options.operationQuery, source);
  const missingInputs = getMissingRequiredInputs(item, inputs, options.metadata);
  const runner = getRunnerInfo(item, options.metadata);
  const enabled = item.status === "active" && missingInputs.length === 0 && Boolean(runner);

  return {
    label: `Create pending run: ${item.name}`,
    kind: "mcp_tool",
    tool: "create_process_run",
    arguments: {
      slug: item.slug,
      inputs,
    },
    enabled,
    description:
      missingInputs.length > 0
        ? `Missing required inputs: ${missingInputs.join(", ")}.`
        : !runner
        ? "No WPR runner exists yet, so this object cannot produce artifacts through WPR."
        : runner.runner_kind === "generic"
        ? "Creates a safe generic invocation artifact. It does not execute external side effects."
        : item.status === "active"
        ? "Creates a pending run row. It does not execute the workflow yet."
        : `Unavailable because this registry item is ${item.status}.`,
  };
}

function buildRunInputs(dataInput, operationQuery, source) {
  const input = normalizeInput(dataInput);
  const inputs = looksLikeTicker(input)
    ? { ticker: input.toUpperCase() }
    : { input };

  if (operationQuery) inputs.operation_query = operationQuery;
  if (source) inputs.source = source;

  return inputs;
}

function scoreTickerSkill(item) {
  if (item.object_type !== "skill") return 0;

  const text = [
    item.slug,
    item.name,
    item.description,
    ...(item.tags ?? []),
    item.config?.body_preview ?? "",
  ]
    .join(" ")
    .toLowerCase();

  const weightedTerms = [
    ["ticker", 4],
    ["stock", 4],
    ["price structure", 8],
    ["price", 3],
    ["breakout", 5],
    ["trend", 3],
    ["support", 3],
    ["resistance", 3],
    ["market", 2],
    ["regime", 2],
    ["entropy", 2],
    ["watchlist", 2],
  ];

  return weightedTerms.reduce((score, [term, weight]) => {
    return text.includes(term) ? score + weight : score;
  }, 0);
}

function buildInspectOption(item, reason) {
  return {
    label: `Inspect registry item: ${item.name}`,
    kind: "mcp_tool",
    tool: "get_process_registry_item",
    arguments: { slug: item.slug },
    enabled: true,
    description: reason ?? `${item.object_type} is currently ${item.status}.`,
  };
}

function parseOperationPath(path) {
  const parts = normalizeInput(path)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts[0]?.toLowerCase() === "wpr") parts.shift();
  if (parts.length === 0) throw new Error("Path must include a data input.");

  return {
    data_input: parts[0],
    operation_query: parts.slice(1).join(" ").trim(),
  };
}

function operationMatchScore(item, metadata, query) {
  if (!query) return 0;

  const queryTerms = wordsFromText(query);
  const phrase = normalizeInput(query).toLowerCase();
  const slugQuery = slugify(query);
  const slug = item.slug.toLowerCase();
  const name = item.name.toLowerCase();
  const fields = [
    item.slug,
    item.name,
    item.description,
    ...(item.tags ?? []),
    ...(metadata?.trigger_terms ?? []),
    ...(metadata?.routing_keywords ?? []),
    metadata?.operation_hints?.source_name ?? "",
    metadata?.operation_hints?.source_slug ?? "",
  ].map((value) => String(value).toLowerCase());
  const haystack = fields.join(" ");

  let score = 0;
  if (slug === slugQuery) score += 100;
  if (name === phrase) score += 80;
  if (slug.startsWith(`${slugQuery}-`) || slug.startsWith(slugQuery)) score += 22;
  if (slug.includes(slugQuery)) score += 35;
  if (haystack.includes(phrase)) score += 25;
  if (phrase.includes("backtest") && slug.includes("backtest")) score += 25;
  if (!phrase.includes("backtest") && slug.includes("backtest")) score -= 8;

  for (const term of queryTerms) {
    if (slug.includes(term)) score += 12;
    if (name.includes(term)) score += 10;
    if ((metadata?.trigger_terms ?? []).some((t) => t.toLowerCase().includes(term))) {
      score += 8;
    }
    if ((metadata?.routing_keywords ?? []).some((t) => t.toLowerCase().includes(term))) {
      score += 6;
    }
    if (item.description.toLowerCase().includes(term)) score += 3;
  }

  return score;
}

const TASK_STOPWORDS = new Set([
  "the",
  "and",
  "a",
  "an",
  "or",
  "to",
  "of",
  "in",
  "on",
  "by",
  "as",
  "is",
  "are",
  "for",
  "with",
  "from",
  "into",
  "that",
  "this",
  "make",
  "create",
  "build",
  "give",
  "show",
  "want",
  "need",
  "please",
]);

const NON_TICKER_WORDS = new Set(
  [
    ...TASK_STOPWORDS,
    "analyze",
    "analysis",
    "analyst",
    "artifact",
    "artifacts",
    "backtest",
    "brief",
    "chart",
    "compare",
    "deck",
    "distill",
    "entropy",
    "event",
    "hmm",
    "market",
    "meeting",
    "memo",
    "polymarket",
    "price",
    "report",
    "research",
    "risk",
    "run",
    "shannon",
    "skill",
    "skills",
    "stock",
    "structure",
    "task",
    "ticker",
    "tickers",
    "video",
  ].map((term) => term.toUpperCase())
);

function getTaskTerms(input) {
  return wordsFromText(input).filter((term) => !TASK_STOPWORDS.has(term));
}

function extractTickerCandidates(input) {
  return unique(
    String(input ?? "")
      .split(/[\s,;()]+/)
      .map((raw) => raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.-]+$/g, ""))
      .filter((part) => {
        if (!part) return false;
        const upper = part.toUpperCase();
        if (NON_TICKER_WORDS.has(upper)) return false;
        if (!looksLikeTicker(upper)) return false;
        if (/\d/.test(upper) || /[.-]/.test(upper)) return true;
        if (part !== upper && part !== part.toLowerCase()) return false;
        return upper.length >= 2 && upper.length <= 5;
      })
      .map((part) => part.toUpperCase())
  );
}

function detectTaskType(input, terms, entities) {
  const text = input.toLowerCase();
  if (text.includes("meeting") || text.includes("开会") || text.includes("会议")) {
    return entities.tickers.length ? "stock_research_to_meeting" : "meeting_creation";
  }
  if (text.includes("polymarket") || text.includes("poly ") || entities.urls.some((url) => url.includes("polymarket.com"))) {
    return "polymarket_distillation";
  }
  if (text.includes("video") || text.includes("youtube") || text.includes("podcast")) {
    return "video_or_media_pipeline";
  }
  if (terms.some((term) => ["backtest", "回测"].includes(term))) return "backtest";
  if (entities.tickers.length) return "stock_analysis";
  return "general_skill_task";
}

function detectDesiredArtifacts(input, terms) {
  const text = input.toLowerCase();
  const artifacts = [];

  if (text.includes("meeting") || text.includes("开会") || text.includes("会议")) {
    artifacts.push("meeting_topic");
  }
  if (text.includes("video") || text.includes("youtube")) artifacts.push("video");
  if (text.includes("audio") || text.includes("podcast")) artifacts.push("audio");
  if (text.includes("slide") || text.includes("deck") || text.includes("ppt")) artifacts.push("slides");
  if (text.includes("chart") || text.includes("graph")) artifacts.push("chart");
  if (text.includes("report") || text.includes("analysis") || text.includes("analyze")) {
    artifacts.push("report", "decision_memo");
  }
  if (terms.some((term) => ["price", "structure", "breakout", "support", "resistance"].includes(term))) {
    artifacts.push("price_structure_verdict", "decision_memo");
  }
  if (terms.some((term) => ["shannon", "entropy", "hmm", "regime"].includes(term))) {
    artifacts.push("regime_report", "decision_memo");
  }
  if (text.includes("polymarket")) artifacts.push("polymarket_distillation");

  return unique(artifacts);
}

function parseTaskIntent(input) {
  const normalized = normalizeInput(input);
  if (!normalized) throw new Error("input is required");

  const urls = normalized.match(/https?:\/\/\S+/g) ?? [];
  const tickers = extractTickerCandidates(normalized);
  const terms = getTaskTerms(normalized);
  const desiredArtifacts = detectDesiredArtifacts(normalized, terms);
  const entities = { tickers, urls };

  return {
    input: normalized,
    task_type: detectTaskType(normalized, terms, entities),
    terms,
    entities,
    desired_artifacts: desiredArtifacts,
    side_effect_tolerance:
      /\b(post|upload|publish|send|tweet|trade|create meeting|开会|会议)\b/i.test(normalized),
  };
}

function skillCandidateHaystack(item, metadata) {
  return [
    item.slug,
    item.name,
    item.description,
    ...(item.tags ?? []),
    ...(metadata?.trigger_terms ?? []),
    ...(metadata?.routing_keywords ?? []),
    ...(metadata?.artifact_types ?? []),
    ...(metadata?.side_effects ?? []),
    ...(metadata?.approval_requirements ?? []),
    metadata?.operation_hints?.source_name ?? "",
    metadata?.operation_hints?.source_slug ?? "",
    metadata?.operation_hints?.operation ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function scoreTaskSkillCandidate(item, metadata, intent, runner = null) {
  const haystack = skillCandidateHaystack(item, metadata);
  const reasons = [];
  let score = 0;

  for (const term of intent.terms) {
    if (item.slug.toLowerCase().includes(term)) {
      score += 14;
      reasons.push(`slug matches "${term}"`);
    } else if (item.name.toLowerCase().includes(term)) {
      score += 10;
      reasons.push(`name matches "${term}"`);
    } else if (haystack.includes(term)) {
      score += 5;
    }
  }

  if (intent.entities.tickers.length && /\b(stock|ticker|price|market|regime|entropy|analysis)\b/.test(haystack)) {
    score += 10;
    reasons.push("accepts stock/ticker-style tasks");
  }

  for (const artifact of intent.desired_artifacts) {
    if ((metadata?.artifact_types ?? []).includes(artifact) || runner?.artifact_type === artifact) {
      score += 12;
      reasons.push(`can produce ${artifact}`);
    } else if (haystack.includes(artifact.replace(/_/g, " "))) {
      score += 5;
    }
  }

  if (intent.task_type === "stock_research_to_meeting") {
    if (["price-structure-analysis", "hmm-entropy-analysis", "narrative-cycle-analysis", "analysis-to-meeting"].includes(item.slug)) {
      score += 25;
      reasons.push("part of stock research to meeting pattern");
    }
  }

  if (intent.task_type === "polymarket_distillation" && item.slug === "polymarket-distiller") {
    score += 40;
    reasons.push("direct Polymarket distillation match");
  }

  if (intent.task_type === "backtest" && item.slug.includes("backtest")) {
    score += 30;
    reasons.push("direct backtest match");
  }

  if (runner?.runner_kind === "built_in") {
    score += 10;
    reasons.push("has built-in artifact runner");
  } else if (runner?.runner_kind === "generic") {
    score += 3;
    reasons.push("has safe generic WPR runner");
  }

  if (item.status === "active") score += 5;
  if ((metadata?.approval_requirements ?? []).length > 0) {
    reasons.push(`requires approval: ${metadata.approval_requirements.join(", ")}`);
  }

  return {
    score,
    reasons: unique(reasons).slice(0, 6),
  };
}

function mapIntentToSkillInputs(intent, metadata, runner) {
  const schema = metadata?.input_schema ?? {};
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const inputs = {};
  const ticker = intent.entities.tickers[0];
  const url = intent.entities.urls[0];

  if (ticker && properties.ticker) inputs.ticker = ticker;
  else if (ticker && properties.symbol) inputs.symbol = ticker;
  else if (ticker && !Object.keys(properties).length) inputs.ticker = ticker;

  if (url && properties.url) inputs.url = url;
  if (!Object.keys(inputs).length && properties.query) inputs.query = intent.input;
  if (!Object.keys(inputs).length && properties.input) inputs.input = intent.input;
  if (!Object.keys(inputs).length && runner?.runner_kind === "generic") inputs.input = intent.input;

  inputs.source = "wpr_task_composer";
  return inputs;
}

function riskRank(risk) {
  return { low: 0, medium: 1, high: 2, critical: 3 }[risk] ?? 0;
}

function summarizePlanRisk(nodes) {
  const maxRisk = nodes.reduce((risk, node) => {
    return riskRank(node.risk_level) > riskRank(risk) ? node.risk_level : risk;
  }, "low");
  const approvals = unique(nodes.flatMap((node) => node.approval_requirements ?? []));
  return {
    risk_level: maxRisk,
    approval_requirements: approvals,
    requires_approval: approvals.length > 0,
  };
}

function buildPlanNode(candidate, index, dependsOn = []) {
  return {
    id: candidate.slug.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `node_${index + 1}`,
    slug: candidate.slug,
    label: candidate.name,
    runner_kind: candidate.runner_kind,
    artifact_type: candidate.runner_artifact_type,
    risk_level: candidate.risk_level,
    approval_requirements: candidate.approval_requirements,
    inputs: candidate.suggested_inputs,
    depends_on: dependsOn,
    input_valid: candidate.input_valid,
    input_errors: candidate.input_errors,
  };
}

function buildRecommendedTaskPlans(intent, candidates) {
  const bySlug = new Map(candidates.map((candidate) => [candidate.slug, candidate]));
  const plans = [];

  const makePlan = (label, slugs) => {
    const nodes = [];
    for (const slug of slugs) {
      const candidate = bySlug.get(slug);
      if (!candidate) continue;
      const dependsOn =
        slug === "narrative-cycle-analysis"
          ? nodes.filter((node) => ["price_structure_analysis", "hmm_entropy_analysis"].includes(node.id)).map((node) => node.id)
          : slug === "analysis-to-meeting"
          ? nodes.map((node) => node.id)
          : [];
      nodes.push(buildPlanNode(candidate, nodes.length, dependsOn));
    }
    if (!nodes.length) return null;
    return {
      label,
      nodes,
      ...summarizePlanRisk(nodes),
      executable_now: nodes.every((node) => node.input_valid),
    };
  };

  if (intent.task_type === "stock_research_to_meeting") {
    const plan = makePlan("Stock research to meeting", [
      "price-structure-analysis",
      "hmm-entropy-analysis",
      "narrative-cycle-analysis",
      "analysis-to-meeting",
    ]);
    if (plan) plans.push(plan);
  }

  if (intent.task_type === "stock_analysis") {
    const plan = makePlan("Stock research packet", [
      "price-structure-analysis",
      "hmm-entropy-analysis",
      "narrative-cycle-analysis",
    ]);
    if (plan) plans.push(plan);
  }

  if (intent.task_type === "polymarket_distillation") {
    const plan = makePlan("Polymarket event distillation", ["polymarket-distiller"]);
    if (plan) plans.push(plan);
  }

  if (intent.task_type === "backtest") {
    const plan = makePlan("Backtest and compare", ["backtest-hmm-entropy", "honest-backtesting"]);
    if (plan) plans.push(plan);
  }

  const topNodes = candidates.slice(0, 5).map((candidate, index) =>
    buildPlanNode(candidate, index, index === 0 ? [] : [candidates[0].slug.replace(/[^a-z0-9]+/g, "_")])
  );
  if (topNodes.length) {
    plans.push({
      label: "Top matched skill blocks",
      nodes: topNodes,
      ...summarizePlanRisk(topNodes),
      executable_now: topNodes.every((node) => node.input_valid),
    });
  }

  return plans;
}

async function suggestTaskPlan(args = {}) {
  const input = normalizeInput(args.input);
  if (!input) throw new Error("input is required");

  const intent = parseTaskIntent(input);
  const limit = getLimit(args.limit ?? 12);
  const sql = getDb();
  const rows = await sql`
    SELECT
      r.slug,
      r.object_type,
      r.name,
      r.status,
      r.version,
      r.description,
      r.tags,
      r.config,
      r.updated_at::text AS updated_at,
      m.trigger_terms,
      m.routing_keywords,
      m.input_schema,
      m.output_schema,
      m.required_tools,
      m.side_effects,
      m.artifact_types,
      m.approval_requirements,
      m.operation_hints,
      m.risk_level
    FROM process_registry_items r
    LEFT JOIN skill_operation_metadata m ON m.registry_slug = r.slug
    WHERE r.object_type = 'skill'
      AND r.status = 'active'
  `;

  const candidates = rows
    .map((row) => {
      const item = {
        slug: row.slug,
        object_type: row.object_type,
        name: row.name,
        status: row.status,
        version: row.version,
        description: row.description,
        tags: row.tags ?? [],
        config: row.config ?? {},
        updated_at: row.updated_at,
      };
      const metadata = {
        trigger_terms: row.trigger_terms ?? [],
        routing_keywords: row.routing_keywords ?? [],
        input_schema: row.input_schema ?? {},
        output_schema: row.output_schema ?? {},
        required_tools: row.required_tools ?? [],
        side_effects: row.side_effects ?? [],
        artifact_types: row.artifact_types ?? [],
        approval_requirements: row.approval_requirements ?? [],
        operation_hints: row.operation_hints ?? {},
        risk_level: row.risk_level ?? "low",
      };
      const runner = getRunnerInfo(item, metadata);
      const scored = scoreTaskSkillCandidate(item, metadata, intent, runner);
      const suggestedInputs = mapIntentToSkillInputs(intent, metadata, runner);
      let inputValid = true;
      let inputErrors = [];

      try {
        validateProcessRunInputs(item, suggestedInputs, metadata);
      } catch (err) {
        inputValid = false;
        inputErrors = [err instanceof Error ? err.message : String(err)];
      }

      return {
        slug: item.slug,
        name: item.name,
        status: item.status,
        score: scored.score,
        runner_kind: runner?.runner_kind ?? "missing",
        runner_artifact_type: runner?.artifact_type ?? null,
        risk_level: metadata.risk_level,
        artifact_types: metadata.artifact_types,
        approval_requirements: metadata.approval_requirements,
        required_tools: metadata.required_tools,
        suggested_inputs: suggestedInputs,
        input_valid: inputValid,
        input_errors: inputErrors,
        why: scored.reasons,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.runner_kind === "built_in" ? 1 : 0) - (a.runner_kind === "built_in" ? 1 : 0) ||
        a.slug.localeCompare(b.slug)
    );

  const skillCandidates = candidates.slice(0, limit);
  const plans = buildRecommendedTaskPlans(intent, skillCandidates);

  return {
    input,
    intent,
    skill_candidates: skillCandidates,
    plans,
  };
}

function statusRank(status) {
  return { active: 0, review: 1, draft: 2, archived: 3 }[status] ?? 4;
}

function compareOperationMatches(a, b) {
  return (
    b.score - a.score ||
    statusRank(a.item.status) - statusRank(b.item.status) ||
    a.item.slug.localeCompare(b.item.slug)
  );
}

async function findOperationMatches(operationQuery, limit = 8) {
  if (!operationQuery) return [];

  const sql = getDb();
  const rows = await sql`
    SELECT
      r.slug,
      r.object_type,
      r.name,
      r.status,
      r.version,
      r.description,
      r.tags,
      r.config,
      r.updated_at::text AS updated_at,
      m.trigger_terms,
      m.routing_keywords,
      m.input_schema,
      m.output_schema,
      m.required_tools,
      m.side_effects,
      m.artifact_types,
      m.approval_requirements,
      m.operation_hints,
      m.risk_level
    FROM process_registry_items r
    LEFT JOIN skill_operation_metadata m ON m.registry_slug = r.slug
    WHERE r.object_type IN ('skill', 'template')
  `;

  return rows
    .map((row) => ({
      item: {
        slug: row.slug,
        object_type: row.object_type,
        name: row.name,
        status: row.status,
        version: row.version,
        description: row.description,
        tags: row.tags,
        config: row.config,
        updated_at: row.updated_at,
      },
      metadata: {
        trigger_terms: row.trigger_terms ?? [],
        routing_keywords: row.routing_keywords ?? [],
        input_schema: row.input_schema ?? {},
        output_schema: row.output_schema ?? {},
        required_tools: row.required_tools ?? [],
        side_effects: row.side_effects ?? [],
        artifact_types: row.artifact_types ?? [],
        approval_requirements: row.approval_requirements ?? [],
        operation_hints: row.operation_hints ?? {},
        risk_level: row.risk_level ?? "low",
      },
    }))
    .map((match) => ({
      ...match,
      score: operationMatchScore(match.item, match.metadata, operationQuery),
    }))
    .filter((match) => match.score > 0)
    .sort(compareOperationMatches)
    .slice(0, limit);
}

function buildOperationAction(item, metadata, dataInput, operationQuery) {
  if (item.status === "active") {
    return buildRunOption(item, dataInput, {
      metadata,
      operationQuery,
      source: "resolve_operation_path",
    });
  }

  return buildInspectOption(
    item,
    `${item.object_type} matched the requested operation but is currently ${item.status}.`
  );
}

async function resolveOperationPath(args = {}) {
  const { data_input, operation_query } = parseOperationPath(args.path);
  const isTicker = looksLikeTicker(data_input);
  const symbol = data_input.toUpperCase();
  const stock = isTicker ? await getLatestWatchlistStock(symbol) : null;
  const matches = await findOperationMatches(operation_query);
  const best = matches[0] ?? null;

  if (!best) {
    return {
      path: args.path,
      data_input,
      detected_type: isTicker ? "ticker" : "text",
      operation_query,
      matched_stock: stock,
      matched_operation: null,
      action: null,
      alternatives: [],
    };
  }

  let action = buildOperationAction(best.item, best.metadata, data_input, operation_query);
  let executed_run = null;

  if (args.execute === true && best.item.status === "active" && action?.enabled) {
    executed_run = await createProcessRun({
      slug: best.item.slug,
      inputs: buildRunInputs(isTicker ? symbol : data_input, operation_query, "resolve_operation_path"),
    });
    action = {
      ...action,
      executed: true,
      result: executed_run,
    };
  } else if (args.execute === true && best.item.status === "active") {
    action = {
      ...action,
      executed: false,
      blocked_reason: action?.description ?? "The matched operation cannot create a run yet.",
    };
  }

  return {
    path: args.path,
    data_input,
    detected_type: isTicker ? "ticker" : "text",
    operation_query,
    matched_stock: stock,
    matched_operation: {
      slug: best.item.slug,
      name: best.item.name,
      status: best.item.status,
      version: best.item.version,
      score: best.score,
      risk_level: best.metadata.risk_level,
      side_effects: best.metadata.side_effects,
      artifact_types: best.metadata.artifact_types,
      approval_requirements: best.metadata.approval_requirements,
    },
    action,
    executed_run,
    alternatives: matches.slice(1, 6).map((match) => ({
      slug: match.item.slug,
      name: match.item.name,
      status: match.item.status,
      score: match.score,
      risk_level: match.metadata.risk_level,
    })),
  };
}

async function suggestDataOperations(args = {}) {
  const input = normalizeInput(args.input);
  if (!input) throw new Error("input is required");

  const registry = await listProcessRegistry({});
  const activeItems = registry.items.filter((item) => item.status === "active");
  const matchingRegistryItems = registry.items.filter((item) => {
    const haystack = [
      item.slug,
      item.name,
      item.description,
      item.object_type,
      item.status,
      ...(item.tags ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(input.toLowerCase());
  });

  const isTicker = looksLikeTicker(input);
  const symbol = input.toUpperCase();
  const stock = isTicker ? await getLatestWatchlistStock(symbol) : null;
  const options = [];
  const optionedSlugs = new Set();

  if (isTicker) {
    options.push({
      label: `Open ${symbol} stock page`,
      kind: "app_url",
      url: `/stock/${symbol}`,
      enabled: true,
      description: "Open the WatchingList stock detail page.",
    });
    options.push({
      label: `Refresh or analyze ${symbol}`,
      kind: "app_api",
      method: "POST",
      url: "/api/analyze",
      body: { symbol },
      enabled: true,
      description: "Refreshes market data and analysis through the app API.",
    });
  }

  for (const item of activeItems) {
    if (item.object_type === "skill" || item.object_type === "template") {
      options.push(buildRunOption(item, input));
      optionedSlugs.add(item.slug);
    }
  }

  if (isTicker) {
    const tickerSkillOptions = registry.items
      .filter((item) => !optionedSlugs.has(item.slug))
      .map((item) => ({ item, score: scoreTickerSkill(item) }))
      .filter(({ score }) => score >= 6)
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));

    for (const { item, score } of tickerSkillOptions) {
      optionedSlugs.add(item.slug);
      options.push(
        buildInspectOption(
          item,
          `Ticker-compatible ${item.object_type} is currently ${item.status}; score ${score}.`
        )
      );
    }
  }

  for (const item of matchingRegistryItems) {
    if (optionedSlugs.has(item.slug)) continue;
    optionedSlugs.add(item.slug);
    options.push(buildInspectOption(item));
  }

  for (const item of registry.items) {
    if (optionedSlugs.has(item.slug)) continue;
    optionedSlugs.add(item.slug);
    options.push(
      buildInspectOption(
        item,
        "Included by default so the suggestion list covers every registry object."
      )
    );
  }

  if (isTicker) {
    options.push({
      label: `List recent runs for stock analysis`,
      kind: "mcp_tool",
      tool: "list_process_runs",
      arguments: { slug: "schema-first-stock-analysis", limit: 10 },
      enabled: true,
      description:
        "Lists recent runs for the stock analysis skill. Filter-by-input can be added later.",
    });
  }

  options.push({
    label: "List all registry objects",
    kind: "mcp_tool",
    tool: "list_process_registry",
    arguments: {},
    enabled: true,
    description: "Shows every skill, pipeline, process, application, and template.",
  });

  return {
    input,
    detected_type: isTicker ? "ticker" : "text",
    matched_stock: stock,
    registry_matches: matchingRegistryItems,
    options,
  };
}

async function importSkillsFromDirectory(args = {}) {
  const directory = resolve(
    args.directory || "/Users/sdg223157/.codex/skills"
  );
  const dryRun = Boolean(args.dry_run);
  const skills = await readSkillFiles(directory);

  if (dryRun) {
    return {
      directory,
      dry_run: true,
      parsed: skills.length,
      planned: skills.map(({ slug, name, description, config }) => ({
        slug,
        name,
        description,
        source_path: config.source_path,
      })),
    };
  }

  const sql = getDb();
  const imported = [];

  for (const skill of skills) {
    const rows = await sql`
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
        ${skill.slug},
        'skill',
        ${skill.name},
        'draft',
        1,
        ${skill.description},
        ${skill.tags},
        ${JSON.stringify(skill.config)}::jsonb
      )
      ON CONFLICT (slug) DO UPDATE SET
        object_type = 'skill',
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        tags = EXCLUDED.tags,
        config = EXCLUDED.config,
        updated_at = NOW()
      RETURNING
        slug,
        name,
        status,
        version,
        updated_at::text AS updated_at
    `;

    if (skill.operation_metadata) {
      const meta = skill.operation_metadata;
      await sql`
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
          ${meta.registry_slug},
          ${meta.source_kind},
          ${meta.source_path},
          ${meta.trigger_terms},
          ${meta.routing_keywords},
          ${JSON.stringify(meta.input_schema)}::jsonb,
          ${JSON.stringify(meta.output_schema)}::jsonb,
          ${JSON.stringify(meta.required_tools)}::jsonb,
          ${meta.side_effects},
          ${meta.artifact_types},
          ${meta.approval_requirements},
          ${JSON.stringify(meta.operation_hints)}::jsonb,
          ${meta.risk_level}
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
          updated_at = NOW()
      `;
    }

    imported.push(rows[0]);
  }

  await sql`
    INSERT INTO process_audit_events (
      event_type,
      actor,
      details
    )
    VALUES (
      'skills_imported',
      ${SERVER_INFO.name},
      ${JSON.stringify({
        directory,
        count: imported.length,
      })}::jsonb
    )
  `;

  return {
    directory,
    dry_run: false,
    imported_count: imported.length,
    imported,
  };
}

async function callTool(name, args) {
  if (name === "list_process_registry") return listProcessRegistry(args);
  if (name === "get_process_registry_item") return getProcessRegistryItem(args);
  if (name === "get_skill_operation_metadata") return getSkillOperationMetadata(args);
  if (name === "create_process_run") return createProcessRun(args);
  if (name === "trigger_process_run") return triggerProcessRun(args);
  if (name === "list_process_runs") return listProcessRuns(args);
  if (name === "list_process_artifacts") return listProcessArtifacts(args);
  if (name === "suggest_data_operations") return suggestDataOperations(args);
  if (name === "resolve_operation_path") return resolveOperationPath(args);
  if (name === "import_skills_from_directory") return importSkillsFromDirectory(args);
  if (name === "audit_process_registry_skills") return auditProcessRegistrySkills(args);
  if (name === "suggest_task_plan") return suggestTaskPlan(args);
  throw new Error(`Unknown tool: ${name}`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id, err) {
  send({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: err instanceof Error ? err.message : String(err),
    },
  });
}

async function handle(message) {
  const { id, method, params = {} } = message;

  try {
    if (method === "initialize") {
      result(id, {
        protocolVersion: params.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      return;
    }

    if (method === "notifications/initialized") return;

    if (method === "tools/list") {
      result(id, { tools: TOOLS });
      return;
    }

    if (method === "tools/call") {
      const payload = await callTool(params.name, params.arguments ?? {});
      result(id, { content: asJsonContent(payload) });
      return;
    }

    if (id !== undefined) {
      error(id, new Error(`Unsupported method: ${method}`));
    }
  } catch (err) {
    error(id, err);
  }
}

function startMcpServer() {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        void handle(JSON.parse(trimmed));
      } catch (err) {
        error(null, err);
      }
    }
  });
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectRun) {
  startMcpServer();
}

export {
  SERVER_INFO,
  TOOLS,
  auditProcessRegistrySkills,
  buildSkillOperationMetadata,
  buildRunInputs,
  callTool,
  claimPendingProcessRun,
  compareOperationMatches,
  createProcessRun,
  executeRunningProcessRun,
  getBuiltInRunnerInfo,
  getRunnerInfo,
  getMissingRequiredInputs,
  getProcessRegistryItem,
  getSkillOperationMetadata,
  inferArtifactTypes,
  importSkillsFromDirectory,
  listProcessArtifacts,
  listProcessRegistry,
  listProcessRuns,
  operationMatchScore,
  parseTaskIntent,
  resolveOperationPath,
  scoreTaskSkillCandidate,
  startMcpServer,
  suggestDataOperations,
  suggestTaskPlan,
  triggerProcessRun,
  validateArtifactJsonContent,
  validateJsonValueAgainstSchema,
  validateProcessRunInputs,
};
