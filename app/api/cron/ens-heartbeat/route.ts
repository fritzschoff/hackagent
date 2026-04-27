import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth, unauthorized } from "@/lib/cron-auth";
import { recordCronTick, pushKeeperhubRun } from "@/lib/redis";
import { refreshHeartbeat } from "@/lib/ens";
import { triggerKeeperHub } from "@/lib/keeperhub";

export const runtime = "nodejs";
export const maxDuration = 30;

const ROUTE = "/api/cron/ens-heartbeat";

/// Issue #7 — try KeeperHub first; if a heartbeat workflow is configured,
/// the keeper executes the on-chain text-record write so the agent's
/// scheduling is decentralized. Vercel cron stays as the fallback +
/// liveness check, never a hard dependency.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();

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
