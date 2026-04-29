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
