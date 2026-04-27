import { getSepoliaAddresses } from "@/lib/edge-config";
import { AGENT_ENS, resolveAgentEns } from "@/lib/ens";
import { tryLoadAccount } from "@/lib/wallets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`;

  const [addresses, ens] = await Promise.all([
    getSepoliaAddresses(),
    resolveAgentEns(),
  ]);
  const agent = tryLoadAccount("agent");
  const pricewatchAccount = tryLoadAccount("pricewatch");
  const agentAddr = agent?.address ?? ens.address ?? addresses.agentEOA;
  const pricewatchAddr =
    pricewatchAccount?.address ?? addresses.pricewatchEOA ?? null;
  const pricewatchAgentId = addresses.pricewatchAgentId ?? 0;

  const card = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "tradewise",
    description:
      ens.description ??
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
    ens: {
      name: ens.name,
      address: ens.address,
      agentCardUrl: ens.agentCardUrl,
      ensip25: {
        key: ens.ensip25Key,
        value: ens.registrationRecord,
      },
      lastSeenAt: ens.lastSeenAt,
    },
    x402Support: true,
    active: true,
    registrations:
      addresses.identityRegistry !== "0x0000000000000000000000000000000000000000"
        ? [
            {
              agentId: addresses.agentId,
              agentRegistry: `eip155:11155111:${addresses.identityRegistry}`,
            },
          ]
        : [],
    supportedTrust: ["reputation", "tee-attestation"],
    agentWallet: agentAddr,
    inft: addresses.inftAddress
      ? {
          contract: `eip155:11155111:${addresses.inftAddress}`,
          identityRegistryV2: addresses.identityRegistryV2
            ? `eip155:11155111:${addresses.identityRegistryV2}`
            : null,
          agentId: addresses.inftAgentId ?? null,
          tokenId: addresses.inftTokenId ?? null,
          viewer: `${baseUrl}/inft`,
          standard: "ERC-7857",
          antiLaunderingMechanism: "EIP-8004#section-4.4",
        }
      : null,
    upstreamAgents: pricewatchAddr
      ? [
          {
            name: "pricewatch",
            ens: "pricewatch.agentlab.eth",
            endpoint: `${baseUrl}/api/a2a/pricewatch/jobs`,
            wallet: pricewatchAddr,
            agentId: pricewatchAgentId,
            agentRegistry:
              addresses.identityRegistry !==
              "0x0000000000000000000000000000000000000000"
                ? `eip155:11155111:${addresses.identityRegistry}`
                : null,
            description:
              "Token metadata sidecar consumed by tradewise before each quote. Paid in x402 USDC.",
            x402Support: true,
          },
        ]
      : [],
  };

  return Response.json(card, {
    headers: { "Cache-Control": "public, max-age=30" },
  });
}
