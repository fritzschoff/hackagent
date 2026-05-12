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
import {
  appendTradeLog,
  buildOpenEntry,
  buildCloseEntry,
} from "@/lib/treasury-log";

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
  let txHash: `0x${string}` | null = null;
  let error: string | null = null;
  let zgRoot: string | null = null;

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

  // 0G trade-log entry on successful state-changing actions. Wrapped in a
  // try/catch so a 0G outage never breaks the strategy loop.
  if (txHash && !error) {
    try {
      const preState = {
        usdcBalance: treasury.usdcBalance.toString(),
        positionSize: treasury.positionSize.toString(),
        positionCollateral: treasury.positionCollateral.toString(),
      };
      let entry;
      if (action.kind === "open") {
        entry = buildOpenEntry({
          txHash,
          reason: action.reason,
          side: action.side,
          size: action.size,
          collateral: action.collateral,
          fundingRatePerSecond: funding?.ratePerSecond,
          preState,
        });
      } else if (action.kind === "close") {
        entry = buildCloseEntry({
          txHash,
          reason: action.reason,
          fundingRatePerSecond: funding?.ratePerSecond,
          preState,
        });
      }
      if (entry) {
        const persisted = await appendTradeLog(entry);
        zgRoot = persisted.zgRoot;
      }
    } catch (err) {
      console.error(
        "[treasury-strategy] trade-log append failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  await pushKeeperhubRun({
    kind: "funding-poll",
    jobId: `strategy-${ts}`,
    workflowRunId: `strategy-${ts}`,
    txHash,
    summary: `${action.kind} · ${action.reason}${error ? ` · ERR ${error.slice(0, 80)}` : ""}${zgRoot ? ` · 0G ${zgRoot.slice(0, 10)}…` : ""}`,
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
