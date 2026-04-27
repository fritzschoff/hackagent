import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { getResourceServer, X402_NETWORK } from "@/lib/x402";
import { tryLoadAccount } from "@/lib/wallets";
import { PricewatchQuery, lookupTokenMetadata } from "@/lib/pricewatch";

export const runtime = "nodejs";
export const maxDuration = 30;

const PRICEWATCH_PRICE_USD = "$0.02" as const;

const pricewatch = tryLoadAccount("pricewatch");
const pricewatchAddress = pricewatch?.address ?? null;

const handler = async (req: NextRequest): Promise<NextResponse> => {
  const raw = await req.json().catch(() => null);
  const parsed = PricewatchQuery.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const result = await lookupTokenMetadata(parsed.data);
  return NextResponse.json({ ok: true, result });
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
        price: PRICEWATCH_PRICE_USD,
        network: X402_NETWORK,
        payTo: pricewatchAddress!,
        maxTimeoutSeconds: 30,
      },
      description:
        "pricewatch.agentlab.eth — token metadata (symbol, decimals, last price, liquidity)",
      mimeType: "application/json",
    },
    server,
  );
  return cachedPaidHandler;
}

export const POST = async (req: NextRequest): Promise<NextResponse> => {
  if (!pricewatchAddress) {
    return NextResponse.json(
      {
        error: "pricewatch_not_configured",
        hint: "PRICEWATCH_PK env var is missing.",
      },
      { status: 500 },
    );
  }
  const paid = await getPaidHandler();
  return paid(req);
};
