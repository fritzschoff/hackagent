import { timingSafeEqual } from "node:crypto";
import { getAllCronStatuses } from "@/lib/upstash";
import type { CronStatus } from "@/lib/types";

export function verifyCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function unauthorized(): Response {
  return new Response("unauthorized", { status: 401 });
}

export async function getCronStatuses(): Promise<CronStatus[]> {
  return getAllCronStatuses();
}
