import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth, unauthorized } from "@/lib/cron-auth";
import { recordCronTick } from "@/lib/redis";
import { refreshHeartbeat } from "@/lib/ens";

export const runtime = "nodejs";
export const maxDuration = 30;

const ROUTE = "/api/cron/ens-heartbeat";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  await refreshHeartbeat();
  await recordCronTick(ROUTE, "ok");
  return NextResponse.json({ ok: true });
}
