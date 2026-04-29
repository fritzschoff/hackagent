import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRedis, pushKeeperhubRun } from "@/lib/redis";
import { AGENT_ID_DEFAULT, SEPOLIA_REPUTATION_REGISTRY } from "@/lib/ens-constants";
import { sepoliaPublicClient } from "@/lib/wallets";

const REPUTATION_ABI = [
  {
    type: "function",
    name: "feedbackCount",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/// KeeperHub reputation-cache workflow webhook sink.
///
/// The workflow that previously did `setText("reputation-summary", ...)` on
/// Sepolia now hits this webhook instead. We compute the feedback count
/// on-chain (cheap read, no tx), build the same summary string, write to
/// Redis, and surface a KeeperHub run on /keeperhub.

const Body = z.object({
  ts: z.union([z.number(), z.string()]).optional(),
  workflowRunId: z.string().optional(),
  agentId: z.union([z.number(), z.string()]).optional(),
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
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const agentId = parsed.data.agentId ? Number(parsed.data.agentId) : AGENT_ID_DEFAULT;
  if (!Number.isFinite(agentId) || agentId <= 0) {
    return NextResponse.json({ error: "invalid agentId" }, { status: 400 });
  }
  const tsMs =
    parsed.data.ts !== undefined
      ? typeof parsed.data.ts === "number"
        ? parsed.data.ts
        : Number.parseInt(parsed.data.ts, 10)
      : Date.now();

  let summary = "feedback=0";
  try {
    const count = (await sepoliaPublicClient().readContract({
      address: SEPOLIA_REPUTATION_REGISTRY,
      abi: REPUTATION_ABI,
      functionName: "feedbackCount",
      args: [BigInt(agentId)],
    })) as bigint;
    summary = `feedback=${count.toString()}`;
  } catch (err) {
    console.error(
      "[keeperhub/reputation-pulse] feedbackCount read failed:",
      err instanceof Error ? err.message : err,
    );
  }

  const r = getRedis();
  if (r) {
    await r.set(`reputation:summary:${agentId}`, summary, "EX", 600);
    await r.set(`ens:dynamic:${agentId}:reputation-summary`, summary, "EX", 86400);
  }

  await pushKeeperhubRun({
    kind: "reputation-cache",
    jobId: `rep-pulse-${tsMs}`,
    workflowRunId: parsed.data.workflowRunId ?? `rep-pulse-${tsMs}`,
    txHash: null,
    summary,
    ts: tsMs,
  });

  return NextResponse.json({ ok: true, summary });
}
