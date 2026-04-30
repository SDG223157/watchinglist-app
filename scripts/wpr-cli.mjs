#!/usr/bin/env node

import {
  callTool,
  resolveOperationPath,
  triggerProcessRun,
} from "./process-registry-mcp.mjs";
import { parseArgs as parseWorkerArgs, startWorker } from "./wpr-worker.mjs";

const COMMANDS = new Set([
  "help",
  "list",
  "item",
  "metadata",
  "versions",
  "runs",
  "artifacts",
  "assets",
  "run",
  "worker",
  "path",
  "plan",
  "skill-draft",
  "audit-skills",
  "import-skills",
]);

function usage() {
  return `WPR CLI

Usage:
  wpr <input>                         Suggest operations for data input
  wpr <input> <operation...>          Resolve an operation path
  wpr <input> <operation...> --create Create a pending run
  wpr <input> <operation...> --run    Create and trigger a run
  wpr path "wpr/aapl/price structure" Resolve a slash path
  wpr plan "analyze AAPL and create a meeting" Suggest skill building blocks
  wpr plan "analyze AAPL and create a meeting" --run Execute plan blocks and synthesize artifacts
  wpr plan "analyze AAPL and create a meeting" --llm Refine plan with configured LLM
  wpr skill-draft "scan US stocks for moat deterioration" Create a draft skill for a missing capability
  wpr run <run_id>                    Trigger a pending run
  wpr worker [--once]                 Run the Postgres-backed worker

Other commands:
  wpr list [--type skill] [--status active]
  wpr item <slug>
  wpr metadata <skill_slug>
  wpr versions <slug> [limit]
  wpr runs <slug> [limit]
  wpr artifacts [slug] [limit]
  wpr assets [asset_type|tag] [limit]
  wpr audit-skills [--run-built-ins|--run-all]
  wpr import-skills [directory] [--dry-run]
  wpr worker --interval 5000

Options:
  --create   Create a pending run when resolving a path
  --run      Create then immediately trigger the pending run
             With plan, execute selected blocks and create a task_synthesis artifact
  --llm      Use configured LLM support for planning
  --create-file Also create ~/.cursor/skills/<slug>/SKILL.md for skill-draft
  --activate Create a skill-draft as active instead of draft
  --model    Override WPR_LLM_MODEL for one LLM planning call
  --json     Print raw JSON
`;
}

function parseArgv(argv) {
  const flags = new Set();
  const values = {};
  const args = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (inlineValue != null) {
      values[key] = inlineValue;
      continue;
    }

    if (["type", "status", "limit", "model", "provider", "slug", "name"].includes(rawKey)) {
      values[key] = argv[i + 1];
      i += 1;
      continue;
    }

    flags.add(key);
  }

  return { args, flags, values };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function isInteger(value) {
  return /^\d+$/.test(String(value ?? ""));
}

function formatStock(stock) {
  if (!stock) return "No watchlist stock row matched.";
  const parts = [stock.symbol, stock.name, stock.market].filter(Boolean);
  return parts.join(" | ");
}

function printRegistry(result) {
  const summary = result.summary;
  console.log(
    `Registry: ${summary.total} objects, ${summary.active} active, ${summary.draft} draft, ${summary.review} review`
  );
  for (const item of result.items.slice(0, 30)) {
    console.log(`- ${item.slug} [${item.object_type}/${item.status}] ${item.name}`);
  }
  if (result.items.length > 30) {
    console.log(`... ${result.items.length - 30} more`);
  }
}

function printItem(item) {
  console.log(`${item.slug} [${item.object_type}/${item.status}] v${item.version}`);
  console.log(item.name);
  if (item.description) console.log(item.description);
  if (item.tags?.length) console.log(`tags: ${item.tags.join(", ")}`);
}

function printMetadata(meta) {
  console.log(`${meta.registry_slug} metadata`);
  console.log(`risk: ${meta.risk_level}`);
  if (meta.trigger_terms?.length) {
    console.log(`trigger terms: ${meta.trigger_terms.slice(0, 20).join(", ")}`);
  }
  if (meta.routing_keywords?.length) {
    console.log(`routing keywords: ${meta.routing_keywords.slice(0, 20).join(", ")}`);
  }
  if (meta.required_tools?.length) {
    console.log(`required tools: ${meta.required_tools.map((tool) => tool.name ?? tool).join(", ")}`);
  }
  if (meta.artifact_types?.length) {
    console.log(`artifacts: ${meta.artifact_types.join(", ")}`);
  }
  if (meta.approval_requirements?.length) {
    console.log(`approvals: ${meta.approval_requirements.join(", ")}`);
  }
  const hints = meta.operation_hints ?? {};
  if (hints.required_assets?.length) console.log(`required assets: ${hints.required_assets.join(", ")}`);
  if (hints.optional_assets?.length) console.log(`optional assets: ${hints.optional_assets.join(", ")}`);
  if (hints.produced_assets?.length) console.log(`produced assets: ${hints.produced_assets.join(", ")}`);
}

function printRuns(result) {
  for (const run of result.runs) {
    const output = run.outputs ? ` -> ${JSON.stringify(run.outputs)}` : "";
    const retry = run.next_retry_at ? ` next_retry=${run.next_retry_at}` : "";
    const failure = run.failure_category ? ` failure=${run.failure_category}` : "";
    const version = run.registry_version_id
      ? ` v${run.registry_version}#${run.registry_version_id}`
      : ` v${run.registry_version ?? "?"}`;
    console.log(
      `#${run.id} ${run.registry_slug}${version} [${run.status}] attempt=${run.attempt ?? 1}/${run.max_attempts ?? 1}${failure}${retry}${output}`
    );
  }
}

function printVersions(result) {
  for (const version of result.versions) {
    const activated = version.activated_at ? ` activated=${version.activated_at}` : "";
    console.log(
      `#${version.id} ${version.registry_slug} v${version.version} [${version.status}] hash=${String(version.source_hash).slice(0, 12)}${activated}`
    );
  }
}

function printArtifacts(result) {
  for (const artifact of result.artifacts) {
    console.log(
      `#${artifact.id} run ${artifact.run_id} ${artifact.registry_slug}/${artifact.artifact_type} [${artifact.status}] ${artifact.title}`
    );
    if (artifact.json_content?.structure) {
      console.log(
        `  ${artifact.json_content.symbol}: ${artifact.json_content.structure}, close ${artifact.json_content.latest_close}`
      );
    }
  }
}

function printSuggestions(result) {
  console.log(`${result.input} (${result.detected_type})`);
  console.log(formatStock(result.matched_stock));
  console.log("");
  console.log("Options:");
  for (const option of result.options) {
    const state = option.enabled ? "enabled" : "disabled";
    const target = option.tool
      ? `${option.tool} ${JSON.stringify(option.arguments ?? {})}`
      : option.url ?? option.kind;
    console.log(`- ${option.label} [${state}]`);
    console.log(`  ${target}`);
  }
}

function printResolved(result) {
  console.log(result.path);
  console.log(`data: ${result.data_input} (${result.detected_type})`);
  console.log(formatStock(result.matched_stock));

  if (!result.matched_operation) {
    console.log("No operation matched.");
    return;
  }

  const op = result.matched_operation;
  console.log(
    `operation: ${op.slug} [${op.status}] score ${op.score}, risk ${op.risk_level}`
  );
  if (result.action) {
    console.log(`action: ${result.action.label}`);
  }
  if (result.executed_run) {
    console.log(`pending run: #${result.executed_run.id} [${result.executed_run.status}]`);
  }
  if (result.alternatives?.length) {
    console.log("alternatives:");
    for (const alt of result.alternatives) {
      console.log(`- ${alt.slug} [${alt.status}] score ${alt.score}`);
    }
  }
}

function printTrigger(result) {
  if (result.run) {
    console.log(
      `#${result.run.id} ${result.run.registry_slug} v${result.run.registry_version ?? "?"}${result.run.registry_version_id ? `#${result.run.registry_version_id}` : ""} [${result.run.status}] attempt=${result.run.attempt ?? 1}/${result.run.max_attempts ?? 1}`
    );
    if (result.run.outputs) console.log(JSON.stringify(result.run.outputs, null, 2));
  } else {
    const retry = result.next_retry_at ? ` next_retry=${result.next_retry_at}` : "";
    const failure = result.failure_category ? ` failure=${result.failure_category}` : "";
    console.log(
      `#${result.id} ${result.registry_slug} [${result.status}] attempt=${result.attempt ?? 1}/${result.max_attempts ?? 1}${failure}${retry}`
    );
    if (result.message) console.log(result.message);
  }

  if (result.artifacts?.length) {
    console.log("artifacts:");
    for (const artifact of result.artifacts) {
      console.log(`- #${artifact.id} ${artifact.title} [${artifact.status}]`);
      if (artifact.json_content?.markdown) {
        console.log("");
        console.log(artifact.json_content.markdown.trim());
      }
    }
  }
}

function printAssets(result) {
  for (const asset of result.assets ?? []) {
    const tags = asset.tags?.length ? ` tags=${asset.tags.join(",")}` : "";
    console.log(`- ${asset.asset_type}: ${asset.name} [${asset.source_kind}:${asset.source_ref}]${tags}`);
    if (asset.description) console.log(`  ${asset.description}`);
    if (asset.freshness_policy && Object.keys(asset.freshness_policy).length) {
      console.log(`  freshness: ${JSON.stringify(asset.freshness_policy)}`);
    }
  }
}

function printSkillDraft(result) {
  const item = result.item;
  console.log(`${item.slug} [${item.status}] ${item.name}`);
  console.log(item.description);
  console.log(`version: #${result.version.id} v${result.version.version}`);
  console.log(`runner: ${result.runner.runner_kind}/${result.runner.executor}`);
  console.log(`risk: ${result.metadata.risk_level}`);
  if (result.metadata.artifact_types?.length) {
    console.log(`artifacts: ${result.metadata.artifact_types.join(", ")}`);
  }
  const hints = result.metadata.operation_hints ?? {};
  if (hints.required_assets?.length) console.log(`required assets: ${hints.required_assets.join(", ")}`);
  if (hints.optional_assets?.length) console.log(`optional assets: ${hints.optional_assets.join(", ")}`);
  if (hints.produced_assets?.length) console.log(`produced assets: ${hints.produced_assets.join(", ")}`);
  if (result.skill_path) console.log(`skill file: ${result.skill_path}`);
  if (result.next_steps?.length) {
    console.log("next:");
    for (const step of result.next_steps) console.log(`- ${step}`);
  }
}

function printSkillAudit(result) {
  const summary = result.summary;
  console.log(
    `Skills: ${summary.total_skills} total, ${summary.active_skills} active, ${summary.built_in_runners} built-in runner(s), ${summary.generic_runners} generic runner(s), ${summary.missing_runners} missing runner(s)`
  );
  console.log(
    `Schemas: ${summary.typed_input_schema} typed, ${summary.inferred_or_permissive_input_schema} inferred/permissive/missing`
  );

  if (summary.smoke_runs) {
    console.log(
      `Smoke runs: ${summary.smoke_completed}/${summary.smoke_runs} completed with artifacts, ${summary.smoke_failed} failed`
    );
    for (const run of result.smoke_runs) {
      const artifacts = run.artifact_ids.length ? ` artifacts=${run.artifact_ids.join(",")}` : "";
      const error = run.error ? ` error=${run.error}` : "";
      console.log(`- ${run.slug}: ${run.status} run=${run.run_id ?? "n/a"}${artifacts}${error}`);
    }
  }

  const problems = result.skills.filter((skill) => skill.issues.length > 0);
  if (problems.length) {
    console.log("");
    console.log(`Issues (${problems.length}):`);
    for (const skill of problems) {
      console.log(
        `- ${skill.slug}: schema=${skill.input_schema_status}, runner=${skill.runner_status}; ${skill.issues.join("; ")}`
      );
    }
  }
}

function printTaskPlan(result) {
  const intent = result.intent;
  console.log(`Intent: ${intent.task_type}`);
  if (intent.entities?.tickers?.length) console.log(`tickers: ${intent.entities.tickers.join(", ")}`);
  if (intent.desired_artifacts?.length) {
    console.log(`desired artifacts: ${intent.desired_artifacts.join(", ")}`);
  }

  console.log("");
  console.log("Skill candidates:");
  for (const candidate of result.skill_candidates.slice(0, 12)) {
    const approvals = candidate.approval_requirements?.length
      ? ` approvals=${candidate.approval_requirements.join(",")}`
      : "";
    console.log(
      `- ${candidate.slug} score=${candidate.score} runner=${candidate.runner_kind} risk=${candidate.risk_level}${approvals}`
    );
    if (candidate.why?.length) console.log(`  why: ${candidate.why.join("; ")}`);
    console.log(`  inputs: ${JSON.stringify(candidate.suggested_inputs)}`);
    if (candidate.asset_context?.available?.length) {
      console.log(
        `  assets: ${candidate.asset_context.available
          .map((asset) => `${asset.asset_type}=${asset.freshness}`)
          .join(", ")}`
      );
    }
    const missingRequired = (candidate.asset_context?.missing ?? []).filter((asset) => asset.required);
    if (missingRequired.length) {
      console.log(`  missing required assets: ${missingRequired.map((asset) => asset.asset_type).join(", ")}`);
    }
  }

  if (result.plans?.length) {
    console.log("");
    console.log("Recommended plans:");
    for (const plan of result.plans) {
      console.log(
        `- ${plan.label} risk=${plan.risk_level} approval=${plan.requires_approval ? "yes" : "no"} executable=${plan.executable_now ? "yes" : "no"}`
      );
      for (const node of plan.nodes) {
        const deps = node.depends_on?.length ? ` after=${node.depends_on.join(",")}` : "";
        console.log(`  - ${node.id}: ${node.slug} (${node.runner_kind})${deps}`);
      }
    }
  }

  if (result.skill_gap?.detected) {
    const proposal = result.skill_gap.proposed_skill;
    console.log("");
    console.log("Missing skill proposal:");
    console.log(`- ${proposal.slug} [${proposal.status}] ${proposal.name}`);
    console.log(`  reason: ${result.skill_gap.reason}`);
    console.log(`  runner: ${proposal.runner_kind}, risk=${proposal.risk_level}`);
    if (proposal.required_assets?.length) console.log(`  required assets: ${proposal.required_assets.join(", ")}`);
    if (proposal.optional_assets?.length) console.log(`  optional assets: ${proposal.optional_assets.join(", ")}`);
    if (proposal.produced_assets?.length) console.log(`  produced assets: ${proposal.produced_assets.join(", ")}`);
    if (result.skill_gap.existing_draft) {
      console.log(`  existing draft: ${result.skill_gap.existing_draft.slug} [${result.skill_gap.existing_draft.status}]`);
      console.log(`  inspect: ${result.skill_gap.create_command}`);
    } else {
      console.log(`  create: ${result.skill_gap.create_command}`);
    }
  }

  if (result.llm?.enabled) {
    console.log("");
    console.log(
      `LLM planner: ${result.llm.status} provider=${result.llm.provider} model=${result.llm.model}`
    );
    if (result.llm.error) console.log(`  error: ${result.llm.error}`);
    if (result.llm.plan) {
      const plan = result.llm.plan;
      console.log(`  ${plan.label}: ${plan.summary || "no summary"}`);
      for (const node of plan.nodes ?? []) {
        const deps = node.depends_on?.length ? ` after=${node.depends_on.join(",")}` : "";
        const reason = node.llm_reason ? ` - ${node.llm_reason}` : "";
        console.log(`  - ${node.id}: ${node.slug}${deps}${reason}`);
      }
      if (plan.risk_notes?.length) console.log(`  risk: ${plan.risk_notes.join("; ")}`);
      if (plan.missing_capabilities?.length) {
        console.log(`  gaps: ${plan.missing_capabilities.join("; ")}`);
      }
    }
  }
}

function printTaskExecution(result) {
  printTaskPlan(result.planning);
  console.log("");
  console.log("Executed plan:");
  console.log(`- ${result.plan.label}`);
  for (const run of result.child_runs ?? []) {
    const artifactIds = (run.artifacts ?? []).map((artifact) => `#${artifact.id}`).join(", ") || "none";
    const error = run.error ? ` error=${run.error}` : "";
    console.log(`  - ${run.slug}: ${run.status} run #${run.run_id} artifacts ${artifactIds}${error}`);
  }
  if (result.synthesis_artifact) {
    console.log("");
    console.log(
      `synthesis artifact: #${result.synthesis_artifact.id} ${result.synthesis_artifact.title} [${result.synthesis_artifact.status}]`
    );
    if (result.synthesis_artifact.json_content?.markdown) {
      console.log("");
      console.log(result.synthesis_artifact.json_content.markdown.trim());
    }
  }
}

async function createAndMaybeTrigger(path, shouldCreate, shouldRun) {
  const resolved = await resolveOperationPath({
    path,
    execute: shouldCreate || shouldRun,
  });

  if (!shouldRun) return resolved;

  const runId = resolved.executed_run?.id;
  if (!runId) {
    throw new Error("No pending run was created, so there is nothing to trigger.");
  }

  return {
    resolved,
    triggered: await triggerProcessRun({ run_id: Number(runId) }),
  };
}

function pathFromArgs(args) {
  if (args.length === 1 && args[0].includes("/")) return args[0];
  if (args[0]?.includes("/")) return `${args[0]}/${args.slice(1).join(" ")}`;
  return `wpr/${args[0]}/${args.slice(1).join(" ")}`;
}

function parseSinglePathArg(path) {
  const parts = String(path ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts[0]?.toLowerCase() === "wpr") parts.shift();

  return {
    dataInput: parts[0],
    operationQuery: parts.slice(1).join(" ").trim(),
  };
}

async function main() {
  const rawArgv = process.argv.slice(2);
  const { args, flags, values } = parseArgv(rawArgv);
  const command = args[0];
  const asJson = flags.has("json");

  if (!command || command === "help" || flags.has("help")) {
    console.log(usage());
    return;
  }

  let result;
  let printer = printJson;

  if (command === "list") {
    result = await callTool("list_process_registry", {
      object_type: values.type,
      status: values.status,
    });
    printer = printRegistry;
  } else if (command === "item") {
    if (!args[1]) throw new Error("item requires a slug");
    result = await callTool("get_process_registry_item", { slug: args[1] });
    printer = printItem;
  } else if (command === "metadata") {
    if (!args[1]) throw new Error("metadata requires a skill slug");
    result = await callTool("get_skill_operation_metadata", { slug: args[1] });
    printer = printMetadata;
  } else if (command === "versions") {
    if (!args[1]) throw new Error("versions requires a registry slug");
    result = await callTool("list_process_registry_versions", {
      slug: args[1],
      limit: args[2] ? Number(args[2]) : undefined,
    });
    printer = printVersions;
  } else if (command === "runs") {
    if (!args[1]) throw new Error("runs requires a registry slug");
    result = await callTool("list_process_runs", {
      slug: args[1],
      limit: args[2] ? Number(args[2]) : undefined,
    });
    printer = printRuns;
  } else if (command === "artifacts") {
    result = await callTool("list_process_artifacts", {
      slug: args[1] && !isInteger(args[1]) ? args[1] : undefined,
      limit: isInteger(args[1]) ? Number(args[1]) : args[2] ? Number(args[2]) : undefined,
    });
    printer = printArtifacts;
  } else if (command === "assets") {
    result = await callTool("list_wpr_asset_catalog", {
      asset_type: args[1] && !isInteger(args[1]) ? args[1] : undefined,
      tag: args[1] && !isInteger(args[1]) ? args[1] : undefined,
      limit: isInteger(args[1]) ? Number(args[1]) : args[2] ? Number(args[2]) : undefined,
    });
    printer = printAssets;
  } else if (command === "run") {
    if (!isInteger(args[1])) throw new Error("run requires a numeric run id");
    result = await triggerProcessRun({ run_id: Number(args[1]) });
    printer = printTrigger;
  } else if (command === "worker") {
    const workerArgv = rawArgv.slice(rawArgv.indexOf("worker") + 1);
    result = await startWorker(parseWorkerArgs(workerArgv));
    printer = () => {};
  } else if (command === "path") {
    if (!args[1]) throw new Error("path requires a slash path");
    result = await createAndMaybeTrigger(
      args.slice(1).join(" "),
      flags.has("create"),
      flags.has("run")
    );
    printer = result.triggered
      ? (value) => {
          printResolved(value.resolved);
          console.log("");
          printTrigger(value.triggered);
        }
      : printResolved;
  } else if (command === "plan") {
    if (!args[1]) throw new Error("plan requires a user intent");
    result = await callTool(flags.has("run") ? "execute_task_plan" : "suggest_task_plan", {
      input: args.slice(1).join(" "),
      limit: values.limit ? Number(values.limit) : undefined,
      use_llm: flags.has("llm"),
      llm_provider: values.provider,
      llm_model: values.model,
    });
    printer = flags.has("run") ? printTaskExecution : printTaskPlan;
  } else if (command === "skill-draft") {
    if (!args[1]) throw new Error("skill-draft requires a user intent");
    result = await callTool("draft_missing_skill", {
      input: args.slice(1).join(" "),
      slug: values.slug,
      name: values.name,
      create_file: flags.has("createFile"),
      activate: flags.has("activate"),
    });
    printer = printSkillDraft;
  } else if (command === "audit-skills") {
    result = await callTool("audit_process_registry_skills", {
      run_built_ins: flags.has("runBuiltIns"),
      run_all: flags.has("runAll"),
    });
    printer = printSkillAudit;
  } else if (command === "import-skills") {
    result = await callTool("import_skills_from_directory", {
      directory: args[1],
      dry_run: flags.has("dryRun"),
    });
  } else if (COMMANDS.has(command)) {
    throw new Error(`Unhandled command: ${command}`);
  } else if (args.length === 1 && !args[0].includes("/")) {
    result = await callTool("suggest_data_operations", { input: args[0] });
    printer = printSuggestions;
  } else if (args.length === 1 && args[0].includes("/")) {
    const parsedPath = parseSinglePathArg(args[0]);
    if (!parsedPath.operationQuery && !flags.has("create") && !flags.has("run")) {
      result = await callTool("suggest_data_operations", { input: parsedPath.dataInput });
      printer = printSuggestions;
    } else {
      result = await createAndMaybeTrigger(
        args[0],
        flags.has("create"),
        flags.has("run")
      );
      printer = result.triggered
        ? (value) => {
            printResolved(value.resolved);
            console.log("");
            printTrigger(value.triggered);
          }
        : printResolved;
    }
  } else {
    result = await createAndMaybeTrigger(
      pathFromArgs(args),
      flags.has("create"),
      flags.has("run")
    );
    printer = result.triggered
      ? (value) => {
          printResolved(value.resolved);
          console.log("");
          printTrigger(value.triggered);
        }
      : printResolved;
  }

  if (asJson) {
    printJson(result);
  } else {
    printer(result);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
