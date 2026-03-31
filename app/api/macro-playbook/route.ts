import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { auth } from "@/auth";

const execAsync = promisify(exec);

const SCRIPT_PATH =
  process.env.HEDGE_ARB_SCRIPT ||
  "/Users/sdg223157/botboard-private/scripts/hedge_arb_framework.py";

export const maxDuration = 300;

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { stdout, stderr } = await execAsync(
      `python3 "${SCRIPT_PATH}" --json`,
      { timeout: 240_000, maxBuffer: 10 * 1024 * 1024 }
    );

    if (!stdout.trim()) {
      return NextResponse.json(
        { error: "Empty response from framework", stderr: stderr.slice(-500) },
        { status: 500 }
      );
    }

    const data = JSON.parse(stdout);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Framework execution failed", detail: message.slice(-500) },
      { status: 500 }
    );
  }
}
