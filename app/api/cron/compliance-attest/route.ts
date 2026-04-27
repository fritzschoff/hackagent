import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth, unauthorized } from "@/lib/cron-auth";
import { recordCronTick, pushKeeperhubRun } from "@/lib/redis";
import { getSepoliaAddresses } from "@/lib/edge-config";
import {
  buildManifestRoot,
  TRADEWISE_MANIFEST,
  readCompliance,
} from "@/lib/compliance";
import { triggerKeeperHub } from "@/lib/keeperhub";

export const runtime = "nodejs";
export const maxDuration = 60;

const ROUTE = "/api/cron/compliance-attest";

/// Issue #6 + #7 — periodic attestation that the on-chain manifest root
/// still matches the canonical doc. KeeperHub fires this on a schedule;
/// the workflow re-hashes TRADEWISE_MANIFEST off chain, reads the on-chain
/// root, and records a `compliance-attest` run with `match: true|false`.
/// Drift means either the manifest doc was updated without re-committing
/// (operator error) or someone overwrote the on-chain root — both demand
/// human attention.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();

  const addresses = await getSepoliaAddresses();
  const registry = addresses.complianceManifestAddress;
  const agentId = BigInt(addresses.agentId);
  if (!registry || agentId === 0n) {
    await recordCronTick(ROUTE, "ok");
    return NextResponse.json({ ok: true, skipped: "registry missing" });
  }

  const expectedRoot = buildManifestRoot(TRADEWISE_MANIFEST);

  // KeeperHub-first execution: when configured, the workflow does the
  // on-chain read + alarm push; we mirror the run for the dashboard.
  const kh = await triggerKeeperHub({
    kind: "compliance-attest",
    input: {
      registry,
      agentId: agentId.toString(),
      expectedRoot,
      ts: Date.now(),
    },
    pollForTx: false,
  });
  if (kh) {
    await pushKeeperhubRun({
      kind: "compliance-attest",
      jobId: `compliance-${Date.now()}`,
      workflowRunId: kh.workflowRunId,
      txHash: null,
      summary: `expected ${expectedRoot.slice(0, 10)}…`,
      ts: Date.now(),
    });
    await recordCronTick(ROUTE, "ok");
    return NextResponse.json({
      ok: true,
      via: "keeperhub",
      run: kh,
      expectedRoot,
    });
  }

  // Vercel fallback: do the verification inline.
  const view = await readCompliance({ registry, agentId });
  const matches =
    view !== null &&
    view.manifestRoot.toLowerCase() === expectedRoot.toLowerCase();
  await pushKeeperhubRun({
    kind: "compliance-attest",
    jobId: `compliance-${Date.now()}`,
    workflowRunId: `vercel-fallback-${Date.now()}`,
    txHash: null,
    summary: matches
      ? `verified · ${expectedRoot.slice(0, 10)}…`
      : view
        ? `DRIFT · on-chain ${view.manifestRoot.slice(0, 10)}… vs expected ${expectedRoot.slice(0, 10)}…`
        : "registry unreadable",
    ts: Date.now(),
  });
  await recordCronTick(ROUTE, matches ? "ok" : "fail");
  return NextResponse.json({
    ok: matches,
    via: "vercel-fallback",
    expectedRoot,
    onChainRoot: view?.manifestRoot ?? null,
    matches,
  });
}
