/**
 * Standard Cache-Control headers for Cloudflare edge caching.
 *
 * Cloudflare respects Cache-Control on responses:
 * - s-maxage = edge cache TTL (Cloudflare CDN)
 * - max-age = browser cache TTL
 * - stale-while-revalidate = serve stale while origin refreshes
 *
 * CDN-Cache-Control overrides Cache-Control for Cloudflare only,
 * so browsers get a short max-age while the edge holds longer.
 */

export function withCacheHeaders(
  res: Response,
  profile: "short" | "medium" | "long" | "immutable" | "none"
): Response {
  const headers: Record<string, string> = {
    short: "public, s-maxage=60, max-age=30, stale-while-revalidate=120",
    medium: "public, s-maxage=300, max-age=60, stale-while-revalidate=600",
    long: "public, s-maxage=3600, max-age=300, stale-while-revalidate=7200",
    immutable: "public, max-age=31536000, immutable",
    none: "private, no-store",
  };

  res.headers.set("Cache-Control", headers[profile]);
  return res;
}

export function jsonWithCache(
  data: unknown,
  profile: "short" | "medium" | "long" | "none",
  status = 200
): Response {
  const res = Response.json(data, { status });
  const headers: Record<string, string> = {
    short: "public, s-maxage=60, max-age=30, stale-while-revalidate=120",
    medium: "public, s-maxage=300, max-age=60, stale-while-revalidate=600",
    long: "public, s-maxage=3600, max-age=300, stale-while-revalidate=7200",
    none: "private, no-store",
  };
  res.headers.set("Cache-Control", headers[profile]);
  return res;
}
