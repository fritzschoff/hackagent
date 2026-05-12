import { NextRequest, NextResponse } from "next/server";
import { pushFundingSnapshot, pushKeeperhubRun } from "@/lib/redis";

export const runtime = "nodejs";

/// KeeperHub TreasuryFundingPoll workflow → POST here every 5min with the
/// latest on-chain funding rate snapshot. Body:
///   {
///     workflowRunId: string,
///     exchange: "0x...",
///     fundingRatePerSecond: string (signed int as string),
///     triggeredAt: string (ISO timestamp from the schedule trigger)
///   }
///
/// Bearer auth against KEEPERHUB_WEBHOOK_SECRET so randos can't poison the
/// off-chain agent's view of the funding rate.
export async function POST(req: NextRequest) {
  const secret = process.env.KEEPERHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "secret not configured" },
      { status: 500 },
    );
  }
  const provided = (req.headers.get("authorization") ?? "").startsWith("Bearer ")
    ? (req.headers.get("authorization") ?? "").slice(7)
    : "";
  if (provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const workflowRunId =
    typeof body.workflowRunId === "string" && body.workflowRunId.length > 0
      ? body.workflowRunId
      : `funding-poll-${Date.now()}`;
  const exchange =
    typeof body.exchange === "string" ? body.exchange : "0x";
  const rate =
    typeof body.fundingRatePerSecond === "string"
      ? body.fundingRatePerSecond
      : typeof body.fundingRatePerSecond === "number"
        ? String(body.fundingRatePerSecond)
        : null;
  if (rate === null) {
    return NextResponse.json(
      { ok: false, error: "missing fundingRatePerSecond" },
      { status: 400 },
    );
  }

  const ts = Date.now();
  await pushFundingSnapshot({
    ratePerSecond: rate,
    exchange,
    workflowRunId,
    ts,
  });

  // Surface the poll in the unified KH runs log so the /keeperhub dashboard
  // shows cadence + the snapshot value as the summary.
  await pushKeeperhubRun({
    kind: "funding-poll",
    jobId: `funding-${ts}`,
    workflowRunId,
    txHash: null,
    summary: `rate=${rate}/sec exchange=${exchange.slice(0, 10)}…`,
    ts,
  });

  return NextResponse.json({ ok: true, rate, ts });
}
