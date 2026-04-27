import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth, unauthorized } from "@/lib/cron-auth";
import { recordCronTick, getRedis, pushKeeperhubRun } from "@/lib/redis";
import { getSepoliaAddresses } from "@/lib/edge-config";
import {
  computeReputationSummary,
  summaryToCompactText,
} from "@/lib/rep-summary";
import { setEnsTextRecord } from "@/lib/ens";
import { triggerKeeperHub } from "@/lib/keeperhub";

export const runtime = "nodejs";
export const maxDuration = 60;

const ROUTE = "/api/cron/reputation-cache";
const ENS_TEXT_KEY = "reputation-summary";
const REDIS_LAST_KEY = "ens:reputation-summary:last";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();

  const addresses = await getSepoliaAddresses();
  const agentId = addresses.agentId;
  if (!agentId || agentId === 0) {
    await recordCronTick(ROUTE, "ok");
    return NextResponse.json({ ok: true, skipped: "agentId missing" });
  }

  // Issue #7 — KeeperHub-first execution. If the workflow is configured,
  // KeeperHub does the text-record write itself and we record the run.
  const kh = await triggerKeeperHub({
    kind: "reputation-cache",
    input: { agentId, ts: Date.now() },
    pollForTx: true,
  });
  if (kh) {
    await pushKeeperhubRun({
      kind: "reputation-cache",
      jobId: `rep-cache-${Date.now()}`,
      workflowRunId: kh.workflowRunId,
      txHash: kh.txHash,
      summary: kh.txHash ? "summary text record updated" : "queued",
      ts: Date.now(),
    });
    await recordCronTick(ROUTE, kh.status === "failed" ? "fail" : "ok");
    return NextResponse.json({
      ok: kh.status !== "failed",
      via: "keeperhub",
      run: kh,
    });
  }

  let txHash: string | null = null;
  let updated = false;
  let summaryText: string | null = null;
  try {
    const summary = await computeReputationSummary({ agentId });
    summaryText = summaryToCompactText(summary);

    const redis = getRedis();
    const last = redis ? await redis.get(REDIS_LAST_KEY).catch(() => null) : null;
    if (last !== summaryText) {
      const r = await setEnsTextRecord({
        key: ENS_TEXT_KEY,
        value: summaryText,
      });
      if (r) {
        txHash = r.txHash;
        updated = true;
        if (redis) {
          await redis
            .set(REDIS_LAST_KEY, summaryText)
            .catch(() => undefined);
        }
      }
    }
    await recordCronTick(ROUTE, "ok");
  } catch (err) {
    console.error("[reputation-cache] failed:", err);
    await recordCronTick(ROUTE, "fail");
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    updated,
    txHash,
    summary: summaryText,
  });
}
