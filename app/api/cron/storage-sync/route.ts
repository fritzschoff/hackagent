import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth, unauthorized } from "@/lib/cron-auth";
import { recordCronTick } from "@/lib/upstash";

export const runtime = "nodejs";
export const maxDuration = 120;

const ROUTE = "/api/cron/storage-sync";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  await recordCronTick(ROUTE, "ok");
  return NextResponse.json({
    ok: true,
    note: "storage-sync flushes Upstash Redis -> 0G Storage Log (P3)",
  });
}
