import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth, unauthorized } from "@/lib/cron-auth";
import {
  recordCronTick,
  getLatestFundingSnapshot,
  pushKeeperhubRun,
} from "@/lib/redis";
import {
  readTreasury,
  openPosition,
  closePosition,
} from "@/lib/treasury";
import { decide, type Action } from "@/lib/treasury-strategy";

export const runtime = "nodejs";
export const maxDuration = 30;

const ROUTE = "/api/cron/treasury-strategy";

/// Every 15 minutes: read treasury state + the latest funding snapshot
/// (populated by the TreasuryFundingPoll KH workflow), decide an Action via
/// the pure `decide()` policy, then execute. Idempotent at the contract
/// level (open while open reverts, close while flat reverts).
///
/// Decisions are surfaced via the unified KH run log so /keeperhub shows
/// the agent's reasoning alongside the workflow cadence.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();

  const [treasury, funding] = await Promise.all([
    readTreasury(),
    getLatestFundingSnapshot(),
  ]);

  if (!treasury) {
    await recordCronTick(ROUTE, "ok");
    return NextResponse.json({ ok: true, skipped: "no-treasury" });
  }

  const action = decide({ treasury, funding });
  const ts = Date.now();
  let txHash: string | null = null;
  let error: string | null = null;

  try {
    if (action.kind === "open") {
      txHash = await openPosition(action.size, action.collateral);
    } else if (action.kind === "close") {
      txHash = await closePosition();
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error(`[treasury-strategy] ${action.kind} failed:`, error);
  }

  await pushKeeperhubRun({
    kind: "funding-poll",
    jobId: `strategy-${ts}`,
    workflowRunId: `strategy-${ts}`,
    txHash: txHash as `0x${string}` | null,
    summary: `${action.kind} · ${action.reason}${error ? ` · ERR ${error.slice(0, 80)}` : ""}`,
    ts,
  });

  await recordCronTick(ROUTE, error ? "fail" : "ok");
  return NextResponse.json({
    ok: error === null,
    action: summarizeAction(action),
    txHash,
    error,
  });
}

function summarizeAction(action: Action): Record<string, unknown> {
  if (action.kind === "open") {
    return {
      kind: action.kind,
      side: action.side,
      size: action.size.toString(),
      collateral: action.collateral.toString(),
      reason: action.reason,
    };
  }
  return { kind: action.kind, reason: action.reason };
}
