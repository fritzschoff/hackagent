import { NextRequest } from "next/server";
import { pushKeeperhubRun, type KeeperhubRunKind } from "@/lib/redis";

export const runtime = "nodejs";

const KIND_VALUES: KeeperhubRunKind[] = [
  "swap",
  "heartbeat",
  "reputation-cache",
  "compliance-attest",
];

function isKind(v: unknown): v is KeeperhubRunKind {
  return typeof v === "string" && KIND_VALUES.includes(v as KeeperhubRunKind);
}

/// KeeperHub workflow → POST here on completion. Body shape (configured in
/// the KeeperHub workflow's "webhook" node):
///   {
///     kind: "heartbeat" | "reputation-cache" | "compliance-attest" | "swap",
///     workflowRunId: string,
///     txHash?: string,
///     summary?: string
///   }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  console.log("[keeperhub-webhook]", body);

  const kind = isKind(body.kind) ? body.kind : null;
  const workflowRunId =
    typeof body.workflowRunId === "string" ? body.workflowRunId : null;
  if (!kind || !workflowRunId) {
    return Response.json(
      { ok: false, error: "missing kind or workflowRunId" },
      { status: 400 },
    );
  }

  const txHash = typeof body.txHash === "string" ? body.txHash : null;
  const summary = typeof body.summary === "string" ? body.summary : undefined;

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
