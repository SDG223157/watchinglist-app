import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchProcessRegistry,
  summarizeRegistry,
} from "@/lib/process-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const items = await fetchProcessRegistry();

  return NextResponse.json({
    summary: summarizeRegistry(items),
    items,
  });
}
