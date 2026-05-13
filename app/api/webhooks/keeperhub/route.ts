import { NextRequest } from "next/server";
import { pushKeeperhubRun, type KeeperhubRunKind } from "@/lib/redis";
import { verifyKeeperhubWebhook, unauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

const KIND_VALUES: KeeperhubRunKind[] = [
  "swap",
  "heartbeat",
  "reputation-cache",
  "kill-switch",
  "funding-poll",
  "dividend-distribute",
  "dividend-step-1",
];

function isKind(v: unknown): v is KeeperhubRunKind {
  return typeof v === "string" && KIND_VALUES.includes(v as KeeperhubRunKind);
}

/// KeeperHub workflow → POST here on completion. Body shape:
///   { kind, workflowRunId, txHash?, summary? }
///
/// Bearer auth against KEEPERHUB_WEBHOOK_SECRET — without it, anyone on
/// the internet could pollute the dashboard's KH-runs ring buffer with
/// fake "kill-switch tripped" / "dividend distributed" rows. The buffer
/// is the public audit surface shareholders read; trusted writers only.
export async function POST(req: NextRequest) {
  if (!verifyKeeperhubWebhook(req)) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  console.log("[keeperhub-webhook]", body);

  const kind = isKind(body.kind) ? body.kind : null;
  if (!kind) {
    return Response.json(
      { ok: false, error: "missing or invalid kind" },
      { status: 400 },
    );
  }
  const incomingRunId =
    typeof body.workflowRunId === "string" ? body.workflowRunId : "";
  const workflowRunId =
    incomingRunId.length > 0 ? incomingRunId : `${kind}-${Date.now()}`;

  const txHash = typeof body.txHash === "string" ? body.txHash : null;
  const summary =
    typeof body.summary === "string" ? body.summary : undefined;

  await pushKeeperhubRun({
    kind,
    jobId: `webhook-${workflowRunId}`,
    workflowRunId,
    txHash,
    summary,
    ts: Date.now(),
  });

  return Response.json({ ok: true });
}
