import { NextRequest, NextResponse } from "next/server";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { verifyCronAuth, unauthorized } from "@/lib/cron-auth";
import { recordCronTick } from "@/lib/redis";
import { getClientWalletId, tryLoadAccount } from "@/lib/wallets";
import { randomTestIntent } from "@/lib/uniswap";

export const runtime = "nodejs";
export const maxDuration = 60;

const ROUTE = "/api/cron/client-tick";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();

  const idParam = new URL(req.url).searchParams.get("id");
  const walletId = getClientWalletId(idParam);
  const account = tryLoadAccount(walletId);
  if (!account) {
    await recordCronTick(ROUTE, "fail");
    return NextResponse.json(
      { error: "client_not_configured", walletId },
      { status: 500 },
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    `https://${req.headers.get("host") ?? "localhost:3000"}`;

  const signer = toClientEvmSigner(account);
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: "eip155:84532",
        client: new ExactEvmScheme(signer),
      },
    ],
  });

  const intent = randomTestIntent();
  const url = `${baseUrl}/api/a2a/jobs`;

  try {
    const res = await fetchWithPayment(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(intent),
    });

    const ok = res.ok;
    const body = await res.json().catch(() => ({}));
    const paymentResponseHeader =
      res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");

    await recordCronTick(ROUTE, ok ? "ok" : "fail");

    return NextResponse.json({
      ok,
      walletId,
      payer: account.address,
      intent,
      response: body,
      paymentResponse: paymentResponseHeader,
      status: res.status,
    });
  } catch (err) {
    await recordCronTick(ROUTE, "fail");
    return NextResponse.json(
      {
        ok: false,
        walletId,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
