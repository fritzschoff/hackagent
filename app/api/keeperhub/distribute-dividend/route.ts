import { NextRequest, NextResponse } from "next/server";
import { pushKeeperhubRun } from "@/lib/redis";
import { readTreasury, distributeRevenue } from "@/lib/treasury";
import { appendTradeLog, buildDistributeEntry } from "@/lib/treasury-log";
import { verifyKeeperhubWebhook, unauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

/// Operating reserve kept in the treasury after a dividend distribution
/// so the strategy loop still has liquidity to open the next position
/// without re-funding. In USDC base units (6 decimals) — 0.1 USDC.
const MIN_OPERATING_RESERVE = 100_000n;

/// KeeperHub TreasuryDividendDistribute → POST here weekly. Body:
///   { triggeredAt: ISO timestamp }
///
/// Reads treasury USDC balance, subtracts the operating reserve, and
/// (if there's a non-zero remainder) calls TradingTreasury.distributeRevenue
/// from AGENT_PK. Bearer auth against KEEPERHUB_WEBHOOK_SECRET.
export async function POST(req: NextRequest) {
  if (!verifyKeeperhubWebhook(req)) return unauthorized();

  const treasury = await readTreasury();
  if (!treasury) {
    return NextResponse.json({ ok: true, skipped: "no-treasury" });
  }
  if (treasury.killed) {
    return NextResponse.json({ ok: true, skipped: "killed" });
  }

  const free = treasury.usdcBalance;
  if (free <= MIN_OPERATING_RESERVE) {
    await logRun(`skipped · balance=${free} ≤ reserve=${MIN_OPERATING_RESERVE}`);
    return NextResponse.json({
      ok: true,
      skipped: "balance-below-reserve",
      balance: free.toString(),
      reserve: MIN_OPERATING_RESERVE.toString(),
    });
  }

  const amount = free - MIN_OPERATING_RESERVE;
  let txHash: `0x${string}` | null = null;
  let error: string | null = null;
  let zgRoot: string | null = null;
  try {
    txHash = await distributeRevenue(amount);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error("[dividend-distribute] failed:", error);
  }

  if (txHash && !error) {
    try {
      const persisted = await appendTradeLog(
        buildDistributeEntry({
          txHash,
          amount,
          preState: {
            usdcBalance: treasury.usdcBalance.toString(),
            positionSize: treasury.positionSize.toString(),
            positionCollateral: treasury.positionCollateral.toString(),
          },
        }),
      );
      zgRoot = persisted.zgRoot;
    } catch (err) {
      console.error(
        "[dividend-distribute] trade-log append failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  await logRun(
    error
      ? `ERR ${error.slice(0, 80)}`
      : `distributed ${amount} (balance was ${free}, reserve ${MIN_OPERATING_RESERVE})${zgRoot ? ` · 0G ${zgRoot.slice(0, 10)}…` : ""}`,
    txHash,
  );

  return NextResponse.json({
    ok: error === null,
    amount: amount.toString(),
    txHash,
    error,
  });
}

async function logRun(
  summary: string,
  txHash: `0x${string}` | null = null,
) {
  const ts = Date.now();
  await pushKeeperhubRun({
    kind: "dividend-distribute",
    jobId: `dividend-${ts}`,
    workflowRunId: `dividend-${ts}`,
    txHash,
    summary,
    ts,
  });
}
