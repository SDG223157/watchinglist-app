import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { auth } from "@/auth";
import { jsonWithCache } from "@/lib/cache-headers";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return jsonWithCache({ error: "Unauthorized" }, "none", 401);
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return jsonWithCache({ error: "Missing id" }, "none", 400);
  }

  const sql = getDb();
  const rows = await sql`SELECT charts FROM pca_reports WHERE id = ${Number(id)}`;
  if (!rows.length) {
    return jsonWithCache({ error: "Not found" }, "none", 404);
  }

  return jsonWithCache(
    { charts: (rows[0] as unknown as { charts: Record<string, string> }).charts },
    "long"
  );
}
