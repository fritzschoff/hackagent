import IORedis, { type Redis } from "ioredis";
import type { Job, CronStatus } from "@/lib/types";

let cached: Redis | null = null;

export function getRedis(): Redis | null {
  if (cached) return cached;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  cached = new IORedis(url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: false,
    lazyConnect: false,
    connectTimeout: 5000,
  });
  cached.on("error", (err) => {
    console.error("[redis] connection error:", err.message);
  });
  return cached;
}

export async function pushJob(job: Job): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.lpush("jobs:recent", JSON.stringify(job));
  await r.ltrim("jobs:recent", 0, 199);
}

export async function recordSettledPayment(args: {
  jobId: string;
  txHash: string;
  payer: string;
}): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const added = await r.sadd("agent:settled-jobs", args.jobId);
  if (added === 1) {
    await r.incrby("agent:earnings_cents", 10);
    await r.lpush(
      "agent:settled-payments",
      JSON.stringify({ ...args, ts: Date.now() }),
    );
    await r.ltrim("agent:settled-payments", 0, 199);
  }
}

export async function getRecentJobs(limit = 50): Promise<Job[]> {
  const r = getRedis();
  if (!r) return [];
  const raw = await r.lrange("jobs:recent", 0, limit - 1);
  return raw
    .map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    })
    .filter((x): x is Job => x !== null);
}

export async function getEarningsCents(): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  const v = await r.get("agent:earnings_cents");
  return Number(v ?? 0);
}

export type KeeperhubRun = {
  jobId: string;
  workflowRunId: string;
  txHash: string;
  ts: number;
};

export async function pushKeeperhubRun(run: KeeperhubRun): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.lpush("keeperhub:runs", JSON.stringify(run));
  await r.ltrim("keeperhub:runs", 0, 49);
}

export async function getRecentKeeperhubRuns(
  limit = 10,
): Promise<KeeperhubRun[]> {
  const r = getRedis();
  if (!r) return [];
  const raw = await r.lrange("keeperhub:runs", 0, limit - 1);
  return raw
    .map((s) => {
      try {
        return JSON.parse(s) as KeeperhubRun;
      } catch {
        return null;
      }
    })
    .filter((x): x is KeeperhubRun => x !== null);
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
  await r.hset(`cron:${route}`, { ts: String(Date.now()), status });
}

export async function getCronTick(
  route: string,
): Promise<{ ts: number; status: "ok" | "fail" } | null> {
  const r = getRedis();
  if (!r) return null;
  const v = await r.hgetall(`cron:${route}`);
  if (!v || !v.ts) return null;
  const status = v.status === "fail" ? "fail" : "ok";
  return { ts: Number(v.ts), status };
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
