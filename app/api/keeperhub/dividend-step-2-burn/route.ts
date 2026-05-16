import { NextRequest, NextResponse } from "next/server";
import { keccak256 } from "viem";
import { verifyKeeperhubWebhook, unauthorized } from "@/lib/cron-auth";
import { arbitrumPublicClient, arbitrumWalletClient } from "@/lib/wallets";
import { getRedis, pushKeeperhubRun } from "@/lib/redis";
import { getBaseMainnetAddresses } from "@/lib/edge-config";
import {
  ARBITRUM_TOKEN_MESSENGER,
  ARBITRUM_USDC,
  CCTP_DOMAIN_BASE,
  ERC20_APPROVE_ABI,
  TOKEN_MESSENGER_ABI,
  addressToBytes32,
} from "@/lib/cctp";

export const runtime = "nodejs";
export const maxDuration = 60;

/// CCTP D2: burn USDC on Arbitrum so Circle's attestation service can
/// mint it on Base into the RevenueSplitter.
///
/// Triggered by KH workflow DividendStep2Burn shortly after D1 settles
/// USDC into the agent's Arbitrum wallet via Bridge2.
///
/// Idempotency: the agent EOA's full available Arbitrum USDC balance is
/// always burned. If KH double-fires, the second call sees `balance = 0`
/// and returns ok+skipped — no double-burn risk.
export async function POST(req: NextRequest) {
  if (!verifyKeeperhubWebhook(req)) return unauthorized();

  const addrs = await getBaseMainnetAddresses();
  if (!addrs.revenueSplitter) {
    return NextResponse.json(
      { error: "base-mainnet splitter not configured" },
      { status: 503 },
    );
  }

  const publicClient = arbitrumPublicClient();
  const wallet = arbitrumWalletClient("agent");
  const agent = wallet.account.address;

  // 1. Read USDC balance on Arbitrum
  const balance = (await publicClient.readContract({
    address: ARBITRUM_USDC,
    abi: ERC20_APPROVE_ABI,
    functionName: "balanceOf",
    args: [agent],
  })) as bigint;

  if (balance === 0n) {
    await pushKeeperhubRun({
      kind: "dividend-step-2",
      jobId: `d2-${Date.now()}`,
      workflowRunId: `d2-${Date.now()}`,
      txHash: null,
      summary: "skipped — no USDC on Arbitrum to burn",
      ts: Date.now(),
    });
    return NextResponse.json({ ok: true, skipped: "no-balance" });
  }

  // 2. Ensure allowance for the TokenMessenger
  const allowance = (await publicClient.readContract({
    address: ARBITRUM_USDC,
    abi: ERC20_APPROVE_ABI,
    functionName: "allowance",
    args: [agent, ARBITRUM_TOKEN_MESSENGER],
  })) as bigint;
  if (allowance < balance) {
    const approveTx = await wallet.writeContract({
      address: ARBITRUM_USDC,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [ARBITRUM_TOKEN_MESSENGER, balance],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
  }

  // 3. depositForBurn → emits MessageSent on MessageTransmitter
  const mintRecipient = addressToBytes32(addrs.revenueSplitter);
  const burnTx = await wallet.writeContract({
    address: ARBITRUM_TOKEN_MESSENGER,
    abi: TOKEN_MESSENGER_ABI,
    functionName: "depositForBurn",
    args: [balance, CCTP_DOMAIN_BASE, mintRecipient, ARBITRUM_USDC],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: burnTx,
  });

  // 4. Extract MessageSent event from receipt; keccak it for iris
  const messageSentLog = receipt.logs.find(
    (l) =>
      l.topics[0] ===
      keccak256(new TextEncoder().encode("MessageSent(bytes)")),
  );
  if (!messageSentLog) {
    return NextResponse.json(
      { error: "MessageSent log not found on burn tx", txHash: burnTx },
      { status: 500 },
    );
  }
  // The MessageSent event has the full message as the only arg (non-
  // indexed). Decode by stripping the 32-byte offset + 32-byte length
  // prefix from the data field.
  const data = messageSentLog.data;
  // data = 0x | offset(32) | length(32) | message(padded)
  const lengthHex = data.slice(2 + 64, 2 + 128);
  const messageLen = parseInt(lengthHex, 16);
  const messageBytes = (`0x` +
    data.slice(2 + 128, 2 + 128 + messageLen * 2)) as `0x${string}`;
  const messageHash = keccak256(messageBytes);

  // 5. Persist pending burn for D3 to pick up
  const redis = getRedis();
  const ts = Date.now();
  const pending = {
    burnTxHash: burnTx,
    messageBytes,
    messageHash,
    amount: balance.toString(),
    burnedAt: ts,
  };
  if (redis) {
    await redis.set(
      `cctp:pending:${messageHash}`,
      JSON.stringify(pending),
      "EX",
      60 * 60 * 24 * 7, // 7-day TTL
    );
  }

  await pushKeeperhubRun({
    kind: "dividend-step-2",
    jobId: `d2-${ts}`,
    workflowRunId: `d2-${ts}`,
    txHash: burnTx,
    summary: `burned ${(Number(balance) / 1e6).toFixed(2)} USDC → CCTP · pending mint on Base`,
    ts,
  });

  return NextResponse.json({
    ok: true,
    burnTxHash: burnTx,
    amount: balance.toString(),
    messageHash,
  });
}
