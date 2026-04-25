import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth, unauthorized } from "@/lib/cron-auth";
import { recordCronTick } from "@/lib/upstash";

export const runtime = "nodejs";
export const maxDuration = 300;

const ROUTE = "/api/cron/validator-tick";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  await recordCronTick(ROUTE, "ok");
  return NextResponse.json({
    ok: true,
    note: "validator lands in P4 (re-runs inference, posts validationResponse)",
  });
}
