import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { waitUntil } from "@vercel/functions";
import { getResourceServer, QUOTE_PRICE_USD, X402_NETWORK } from "@/lib/x402";
import { quoteSwap } from "@/lib/uniswap";
import { pushJob } from "@/lib/redis";
import { tryLoadAccount } from "@/lib/wallets";
import { SwapIntent, type Job } from "@/lib/types";
import { appendJobLog } from "@/lib/zg-storage";
import { callSwapWorkflow } from "@/lib/keeperhub";

export const runtime = "nodejs";
export const maxDuration = 300;

const agent = tryLoadAccount("agent");
const agentAddress = agent?.address ?? null;

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
  const quote = await quoteSwap(intent);

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
  };

  waitUntil(pushJob(job));
  waitUntil(
    appendJobLog(job)
      .then((res) => {
        if (res) {
          console.log(
            `[zg-storage] job=${job.id} rootHash=${res.rootHash} anchored=${res.anchored} txHash=${res.txHash || "(pending sdk update)"}`,
          );
        }
      })
      .catch((err) => {
        console.error(`[zg-storage] job=${job.id} failed:`, err?.message ?? err);
      }),
  );
  waitUntil(
    callSwapWorkflow({ intent, quote })
      .then((res) => {
        if (res) {
          console.log(
            `[keeperhub] job=${job.id} runId=${res.workflowRunId} status=${res.status} txHash=${res.txHash ?? "(pending)"}`,
          );
        }
      })
      .catch((err) => {
        console.error(`[keeperhub] job=${job.id} failed:`, err?.message ?? err);
      }),
  );

  return NextResponse.json({ ok: true, job });
};

let cachedPaidHandler: ((req: NextRequest) => Promise<NextResponse>) | null =
  null;

async function getPaidHandler(): Promise<
  (req: NextRequest) => Promise<NextResponse>
> {
  if (cachedPaidHandler) return cachedPaidHandler;
  const server = await getResourceServer();
  cachedPaidHandler = withX402(
    handler,
    {
      accepts: {
        scheme: "exact",
        price: QUOTE_PRICE_USD,
        network: X402_NETWORK,
        payTo: agentAddress!,
        maxTimeoutSeconds: 60,
      },
      description:
        "tradewise.agentlab.eth — single Uniswap quote, signed and dated",
      mimeType: "application/json",
    },
    server,
  );
  return cachedPaidHandler;
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
  const paid = await getPaidHandler();
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
