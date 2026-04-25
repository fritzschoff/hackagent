import { Redis } from "@upstash/redis";
import type { Job, CronStatus } from "@/lib/types";

let cached: Redis | null = null;

export function getRedis(): Redis | null {
  if (cached) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  cached = new Redis({ url, token });
  return cached;
}

export async function pushJob(job: Job): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.lpush("jobs:recent", JSON.stringify(job));
  await r.ltrim("jobs:recent", 0, 199);
  await r.incrby("agent:earnings_cents", 100);
}

export async function getRecentJobs(limit = 50): Promise<Job[]> {
  const r = getRedis();
  if (!r) return [];
  const raw = await r.lrange<string>("jobs:recent", 0, limit - 1);
  return raw
    .map((s) => {
      try {
        return typeof s === "string" ? JSON.parse(s) : s;
      } catch {
        return null;
      }
    })
    .filter((x): x is Job => x !== null);
}

export async function getEarningsCents(): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  const v = await r.get<number | string>("agent:earnings_cents");
  return typeof v === "number" ? v : Number(v ?? 0);
}

export const CRON_ROUTES = [
  "/api/cron/agent-tick",
  "/api/cron/client-tick",
  "/api/cron/validator-tick",
  "/api/cron/storage-sync",
  "/api/cron/reputation-cache",
  "/api/cron/ens-heartbeat",
] as const;

export async function recordCronTick(
  route: string,
  status: "ok" | "fail",
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.hset(`cron:${route}`, { ts: Date.now(), status });
}

export async function getCronTick(
  route: string,
): Promise<{ ts: number; status: "ok" | "fail" } | null> {
  const r = getRedis();
  if (!r) return null;
  const v = await r.hgetall<{ ts: string | number; status: "ok" | "fail" }>(
    `cron:${route}`,
  );
  if (!v || !v.ts) return null;
  return { ts: Number(v.ts), status: v.status };
}

export async function getAllCronStatuses(): Promise<CronStatus[]> {
  const now = Date.now();
  const results = await Promise.all(
    CRON_ROUTES.map(async (route) => {
      const tick = await getCronTick(route);
      return {
        route,
        lastTickAgoSec: tick ? Math.round((now - tick.ts) / 1000) : null,
        lastStatus: tick?.status ?? null,
      } satisfies CronStatus;
    }),
  );
  return results;
}
