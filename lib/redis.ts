import Redis from "ioredis";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
    client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      retryStrategy: (times) => (times > 2 ? null : Math.min(times * 500, 2000)),
      enableReadyCheck: false,
    });
    client.on("error", () => {});
  }
  return client;
}

const PREFIX = "wl:";

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedis().get(`${PREFIX}${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 86400): Promise<void> {
  try {
    await getRedis().set(`${PREFIX}${key}`, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // graceful degradation — app works without Redis
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    await getRedis().del(`${PREFIX}${key}`);
  } catch {}
}
