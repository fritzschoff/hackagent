import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth, unauthorized } from "@/lib/cron-auth";
import { recordCronTick } from "@/lib/upstash";

export const runtime = "nodejs";
export const maxDuration = 60;

const ROUTE = "/api/cron/reputation-cache";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  await recordCronTick(ROUTE, "ok");
  return NextResponse.json({
    ok: true,
    note: "reputation-cache rebuilds dashboard summary from ERC-8004 events (P3)",
  });
}
