import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  updateProcessArtifactStatus,
  type ProcessArtifactStatus,
} from "@/lib/process-registry";

const ALLOWED_STATUSES = new Set<ProcessArtifactStatus>([
  "needs_review",
  "approved",
  "published",
  "archived",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const form = await req.formData();
  const status = String(form.get("status") ?? "") as ProcessArtifactStatus;
  const redirectTo = String(form.get("redirect_to") ?? "/processes/artifacts");

  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid artifact status" }, { status: 400 });
  }

  await updateProcessArtifactStatus(
    Number(id),
    status,
    session.user.email ?? session.user.name ?? "web-ui"
  );

  revalidatePath("/processes/artifacts");
  revalidatePath(redirectTo);

  return NextResponse.redirect(new URL(redirectTo, req.url), 303);
}
