import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth, unauthorized } from "@/lib/cron-auth";
import { recordCronTick } from "@/lib/redis";
import { pingHeartbeat, readTreasury } from "@/lib/treasury";

export const runtime = "nodejs";
export const maxDuration = 30;

const ROUTE = "/api/cron/treasury-heartbeat";

/// Hourly ping of TradingTreasury.heartbeat() from AGENT_PK so the
/// 6-hour dead-man's switch (enforced by the TreasuryKillSwitch
/// KeeperHub workflow) does not fire while the agent is healthy.
/// If the treasury is killed or not yet deployed, no-op.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();

  const view = await readTreasury();
  if (!view) {
    await recordCronTick(ROUTE, "ok");
    return NextResponse.json({ ok: true, skipped: "no-treasury" });
  }
  if (view.killed) {
    await recordCronTick(ROUTE, "ok");
    return NextResponse.json({ ok: true, skipped: "killed" });
  }

  try {
    const txHash = await pingHeartbeat();
    await recordCronTick(ROUTE, "ok");
    return NextResponse.json({
      ok: true,
      txHash,
      treasury: view.address,
      lastHeartbeat: Number(view.lastHeartbeat),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[treasury-heartbeat] ping failed:", msg);
    await recordCronTick(ROUTE, "fail");
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
