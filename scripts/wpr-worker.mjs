#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SERVER_INFO,
  claimPendingProcessRun,
  executeRunningProcessRun,
} from "./process-registry-mcp.mjs";

const DEFAULT_INTERVAL_MS = 5000;

function parseArgs(argv) {
  const options = {
    once: false,
    intervalMs: DEFAULT_INTERVAL_MS,
    limit: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--once") {
      options.once = true;
    } else if (arg === "--interval") {
      options.intervalMs = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--limit") {
      options.limit = Number(argv[i + 1]);
      i += 1;
    }
  }

  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 250) {
    throw new Error("--interval must be at least 250 milliseconds");
  }
  if (options.limit != null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }

  return options;
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function summarizeResult(result) {
  if (result.run) {
    return `completed #${result.run.id} ${result.run.registry_slug}`;
  }
  return `${result.status} #${result.id} ${result.registry_slug}`;
}

async function workOnce() {
  const run = await claimPendingProcessRun({ claimed_by: "wpr-worker" });
  if (!run) return null;

  console.log(`claimed #${run.id} ${run.registry_slug}`);
  const result = await executeRunningProcessRun(run);
  console.log(summarizeResult(result));
  return result;
}

async function startWorker(options = {}) {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const once = Boolean(options.once);
  const limit = options.limit ?? null;
  let processed = 0;
  let shouldStop = false;

  const stop = () => {
    shouldStop = true;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  console.log(`${SERVER_INFO.name} worker started`);

  while (!shouldStop) {
    const result = await workOnce();

    if (result) {
      processed += 1;
      if (limit != null && processed >= limit) break;
      continue;
    }

    if (once) break;
    await sleep(intervalMs);
  }

  console.log(`${SERVER_INFO.name} worker stopped after ${processed} run(s)`);
  return { processed };
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectRun) {
  startWorker(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

export { parseArgs, startWorker, workOnce };
