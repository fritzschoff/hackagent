import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth, unauthorized } from "@/lib/cron-auth";
import {
  recordCronTick,
  pushKeeperhubRun,
  msSinceLastSettlement,
} from "@/lib/redis";
import { refreshHeartbeat } from "@/lib/ens";
import { triggerKeeperHub } from "@/lib/keeperhub";

export const runtime = "nodejs";
export const maxDuration = 30;

const ROUTE = "/api/cron/ens-heartbeat";
const ACTIVITY_WINDOW_MS = 18 * 60 * 60 * 1000; // 18h

/// Daily safety-net only. The push-based heartbeat in /api/a2a/jobs fires
/// on every paid x402 settlement (debounced 5min), so this cron is only
/// needed when the agent has been idle for >18h. Skip otherwise — every
/// setText costs Sepolia gas, no point writing the same near-zero
/// timestamp delta over and over.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();

  const idleMs = await msSinceLastSettlement();
  if (idleMs !== null && idleMs < ACTIVITY_WINDOW_MS) {
    await recordCronTick(ROUTE, "ok");
    return NextResponse.json({
      ok: true,
      skipped: "recent activity",
      msSinceLastSettlement: idleMs,
    });
  }

  const kh = await triggerKeeperHub({
    kind: "heartbeat",
    input: { route: ROUTE, ts: Date.now() },
    pollForTx: true,
  });

  if (kh) {
    await pushKeeperhubRun({
      kind: "heartbeat",
      jobId: `heartbeat-${Date.now()}`,
      workflowRunId: kh.workflowRunId,
      txHash: kh.txHash,
      summary: kh.txHash ? "ens text record updated" : "queued",
      ts: Date.now(),
    });
    await recordCronTick(ROUTE, kh.status === "failed" ? "fail" : "ok");
    return NextResponse.json({
      ok: kh.status !== "failed",
      via: "keeperhub",
      run: kh,
    });
  }

  const result = await refreshHeartbeat();
  await recordCronTick(ROUTE, result.status === "failed" ? "fail" : "ok");
  return NextResponse.json({
    ok: result.status !== "failed",
    via: "vercel-fallback",
    ...result,
  });
}
