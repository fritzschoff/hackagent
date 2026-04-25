import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth, unauthorized } from "@/lib/cron-auth";
import { recordCronTick } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 60;

const ROUTE = "/api/cron/agent-tick";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  await recordCronTick(ROUTE, "ok");
  return NextResponse.json({
    ok: true,
    note: "agent-tick reserved for P3+ pending-job draining",
  });
}
