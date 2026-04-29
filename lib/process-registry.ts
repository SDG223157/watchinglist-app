import { getDb } from "@/lib/db";

export type RegistryObjectType =
  | "skill"
  | "pipeline"
  | "process"
  | "application"
  | "template";

export type RegistryStatus = "draft" | "active" | "review" | "archived";

export interface ProcessRegistryItem {
  slug: string;
  object_type: RegistryObjectType;
  name: string;
  status: RegistryStatus;
  version: number;
  description: string;
  tags: string[];
  config: Record<string, unknown>;
  updated_at: string;
}

export interface ProcessRegistrySummary {
  total: number;
  active: number;
  draft: number;
  review: number;
  archived: number;
  byType: Record<RegistryObjectType, number>;
}

export type ProcessRunStatus =
  | "pending"
  | "running"
  | "blocked"
  | "failed"
  | "completed"
  | "superseded";

export type ProcessArtifactStatus =
  | "needs_review"
  | "approved"
  | "published"
  | "archived";

export interface ProcessRun {
  id: number;
  registry_slug: string;
  registry_version: number;
  registry_version_id: number | null;
  status: ProcessRunStatus;
  attempt: number;
  max_attempts: number;
  timeout_ms: number | null;
  retry_backoff_ms: number;
  failure_category: string | null;
  next_retry_at: string | null;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  state: Record<string, unknown>;
  frozen_registry: Record<string, unknown>;
  frozen_metadata: Record<string, unknown>;
  frozen_runner: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ProcessArtifact {
  id: number;
  run_id: number | null;
  registry_slug: string | null;
  artifact_type: string;
  title: string;
  status: ProcessArtifactStatus;
  content_uri: string | null;
  json_content: Record<string, unknown>;
  created_by_step: string | null;
  visibility: string;
  created_at: string;
  run_status?: ProcessRunStatus | null;
  run_attempt?: number | null;
  run_max_attempts?: number | null;
}

export interface ProcessRunDetail {
  run: ProcessRun;
  artifacts: ProcessArtifact[];
  auditEvents: Array<{
    id: number;
    event_type: string;
    actor: string;
    details: Record<string, unknown>;
    created_at: string;
  }>;
}

const SEEDED_ITEMS: ProcessRegistryItem[] = [
  {
    slug: "schema-first-stock-analysis",
    object_type: "skill",
    name: "Schema-First Stock Analysis",
    status: "active",
    version: 1,
    description:
      "Consumes a ticker and produces typed outputs: snapshot, narrative cycle, gravity walls, entropy state, and required artifacts.",
    tags: ["schema", "stock", "analysis"],
    config: {
      input_schema: { ticker: "string", horizon: "short|medium|long" },
      output_schema: {
        stock_snapshot_id: "string",
        artifact_ids: "string[]",
        risk_flags: "string[]",
      },
      artifact_types: ["snapshot", "decision_memo", "risk_map"],
      quality_checks: ["has_geometric_order", "has_fresh_snapshot"],
    },
    updated_at: new Date(0).toISOString(),
  },
  {
    slug: "stock-to-meeting-pipeline",
    object_type: "pipeline",
    name: "Stock to Meeting Pipeline",
    status: "draft",
    version: 1,
    description:
      "Turns a watchlist ticker into a structured research package and BotBoard-ready discussion topic.",
    tags: ["pipeline", "meeting", "research"],
    config: {
      graph: [
        "load_latest_snapshot",
        "refresh_if_stale",
        "run_schema_first_analysis",
        "create_meeting_topic",
        "save_artifacts",
      ],
      approval_points: ["before_external_publish"],
      failure_modes: ["stale_market_data", "missing_references"],
    },
    updated_at: new Date(0).toISOString(),
  },
  {
    slug: "daily-watchlist-operating-loop",
    object_type: "process",
    name: "Daily Watchlist Operating Loop",
    status: "review",
    version: 1,
    description:
      "A durable process that watches snapshot freshness, trigger events, approvals, and generated artifacts for the portfolio.",
    tags: ["process", "watchlist", "daily"],
    config: {
      trigger_type: "schedule",
      state: "ready",
      memory: ["latest_successful_run", "pending_approvals", "known_blockers"],
      scorecard: ["reliability", "artifact_usefulness", "human_edit_distance"],
    },
    updated_at: new Date(0).toISOString(),
  },
  {
    slug: "artifact-inbox",
    object_type: "application",
    name: "Artifact Inbox",
    status: "draft",
    version: 1,
    description:
      "A review surface for reports, meeting topics, decision memos, charts, datasets, and publishable assets.",
    tags: ["application", "artifacts", "review"],
    config: {
      route: "/processes/artifacts",
      artifact_states: ["needs_review", "approved", "published", "archived"],
      views: ["by_process", "by_stock", "by_status"],
    },
    updated_at: new Date(0).toISOString(),
  },
  {
    slug: "company-research-template",
    object_type: "template",
    name: "Company Research Template",
    status: "active",
    version: 1,
    description:
      "Instantiates a stock research process with input form, pipeline, artifact archive, approval gates, and run history.",
    tags: ["template", "company", "research"],
    config: {
      required_inputs: ["ticker", "audience", "depth"],
      generated_objects: ["process", "pipeline", "application", "triggers"],
      default_triggers: ["manual", "snapshot_stale", "threshold_crossed"],
    },
    updated_at: new Date(0).toISOString(),
  },
];

export async function fetchProcessRegistry(): Promise<ProcessRegistryItem[]> {
  try {
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
    return rows as unknown as ProcessRegistryItem[];
  } catch (error) {
    console.warn("process registry fallback:", error);
    return SEEDED_ITEMS;
  }
}

export function summarizeRegistry(
  items: ProcessRegistryItem[]
): ProcessRegistrySummary {
  const byType: Record<RegistryObjectType, number> = {
    skill: 0,
    pipeline: 0,
    process: 0,
    application: 0,
    template: 0,
  };

  const summary: ProcessRegistrySummary = {
    total: items.length,
    active: 0,
    draft: 0,
    review: 0,
    archived: 0,
    byType,
  };

  for (const item of items) {
    summary[item.status] += 1;
    summary.byType[item.object_type] += 1;
  }

  return summary;
}

export async function fetchProcessRuns(
  slug?: string,
  limit = 50
): Promise<ProcessRun[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT
      id,
      registry_slug,
      registry_version,
      registry_version_id,
      status,
      attempt,
      max_attempts,
      timeout_ms,
      retry_backoff_ms,
      failure_category,
      next_retry_at::text AS next_retry_at,
      inputs,
      outputs,
      state,
      frozen_registry,
      frozen_metadata,
      frozen_runner,
      started_at::text AS started_at,
      completed_at::text AS completed_at,
      created_at::text AS created_at
    FROM process_runs
    WHERE (${slug ?? null}::text IS NULL OR registry_slug = ${slug ?? null})
    ORDER BY created_at DESC
    LIMIT ${Math.max(1, Math.min(100, Math.trunc(limit)))}
  `;

  return rows as unknown as ProcessRun[];
}

export async function fetchProcessArtifacts(
  status?: ProcessArtifactStatus,
  slug?: string,
  limit = 100
): Promise<ProcessArtifact[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT
      a.id,
      a.run_id,
      a.registry_slug,
      a.artifact_type,
      a.title,
      a.status,
      a.content_uri,
      a.json_content,
      a.created_by_step,
      a.visibility,
      a.created_at::text AS created_at,
      r.status AS run_status,
      r.attempt AS run_attempt,
      r.max_attempts AS run_max_attempts
    FROM process_artifacts a
    LEFT JOIN process_runs r ON r.id = a.run_id
    WHERE (${status ?? null}::text IS NULL OR a.status = ${status ?? null})
      AND (${slug ?? null}::text IS NULL OR a.registry_slug = ${slug ?? null})
    ORDER BY a.created_at DESC
    LIMIT ${Math.max(1, Math.min(200, Math.trunc(limit)))}
  `;

  return rows as unknown as ProcessArtifact[];
}

export async function fetchProcessRunDetail(
  id: number
): Promise<ProcessRunDetail | null> {
  const sql = getDb();
  const runRows = await sql`
    SELECT
      id,
      registry_slug,
      registry_version,
      registry_version_id,
      status,
      attempt,
      max_attempts,
      timeout_ms,
      retry_backoff_ms,
      failure_category,
      next_retry_at::text AS next_retry_at,
      inputs,
      outputs,
      state,
      frozen_registry,
      frozen_metadata,
      frozen_runner,
      started_at::text AS started_at,
      completed_at::text AS completed_at,
      created_at::text AS created_at
    FROM process_runs
    WHERE id = ${id}
    LIMIT 1
  `;

  const run = runRows[0] as unknown as ProcessRun | undefined;
  if (!run) return null;

  const artifactRows = await sql`
    SELECT
      a.id,
      a.run_id,
      a.registry_slug,
      a.artifact_type,
      a.title,
      a.status,
      a.content_uri,
      a.json_content,
      a.created_by_step,
      a.visibility,
      a.created_at::text AS created_at,
      r.status AS run_status,
      r.attempt AS run_attempt,
      r.max_attempts AS run_max_attempts
    FROM process_artifacts a
    LEFT JOIN process_runs r ON r.id = a.run_id
    WHERE a.run_id = ${id}
    ORDER BY a.created_at DESC
  `;
  const auditRows = await sql`
    SELECT
      id,
      event_type,
      actor,
      details,
      created_at::text AS created_at
    FROM process_audit_events
    WHERE registry_slug = ${run.registry_slug}
      AND (
        details->>'run_id' = ${String(id)}
        OR details->>'retry_of_run_id' = ${String(id)}
      )
    ORDER BY created_at DESC
    LIMIT 30
  `;

  return {
    run,
    artifacts: artifactRows as unknown as ProcessArtifact[],
    auditEvents: auditRows as unknown as ProcessRunDetail["auditEvents"],
  };
}

export async function updateProcessArtifactStatus(
  id: number,
  status: ProcessArtifactStatus,
  actor = "web-ui"
) {
  const sql = getDb();
  const rows = await sql`
    UPDATE process_artifacts
    SET status = ${status}
    WHERE id = ${id}
    RETURNING id, registry_slug, run_id, status
  `;
  const artifact = rows[0];
  if (!artifact) throw new Error(`Artifact ${id} not found`);

  await sql`
    INSERT INTO process_audit_events (
      registry_slug,
      event_type,
      actor,
      details
    )
    VALUES (
      ${artifact.registry_slug},
      'artifact_status_changed',
      ${actor},
      ${JSON.stringify({
        artifact_id: artifact.id,
        run_id: artifact.run_id,
        status,
      })}::jsonb
    )
  `;

  return artifact;
}

export async function retryProcessRun(id: number, actor = "web-ui") {
  const sql = getDb();
  const rows = await sql`
    UPDATE process_runs
    SET status = 'pending',
      attempt = LEAST(attempt + 1, GREATEST(max_attempts, attempt + 1)),
      max_attempts = GREATEST(max_attempts, attempt + 1),
      failure_category = NULL,
      next_retry_at = NULL,
      completed_at = NULL,
      state = COALESCE(state, '{}'::jsonb) || ${JSON.stringify({
        manually_retried_by: actor,
        manually_retried_at: new Date().toISOString(),
      })}::jsonb
    WHERE id = ${id}
      AND status IN ('failed', 'blocked')
    RETURNING id, registry_slug, status, attempt, max_attempts
  `;
  const run = rows[0];
  if (!run) throw new Error(`Run ${id} is not failed or blocked`);

  await sql`
    INSERT INTO process_audit_events (
      registry_slug,
      event_type,
      actor,
      details
    )
    VALUES (
      ${run.registry_slug},
      'run_retry_requested',
      ${actor},
      ${JSON.stringify({
        run_id: run.id,
        attempt: run.attempt,
        max_attempts: run.max_attempts,
      })}::jsonb
    )
  `;

  return run;
}
