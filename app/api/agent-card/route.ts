import { getSepoliaAddresses } from "@/lib/edge-config";
import { AGENT_ENS } from "@/lib/ens";
import { tryLoadAccount } from "@/lib/wallets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`;

  const addresses = await getSepoliaAddresses();
  const agent = tryLoadAccount("agent");
  const agentAddr = agent?.address ?? addresses.agentEOA;

  const card = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "tradewise",
    description:
      "Reliable Uniswap swap concierge. Pay per quote in USDC on Base Sepolia.",
    image: `${baseUrl}/avatar.png`,
    services: [
      {
        name: "A2A",
        endpoint: `${baseUrl}/api/a2a/jobs`,
        version: "0.3.0",
      },
      {
        name: "MCP",
        endpoint: `${baseUrl}/api/mcp`,
        version: "2025-06-18",
      },
      {
        name: "ENS",
        endpoint: AGENT_ENS,
        version: "v1",
      },
    ],
    x402Support: true,
    active: true,
    registrations: addresses.identityRegistry !== "0x0000000000000000000000000000000000000000"
      ? [
          {
            agentId: addresses.agentId,
            agentRegistry: `eip155:11155111:${addresses.identityRegistry}`,
          },
        ]
      : [],
    supportedTrust: ["reputation", "tee-attestation"],
    agentWallet: agentAddr,
  };

  return Response.json(card, {
    headers: { "Cache-Control": "public, max-age=30" },
  });
}
