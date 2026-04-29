import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRedis, pushKeeperhubRun } from "@/lib/redis";
import { AGENT_ID_DEFAULT } from "@/lib/ens-constants";

/// KeeperHub heartbeat workflow webhook sink.
///
/// The workflow that previously did `setText("last-seen-at", ts)` on Sepolia
/// now does this webhook instead — same trigger (per paid x402 quote), same
/// KeeperHub run visibility, but zero gas. The dashboard reads `last-seen-at`
/// from Redis (with stale on-chain text record as fallback).
///
/// W2's CCIP-Read gateway will expose this Redis value as a real ENS text
/// record from any client; until then, the dashboard reads it directly.

const Body = z.object({
  ts: z.union([z.number(), z.string()]),
  workflowRunId: z.string().optional(),
});

function checkSecret(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.KEEPERHUB_WEBHOOK_SECRET ?? process.env.INFT_ORACLE_API_KEY ?? ""}`;
  return expected !== "Bearer " && auth === expected;
}

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const tsMs =
    typeof parsed.data.ts === "number"
      ? parsed.data.ts
      : Number.parseInt(parsed.data.ts, 10);
  if (!Number.isFinite(tsMs)) {
    return NextResponse.json({ error: "invalid ts" }, { status: 400 });
  }
  const iso = new Date(tsMs).toISOString();

  const r = getRedis();
  if (r) {
    await r.set(`agent:${AGENT_ID_DEFAULT}:last-seen`, iso);
    await r.set(`ens:dynamic:${AGENT_ID_DEFAULT}:last-seen-at`, iso, "EX", 86400);
  }

  await pushKeeperhubRun({
    kind: "heartbeat",
    jobId: `pulse-${tsMs}`,
    workflowRunId: parsed.data.workflowRunId ?? `pulse-${tsMs}`,
    txHash: null,
    summary: "heartbeat pulse — Redis updated, no on-chain write",
    ts: tsMs,
  });

  return NextResponse.json({ ok: true, lastSeenAt: iso });
}
