import {
  getSepoliaAddresses,
  getBaseSepoliaAddresses,
} from "@/lib/edge-config";
import { AGENT_ENS, resolveAgentEns } from "@/lib/ens";
import { tryLoadAccount } from "@/lib/wallets";
import { getQuotePrice, PRICE_TIERS } from "@/lib/pricing";
import { zeroAddress } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`;

  const [addresses, baseAddrs, ens] = await Promise.all([
    getSepoliaAddresses(),
    getBaseSepoliaAddresses(),
    resolveAgentEns(),
  ]);

  const repAddr = addresses.reputationRegistry;
  const agentIdBig = BigInt(addresses.agentId);
  const pricing =
    repAddr !== zeroAddress && agentIdBig > 0n
      ? await getQuotePrice({
          reputationRegistry: repAddr,
          agentId: agentIdBig,
        })
      : { price: "$0.10" as const, feedbackCount: 0 };
  const agent = tryLoadAccount("agent");
  const agentAddr = agent?.address ?? ens.address ?? addresses.agentEOA;

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
      reputationSummary: ens.reputationSummary,
    },
    pricing: {
      scheme: "reputation-graduated",
      currency: "USDC",
      currentPrice: pricing.price,
      currentFeedbackCount: pricing.feedbackCount,
      tiers: PRICE_TIERS.map((t) => ({
        minFeedbackCount: t.minFeedback,
        price: t.price,
      })),
    },
    paymentProtocols: {
      x402: { supported: true, chain: "eip155:84532", token: "USDC" },
      // Stripe MPP support is documented in the roadmap §8; integration
      // is gated on a Stripe acquirer account + Tempo testnet enrollment
      // we don't have in this build. Schema field is exposed so MPP-aware
      // clients can detect agreed support cleanly.
      mpp: { supported: false, hint: "configure STRIPE_MPP_SECRET to enable" },
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
    ipo: baseAddrs.agentShares
      ? {
          shares: `eip155:84532:${baseAddrs.agentShares}`,
          revenueSplitter: baseAddrs.revenueSplitter
            ? `eip155:84532:${baseAddrs.revenueSplitter}`
            : null,
          sharesSale: baseAddrs.sharesSale
            ? `eip155:84532:${baseAddrs.sharesSale}`
            : null,
          pricePerShareUsdc: baseAddrs.pricePerShareUsdc ?? null,
          viewer: `${baseUrl}/ipo`,
          model: "fractional revenue-share ERC-20 backed by x402 settlements",
        }
      : null,
    upstreamAgents: [],
  };

  return Response.json(card, {
    headers: { "Cache-Control": "public, max-age=30" },
  });
}
