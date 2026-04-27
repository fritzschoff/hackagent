import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { tryLoadAccount, type WalletId } from "@/lib/wallets";
import { X402_NETWORK } from "@/lib/x402";

type PayingFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const cache = new Map<WalletId, PayingFetch>();

export function payingFetchFor(walletId: WalletId): PayingFetch | null {
  const existing = cache.get(walletId);
  if (existing) return existing;

  const account = tryLoadAccount(walletId);
  if (!account) return null;

  const signer = toClientEvmSigner(account);
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: X402_NETWORK,
        client: new ExactEvmScheme(signer),
      },
    ],
  });
  cache.set(walletId, fetchWithPayment);
  return fetchWithPayment;
}

export type PaidCallResult<T> = {
  ok: boolean;
  status: number;
  body: T | null;
  paymentTx: string | null;
  payer: string | null;
  error?: string;
};

function decodePaymentResponse(headerValue: string | null): {
  transaction: string | null;
  payer: string | null;
} {
  if (!headerValue) return { transaction: null, payer: null };
  try {
    const decoded = JSON.parse(
      Buffer.from(headerValue, "base64").toString("utf8"),
    ) as { transaction?: string; payer?: string; success?: boolean };
    return {
      transaction: decoded.transaction ?? null,
      payer: decoded.payer ?? null,
    };
  } catch {
    return { transaction: null, payer: null };
  }
}

export async function callPaidJson<TResponse, TBody = unknown>(args: {
  walletId: WalletId;
  url: string;
  body: TBody;
  timeoutMs?: number;
}): Promise<PaidCallResult<TResponse>> {
  const fetcher = payingFetchFor(args.walletId);
  if (!fetcher) {
    return {
      ok: false,
      status: 0,
      body: null,
      paymentTx: null,
      payer: null,
      error: `wallet_not_configured:${args.walletId}`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    args.timeoutMs ?? 30_000,
  );

  try {
    const res = await fetcher(args.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args.body),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: TResponse | null = null;
    try {
      parsed = text ? (JSON.parse(text) as TResponse) : null;
    } catch {
      parsed = null;
    }
    const { transaction, payer } = decodePaymentResponse(
      res.headers.get("PAYMENT-RESPONSE") ??
        res.headers.get("X-PAYMENT-RESPONSE"),
    );
    return {
      ok: res.ok,
      status: res.status,
      body: parsed,
      paymentTx: transaction,
      payer,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: null,
      paymentTx: null,
      payer: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
