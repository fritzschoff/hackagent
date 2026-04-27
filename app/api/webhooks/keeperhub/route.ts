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
  if (!kind) {
    return Response.json(
      { ok: false, error: "missing or invalid kind" },
      { status: 400 },
    );
  }
  // KeeperHub does not always populate workflowRunId via its template
  // syntax; if the field arrives empty, synthesize one from kind + ts so
  // the run still shows up on the dashboard.
  const incomingRunId =
    typeof body.workflowRunId === "string" ? body.workflowRunId : "";
  const workflowRunId =
    incomingRunId.length > 0 ? incomingRunId : `${kind}-${Date.now()}`;

  const txHash = typeof body.txHash === "string" ? body.txHash : null;
  let summary =
    typeof body.summary === "string" ? body.summary : undefined;

  // Compliance attestation: KeeperHub's tuple read returns an opaque
  // `result` field with no bracket access on action outputs, so we compare
  // here instead of in-workflow. The workflow posts manifestRoot +
  // expectedRoot in the body and we derive a verified/DRIFT summary.
  if (kind === "compliance-attest") {
    const onChain =
      typeof body.manifestRoot === "string" ? body.manifestRoot : null;
    const expected =
      typeof body.expectedRoot === "string" ? body.expectedRoot : null;
    if (onChain && expected) {
      const match = onChain.toLowerCase() === expected.toLowerCase();
      summary = match
        ? `verified · ${onChain.slice(0, 10)}…`
        : `DRIFT · on-chain ${onChain.slice(0, 10)}… vs expected ${expected.slice(0, 10)}…`;
    }
  }

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
