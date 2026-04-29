import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { retryProcessRun } from "@/lib/process-registry";

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
  const redirectTo = String(form.get("redirect_to") ?? `/processes/runs/${id}`);

  await retryProcessRun(
    Number(id),
    session.user.email ?? session.user.name ?? "web-ui"
  );

  revalidatePath("/processes/runs");
  revalidatePath(`/processes/runs/${id}`);

  return NextResponse.redirect(new URL(redirectTo, req.url), 303);
}
