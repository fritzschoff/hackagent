import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { waitUntil } from "@vercel/functions";
import { getResourceServer, QUOTE_PRICE_USD, X402_NETWORK } from "@/lib/x402";
import { quoteSwap } from "@/lib/uniswap";
import { pushJob } from "@/lib/upstash";
import { tryLoadAccount } from "@/lib/wallets";
import { SwapIntent, type Job } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const agent = tryLoadAccount("agent");
const agentAddress = agent?.address ?? null;
const server = agentAddress ? await getResourceServer() : null;

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

  return NextResponse.json({ ok: true, job });
};

export const POST =
  agentAddress && server
    ? withX402(
        handler,
        {
          accepts: {
            scheme: "exact",
            price: QUOTE_PRICE_USD,
            network: X402_NETWORK,
            payTo: agentAddress,
            maxTimeoutSeconds: 60,
          },
          description:
            "tradewise.agentlab.eth — single Uniswap quote, signed and dated",
          mimeType: "application/json",
        },
        server,
      )
    : async () =>
        NextResponse.json(
          {
            error: "agent_not_configured",
            hint: "AGENT_PK env var is missing. See .env.example.",
          },
          { status: 500 },
        );

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
