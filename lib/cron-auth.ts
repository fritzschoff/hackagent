import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAllCronStatuses } from "@/lib/redis";
import type { CronStatus } from "@/lib/types";

/// Compare the request's `Authorization: Bearer <token>` header against
/// `process.env[envVarName]` in constant time. Returns false if either is
/// missing or empty. Single helper for every Bearer-token-auth endpoint
/// in the repo so we can audit auth at one place.
function verifyBearer(req: Request, envVarName: string): boolean {
  const expected = process.env[envVarName];
  if (!expected || expected.length === 0) return false;
  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyCronAuth(req: Request): boolean {
  return verifyBearer(req, "CRON_SECRET");
}

export function verifyKeeperhubWebhook(req: Request): boolean {
  return verifyBearer(req, "KEEPERHUB_WEBHOOK_SECRET");
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function getCronStatuses(): Promise<CronStatus[]> {
  return getAllCronStatuses();
}
