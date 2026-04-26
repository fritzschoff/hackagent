import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth, unauthorized } from "@/lib/cron-auth";
import { getRecentJobs, recordCronTick } from "@/lib/redis";
import { getSepoliaAddresses } from "@/lib/edge-config";
import {
  jobIdToBytes32,
  postValidationResponse,
  readValidationRequest,
  readValidationResponseCount,
  requestValidation,
} from "@/lib/erc8004";
import { sepoliaPublicClient } from "@/lib/wallets";
import type { Hex } from "viem";

export const runtime = "nodejs";
export const maxDuration = 120;

const ROUTE = "/api/cron/validator-tick";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();

  const { agentId, validationRegistry } = await getSepoliaAddresses();
  if (
    agentId === 0 ||
    validationRegistry === "0x0000000000000000000000000000000000000000"
  ) {
    await recordCronTick(ROUTE, "fail");
    return NextResponse.json(
      { ok: false, reason: "registries_not_deployed" },
      { status: 500 },
    );
  }

  const jobs = await getRecentJobs(20);
  if (jobs.length === 0) {
    await recordCronTick(ROUTE, "ok");
    return NextResponse.json({ ok: true, note: "no jobs to validate" });
  }

  let target: { job: typeof jobs[number]; jobId: Hex; hasRequest: boolean } | null = null;
  for (const job of jobs) {
    const jobId = jobIdToBytes32(job.id);
    const req = await readValidationRequest(jobId);
    const responseCount = await readValidationResponseCount(jobId);
    const hasRequest = (req?.createdAt ?? 0n) > 0n;
    if (!hasRequest) {
      target = { job, jobId, hasRequest: false };
      break;
    }
    if (responseCount === 0n) {
      target = { job, jobId, hasRequest: true };
      break;
    }
  }

  if (!target) {
    await recordCronTick(ROUTE, "ok");
    return NextResponse.json({
      ok: true,
      note: "all recent jobs already validated",
    });
  }

  const { job, jobId, hasRequest } = target;
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  let requestTx: Hex | null = null;
  let responseTx: Hex | null = null;
  let error: string | null = null;
  try {
    if (!hasRequest) {
      const r = await requestValidation({
        agentId: BigInt(agentId),
        jobId,
        detailUri: `redis:jobs:recent:${job.id}`,
        deadlineUnixSec: deadline,
        walletId: "validator",
      });
      requestTx = r?.txHash ?? null;
      if (requestTx) {
        await sepoliaPublicClient().waitForTransactionReceipt({ hash: requestTx });
      }
    }

    const score = scoreJob(job);
    const resp = await postValidationResponse({
      jobId,
      score,
      decimals: 0,
      detailUri: `score=${score} route=${job.quote.route}`,
      walletId: "validator",
    });
    responseTx = resp?.txHash ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const ok = !error && Boolean(responseTx);
  await recordCronTick(ROUTE, ok ? "ok" : "fail");

  return NextResponse.json({
    ok,
    jobId,
    sourceJobUuid: job.id,
    requestTx,
    responseTx,
    error,
  });
}

function scoreJob(job: {
  quote: { amountOut: string; amountOutMin: string };
}): number {
  const out = BigInt(job.quote.amountOut);
  const min = BigInt(job.quote.amountOutMin);
  if (out <= 0n || min <= 0n) return 50;
  const headroomBps = Number(((out - min) * 10_000n) / out);
  if (headroomBps < 25) return 80;
  if (headroomBps < 100) return 95;
  return 90;
}
