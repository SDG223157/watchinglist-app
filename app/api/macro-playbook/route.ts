import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runPlaybook } from "@/lib/macro-playbook";

export const maxDuration = 120;

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await runPlaybook();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[macro-playbook]", message);
    return NextResponse.json(
      { error: "Framework execution failed", detail: message.slice(0, 500) },
      { status: 500 }
    );
  }
}
