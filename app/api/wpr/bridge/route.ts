import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const SAFE_COMMANDS = new Set([
  "list",
  "item",
  "metadata",
  "versions",
  "runs",
  "artifacts",
  "path",
  "plan",
]);
const RUN_FLAGS = new Set(["--run", "--create"]);

function textResponse(text: string, status = 200) {
  return new NextResponse(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function authenticate(req: NextRequest) {
  const expected = process.env.WPR_BRIDGE_TOKEN;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${expected}`;
}

function normalizeArgs(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("`args` must be an array.");
  if (value.length > 16) throw new Error("Too many WPR arguments.");
  return value.map((arg) => {
    if (typeof arg !== "string") throw new Error("All WPR arguments must be strings.");
    if (arg.length > 500) throw new Error("One WPR argument is too long.");
    return arg;
  });
}

function assertSafeArgs(args: string[], allowRun: boolean) {
  if (!args.length) throw new Error("No WPR arguments provided.");
  if (args.some((arg) => arg.includes("\0"))) throw new Error("Invalid WPR argument.");
  if (!allowRun && args.some((arg) => RUN_FLAGS.has(arg))) {
    throw new Error("WPR run/create flags are disabled for this bridge.");
  }

  const command = args[0];
  const plainSuggestion = command && !command.startsWith("--") && !SAFE_COMMANDS.has(command);
  if (!plainSuggestion && !SAFE_COMMANDS.has(command)) {
    throw new Error(`WPR command is not allowed: ${command}`);
  }
}

export async function POST(req: NextRequest) {
  if (!authenticate(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let args: string[];
  let allowRun = false;
  try {
    const body = await req.json();
    args = normalizeArgs(body?.args);
    allowRun =
      process.env.WPR_BRIDGE_ALLOW_RUN === "true" && body?.allow_run === true;
    assertSafeArgs(args, allowRun);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 },
    );
  }

  try {
    const timeout = Math.max(1000, Number(process.env.WPR_BRIDGE_TIMEOUT_MS ?? 45000));
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["scripts/wpr-cli.mjs", ...args],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout,
        maxBuffer: 1024 * 1024,
      },
    );
    return textResponse([stdout, stderr].filter(Boolean).join("\n"));
  } catch (error) {
    const anyError = error as { stdout?: string; stderr?: string; message?: string };
    const output = [anyError.stdout, anyError.stderr, anyError.message]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000);
    return textResponse(output || "WPR bridge failed.", 500);
  }
}
