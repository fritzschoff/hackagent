import { NextRequest, NextResponse } from "next/server";
import { verifyKeeperhubWebhook, unauthorized } from "@/lib/cron-auth";
import { baseMainnetPublicClient, baseMainnetWalletClient } from "@/lib/wallets";
import { getRedis, pushKeeperhubRun } from "@/lib/redis";
import {
  BASE_MESSAGE_TRANSMITTER,
  MESSAGE_TRANSMITTER_ABI,
  fetchAttestation,
} from "@/lib/cctp";

export const runtime = "nodejs";
export const maxDuration = 60;

type PendingBurn = {
  burnTxHash: `0x${string}`;
  messageBytes: `0x${string}`;
  messageHash: `0x${string}`;
  amount: string;
  burnedAt: number;
};

/// CCTP D3: drain the pending-burn queue. For each entry, poll Circle's
/// iris attestation API; if ready, submit `receiveMessage` on Base
/// mainnet to mint USDC into the RevenueSplitter.
///
/// Triggered by KH workflow DividendStep3Mint every 5 min. Idempotent:
/// re-running with the same `messageHash` after a successful mint just
/// finds the Redis entry already deleted and skips.
export async function POST(req: NextRequest) {
  if (!verifyKeeperhubWebhook(req)) return unauthorized();

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: "redis not configured" },
      { status: 503 },
    );
  }

  const keys = await redis.keys("cctp:pending:*");
  if (keys.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, skipped: "no-pending" });
  }

  const wallet = baseMainnetWalletClient("agent");
  const publicClient = baseMainnetPublicClient();

  let minted = 0;
  let stillPending = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const key of keys) {
    const raw = await redis.get(key);
    if (!raw) continue;
    const burn = JSON.parse(raw) as PendingBurn;
    const attestation = await fetchAttestation(burn.messageHash);
    if (!attestation) {
      stillPending++;
      continue;
    }

    try {
      const mintTx = await wallet.writeContract({
        address: BASE_MESSAGE_TRANSMITTER,
        abi: MESSAGE_TRANSMITTER_ABI,
        functionName: "receiveMessage",
        args: [burn.messageBytes, attestation],
      });
      await publicClient.waitForTransactionReceipt({ hash: mintTx });
      await redis.del(key);
      minted++;
      results.push({
        messageHash: burn.messageHash,
        mintTxHash: mintTx,
        amount: burn.amount,
      });
      const ts = Date.now();
      await pushKeeperhubRun({
        kind: "dividend-step-3",
        jobId: `d3-${ts}`,
        workflowRunId: `d3-${ts}`,
        txHash: mintTx,
        summary: `minted ${(Number(burn.amount) / 1e6).toFixed(2)} USDC on Base into splitter`,
        ts,
      });
    } catch (err) {
      const e = err instanceof Error ? err.message : String(err);
      console.error(`[d3] mint failed for ${burn.messageHash}:`, e);
      results.push({ messageHash: burn.messageHash, error: e });
    }
  }

  return NextResponse.json({
    ok: true,
    minted,
    stillPending,
    results,
  });
}
