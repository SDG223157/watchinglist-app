import { getDb } from "./db";

export interface CachedEntropyRow {
  symbol: string;
  data: string; // JSON-stringified EnhancedProfile
  computed_at: string;
}

export async function ensureEntropyCacheTable() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS entropy_cache (
      symbol VARCHAR(30) PRIMARY KEY,
      data JSONB NOT NULL,
      portfolio JSONB,
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function saveEntropyCache(
  profiles: Record<string, unknown>[],
  portfolio: Record<string, unknown>,
) {
  const sql = getDb();
  const now = new Date().toISOString();

  await sql`DELETE FROM entropy_cache`;

  for (const p of profiles) {
    await sql`
      INSERT INTO entropy_cache (symbol, data, computed_at)
      VALUES (${(p as { symbol: string }).symbol}, ${JSON.stringify(p)}, ${now})
      ON CONFLICT (symbol) DO UPDATE SET data = ${JSON.stringify(p)}, computed_at = ${now}
    `;
  }

  await sql`
    INSERT INTO entropy_cache (symbol, data, portfolio, computed_at)
    VALUES ('__portfolio__', '{}', ${JSON.stringify(portfolio)}, ${now})
    ON CONFLICT (symbol) DO UPDATE SET portfolio = ${JSON.stringify(portfolio)}, computed_at = ${now}
  `;
}

export async function loadEntropyCache(): Promise<{
  profiles: Record<string, unknown>[];
  portfolio: Record<string, unknown>;
  computed_at: string;
} | null> {
  const sql = getDb();

  try {
    const rows = await sql`SELECT symbol, data, portfolio, computed_at FROM entropy_cache ORDER BY symbol`;
    if (!rows || rows.length === 0) return null;

    const profiles: Record<string, unknown>[] = [];
    let portfolio: Record<string, unknown> = {};
    let computed_at = "";

    for (const row of rows) {
      if (row.symbol === "__portfolio__") {
        portfolio = row.portfolio as Record<string, unknown>;
        computed_at = String(row.computed_at);
      } else {
        profiles.push(row.data as Record<string, unknown>);
      }
    }

    if (profiles.length === 0) return null;
    if (!computed_at) computed_at = String(rows[0].computed_at);

    return { profiles, portfolio, computed_at };
  } catch {
    return null;
  }
}

export function isCacheStale(computedAt: string, maxAgeHours = 20): boolean {
  const age = Date.now() - new Date(computedAt).getTime();
  return age > maxAgeHours * 60 * 60 * 1000;
}
