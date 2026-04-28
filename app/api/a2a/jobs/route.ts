import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { waitUntil } from "@vercel/functions";
import { getResourceServer, X402_NETWORK } from "@/lib/x402";
import { quoteSwap } from "@/lib/uniswap";
import {
  pushJob,
  pushKeeperhubRun,
  pushPricewatchCall,
  tryAcquireDebounce,
} from "@/lib/redis";
import { tryLoadAccount } from "@/lib/wallets";
import { SwapIntent, type Job } from "@/lib/types";
import { appendJobLog } from "@/lib/zg-storage";
import { callSwapWorkflow, triggerKeeperHub } from "@/lib/keeperhub";
import { reasonAboutQuote } from "@/lib/zg-compute";
import { callPaidJson } from "@/lib/x402-client";
import { postFeedback } from "@/lib/erc8004";
import { getSepoliaAddresses } from "@/lib/edge-config";
import { getQuotePrice } from "@/lib/pricing";
import type { PricewatchResult } from "@/lib/pricewatch";

export const runtime = "nodejs";
export const maxDuration = 300;

const agent = tryLoadAccount("agent");
const agentAddress = agent?.address ?? null;

type PricewatchCall = {
  ok: boolean;
  paymentTx: string | null;
  payer: string | null;
  result: PricewatchResult | null;
  error?: string;
};

async function consultPricewatch(
  baseUrl: string,
  tokenIn: string,
): Promise<PricewatchCall | null> {
  if (!process.env.PRICEWATCH_PK) return null;
  const res = await callPaidJson<{ ok: boolean; result: PricewatchResult }>({
    walletId: "agent",
    url: `${baseUrl}/api/a2a/pricewatch/jobs`,
    body: { token: tokenIn },
    timeoutMs: 20_000,
  });
  return {
    ok: res.ok,
    paymentTx: res.paymentTx,
    payer: res.payer,
    result: res.body?.result ?? null,
    error: res.error,
  };
}

const handler = async (req: NextRequest): Promise<NextResponse> => {
  const raw = await req.json().catch(() => null);
  const parsed = SwapIntent.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_intent", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const intent = parsed.data;
  const url = new URL(req.url);
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    `${url.protocol}//${url.host}`;

  const [pricewatch, quote] = await Promise.all([
    consultPricewatch(baseUrl, intent.tokenIn).catch((err) => {
      console.error(
        "[pricewatch] consult failed:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }),
    quoteSwap(intent),
  ]);

  const paymentResponseHeader =
    req.headers.get("payment-response") ?? req.headers.get("x-payment-response");
  const paymentTx = extractTxHash(paymentResponseHeader);
  const payerAddress = extractPayer(paymentResponseHeader);

  const job: Job = {
    id: crypto.randomUUID(),
    intent,
    quote,
    paymentTx,
    paymentFromAddress: payerAddress,
    ts: Date.now(),
    pricewatch: pricewatch
      ? {
          ok: pricewatch.ok,
          paymentTx: pricewatch.paymentTx,
          symbol: pricewatch.result?.symbol ?? null,
          priceUsd: pricewatch.result?.priceUsd ?? null,
        }
      : null,
  };

  if (pricewatch?.paymentTx) {
    waitUntil(
      pushPricewatchCall({
        jobId: job.id,
        paymentTx: pricewatch.paymentTx,
        symbol: pricewatch.result?.symbol ?? null,
        ts: Date.now(),
      }),
    );

    waitUntil(
      (async () => {
        try {
          const addresses = await getSepoliaAddresses();
          const pricewatchAgentId = addresses.pricewatchAgentId;
          if (!pricewatchAgentId || pricewatchAgentId === 0) return;
          const r = await postFeedback({
            agentId: BigInt(pricewatchAgentId),
            score: pricewatch.ok ? 95 : 50,
            decimals: 0,
            tag: "pricewatch-call",
            clientWallet: "agent",
          });
          console.log(
            `[pricewatch] feedback agentId=${pricewatchAgentId} txHash=${r?.txHash ?? "(none)"}`,
          );
        } catch (err) {
          console.error(
            "[pricewatch] feedback failed:",
            err instanceof Error ? err.message : err,
          );
        }
      })(),
    );
  }

  waitUntil(pushJob(job));
  waitUntil(
    reasonAboutQuote({
      tokenIn: intent.tokenIn,
      tokenOut: intent.tokenOut,
      amountIn: intent.amountIn,
      amountOut: quote.amountOut,
    })
      .then((res) => {
        if (res) {
          console.log(
            `[zg-compute] job=${job.id} model=${res.model} teeAttested=${res.teeAttested} text=${JSON.stringify(res.text).slice(0, 200)}`,
          );
        }
      })
      .catch((err) => {
        console.error(`[zg-compute] job=${job.id} failed:`, err?.message ?? err);
      }),
  );
  waitUntil(
    appendJobLog(job)
      .then((res) => {
        if (res) {
          console.log(
            `[zg-storage] job=${job.id} rootHash=${res.rootHash} anchored=${res.anchored} segments=${res.segmentsUploaded} txHash=${res.txHash || "(pending sdk update)"}`,
          );
        }
      })
      .catch((err) => {
        console.error(`[zg-storage] job=${job.id} failed:`, err?.message ?? err);
      }),
  );
  waitUntil(
    callSwapWorkflow({ intent, quote })
      .then(async (res) => {
        if (!res) return;
        console.log(
          `[keeperhub] job=${job.id} runId=${res.workflowRunId} status=${res.status} txHash=${res.txHash ?? "(pending)"}`,
        );
        if (res.txHash) {
          await pushKeeperhubRun({
            kind: "swap",
            jobId: job.id,
            workflowRunId: res.workflowRunId,
            txHash: res.txHash,
            summary: `${intent.tokenIn.slice(0, 6)}→${intent.tokenOut.slice(0, 6)}`,
            ts: Date.now(),
          });
        }
      })
      .catch((err) => {
        console.error(`[keeperhub] job=${job.id} failed:`, err?.message ?? err);
      }),
  );

  // Push-based heartbeat + reputation cache: every paid x402 quote triggers
  // a setText on chain through KeeperHub, instead of the old hourly cron
  // burning gas with no activity. Debounced 5min so a burst of quotes does
  // not produce a burst of setText txs.
  waitUntil(
    (async () => {
      try {
        const heartbeatOk = await tryAcquireDebounce(
          "keeperhub:debounce:heartbeat",
          300,
        );
        if (heartbeatOk) {
          const r = await triggerKeeperHub({
            kind: "heartbeat",
            input: { ts: Date.now() },
            pollForTx: false,
          });
          if (r) {
            await pushKeeperhubRun({
              kind: "heartbeat",
              jobId: `push-${job.id}`,
              workflowRunId: r.workflowRunId,
              txHash: r.txHash,
              summary: "ens last-seen-at (push from x402)",
              ts: Date.now(),
            });
          }
        }
        const repOk = await tryAcquireDebounce(
          "keeperhub:debounce:reputation-cache",
          300,
        );
        if (repOk) {
          const r = await triggerKeeperHub({
            kind: "reputation-cache",
            input: { agentId: 1, ts: Date.now() },
            pollForTx: false,
          });
          if (r) {
            await pushKeeperhubRun({
              kind: "reputation-cache",
              jobId: `push-${job.id}`,
              workflowRunId: r.workflowRunId,
              txHash: r.txHash,
              summary: "ens reputation-summary (push from x402)",
              ts: Date.now(),
            });
          }
        }
      } catch (err) {
        console.error(
          "[keeperhub-push] failed:",
          err instanceof Error ? err.message : err,
        );
      }
    })(),
  );

  return NextResponse.json({ ok: true, job });
};

// Phase 5: handler cache keyed by current price. Each tier crossing builds
// a fresh withX402 wrapper but reuses the heavy x402ResourceServer init.
const handlerByPrice = new Map<
  string,
  (req: NextRequest) => Promise<NextResponse>
>();

async function getPaidHandler(
  price: `$${string}`,
): Promise<(req: NextRequest) => Promise<NextResponse>> {
  const cached = handlerByPrice.get(price);
  if (cached) return cached;
  const server = await getResourceServer();
  // Phase 9: when X402_PAYOUT_OVERRIDE is set (typically the RevenueSplitter
  // address), x402 USDC settlements land at the splitter instead of the
  // agent EOA — turning the agent into a public revenue-share entity.
  const payoutOverride = process.env.X402_PAYOUT_OVERRIDE as
    | `0x${string}`
    | undefined;
  const payTo: `0x${string}` =
    payoutOverride && /^0x[a-fA-F0-9]{40}$/.test(payoutOverride)
      ? payoutOverride
      : agentAddress!;
  const built = withX402(
    handler,
    {
      accepts: {
        scheme: "exact",
        price,
        network: X402_NETWORK,
        payTo,
        maxTimeoutSeconds: 60,
      },
      description:
        "tradewise.agentlab.eth — single Uniswap quote, signed and dated",
      mimeType: "application/json",
    },
    server,
  );
  handlerByPrice.set(price, built);
  return built;
}

export const POST = async (req: NextRequest): Promise<NextResponse> => {
  if (!agentAddress) {
    return NextResponse.json(
      {
        error: "agent_not_configured",
        hint: "AGENT_PK env var is missing. See .env.example.",
      },
      { status: 500 },
    );
  }
  const addresses = await getSepoliaAddresses();
  const reputationRegistry = addresses.reputationRegistry;
  const agentId = BigInt(addresses.agentId);
  const { price } =
    reputationRegistry !== "0x0000000000000000000000000000000000000000" &&
    agentId > 0n
      ? await getQuotePrice({ reputationRegistry, agentId })
      : { price: "$0.10" as const };
  const paid = await getPaidHandler(price);
  return paid(req);
};

function extractTxHash(header: string | null): string | null {
  if (!header) return null;
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return decoded.transaction ?? decoded.txHash ?? null;
  } catch {
    return null;
  }
}

function extractPayer(header: string | null): string | null {
  if (!header) return null;
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return decoded.payer ?? decoded.from ?? null;
  } catch {
    return null;
  }
}
