import { NextRequest, NextResponse } from "next/server";
import { loadAccount } from "@/lib/wallets";
import { pushKeeperhubRun, tryAcquireDebounce } from "@/lib/redis";
import { getClearinghouseState, withdraw } from "@/lib/hyperliquid";
import { appendTradeLog } from "@/lib/treasury-log";

export const runtime = "nodejs";
export const maxDuration = 30;

/// HL keeps a 5 USDC minimum on the account anyway; leave some headroom
/// so this never tries to withdraw down to zero. Override per-deploy via
/// env if M2 strategy needs more standing collateral.
const DEFAULT_OPERATING_RESERVE_USDC = 5;

/// KeeperHub DividendStep1Withdraw → POST here weekly. Body:
///   { triggeredAt: ISO timestamp }
///
/// Reads the agent's HL clearinghouseState, subtracts the operating
/// reserve, signs a withdraw3 action with AGENT_PK, sends it to HL.
/// HL Bridge2 settles to Arbitrum in 3–4 min. Idempotent via Redis
/// debounce (1h cooldown) so an accidental double-fire doesn't issue
/// two withdrawals.
///
/// Bearer auth against KEEPERHUB_WEBHOOK_SECRET.
export async function POST(req: NextRequest) {
  const secret = process.env.KEEPERHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "secret not configured" },
      { status: 500 },
    );
  }
  const provided = (req.headers.get("authorization") ?? "").startsWith(
    "Bearer ",
  )
    ? (req.headers.get("authorization") ?? "").slice(7)
    : "";
  if (provided !== secret) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  // 1h debounce. Prevents a double-fire (e.g. KH schedule + manual trigger
  // within the same hour) from issuing two withdrawals while the first
  // is still in flight.
  const acquired = await tryAcquireDebounce(
    "dividend-step-1:debounce",
    3600,
  );
  if (!acquired) {
    return NextResponse.json({
      ok: true,
      skipped: "debounce",
      detail: "another step-1 fire in the last hour, skipping",
    });
  }

  const env = (process.env.HL_ENV ?? "testnet") as "mainnet" | "testnet";
  const reserve = Number(
    process.env.HL_OPERATING_RESERVE_USDC ??
      String(DEFAULT_OPERATING_RESERVE_USDC),
  );
  if (!Number.isFinite(reserve) || reserve < 0) {
    return NextResponse.json(
      { ok: false, error: `bad HL_OPERATING_RESERVE_USDC: ${reserve}` },
      { status: 500 },
    );
  }

  let account;
  try {
    account = loadAccount("agent");
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "AGENT_PK missing",
      },
      { status: 500 },
    );
  }

  let withdrawable = 0;
  try {
    const state = await getClearinghouseState(env, account.address);
    withdrawable = Number(state.withdrawable);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[dividend-step-1] clearinghouseState failed:", msg);
    await logRun(`ERR clearinghouseState: ${msg.slice(0, 80)}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  const amount = Math.max(0, withdrawable - reserve);
  if (amount <= 0) {
    await logRun(
      `skipped · withdrawable=${withdrawable} ≤ reserve=${reserve}`,
    );
    return NextResponse.json({
      ok: true,
      skipped: "balance-below-reserve",
      withdrawable: String(withdrawable),
      reserve: String(reserve),
    });
  }

  let error: string | null = null;
  let response: unknown = null;
  try {
    response = await withdraw({
      env,
      account,
      destination: account.address,
      amountUsdc: amount,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error("[dividend-step-1] withdraw failed:", error);
  }

  await appendTradeLog({
    ts: Date.now(),
    action: "hl-withdraw",
    txHash: "",
    reason: `weekly dividend step 1: HL → Arbitrum (${amount} USDC, ${env})`,
    amount: String(amount),
  });

  await logRun(
    error
      ? `ERR ${error.slice(0, 80)}`
      : `requested ${amount} USDC → Arbitrum (HL ${env}); validators settle in 3–4min`,
  );

  return NextResponse.json({
    ok: error === null,
    amount: String(amount),
    env,
    destination: account.address,
    response,
    error,
  });
}

async function logRun(summary: string) {
  const ts = Date.now();
  await pushKeeperhubRun({
    kind: "dividend-step-1",
    jobId: `dividend-step-1-${ts}`,
    workflowRunId: `dividend-step-1-${ts}`,
    txHash: null,
    summary,
    ts,
  });
}
