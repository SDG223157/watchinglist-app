import { auth } from "@/auth";
import { fetchVarieties } from "@/lib/futures";
import { jsonWithCache } from "@/lib/cache-headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return jsonWithCache({ error: "Unauthorized" }, "none", 401);

  const data = await fetchVarieties();
  if (!data) return jsonWithCache({ error: "Futures data source offline" }, "none", 502);

  return jsonWithCache(data, "medium");
}
