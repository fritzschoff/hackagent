import { x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

const FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL ?? "https://facilitator.x402.org";

export const X402_NETWORK = "eip155:84532" as const;
export const BASE_SEPOLIA_USDC =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
export const QUOTE_PRICE_USD = "$0.10" as const;

let serverPromise: Promise<x402ResourceServer> | null = null;

export function getResourceServer(): Promise<x402ResourceServer> {
  if (serverPromise) return serverPromise;
  serverPromise = (async () => {
    const facilitatorClient = new HTTPFacilitatorClient({
      url: FACILITATOR_URL,
    });
    const server = new x402ResourceServer(facilitatorClient).register(
      X402_NETWORK,
      new ExactEvmScheme(),
    );
    await server.initialize();
    return server;
  })();
  return serverPromise;
}
