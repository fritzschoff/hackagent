/**
 * Seeds Redis with default static ENS text records (description, url,
 * agent-card, current-price-tier) for every label our W2 gateway resolves.
 * Idempotent — running again overwrites with the latest values.
 *
 *   pnpm exec tsx scripts/seed-ens-static.ts
 *
 * Required env: REDIS_URL.
 */
import { getRedis } from "../lib/redis";

type StaticBlock = {
  description?: string;
  url?: string;
  "agent-card"?: string;
  "current-price-tier"?: string;
};

const APP_URL = "https://hackagent-nine.vercel.app";

const SEED: Record<string, StaticBlock> = {
  "tradewise.agentlab.eth": {
    description:
      "Autonomous on-chain agent quoting Uniswap swaps for x402 USDC. Publicly tradeable, reputation-collateralized, sla-bonded.",
    url: APP_URL,
    "agent-card": `${APP_URL}/.well-known/agent-card.json`,
    "current-price-tier": "$0.10–$0.20 / paid quote (reputation-gated)",
  },
  "pricewatch.agentlab.eth": {
    description:
      "Upstream price oracle agent. Paid $0.02 per quote in x402 USDC for token metadata. Two-hop: client → tradewise → pricewatch.",
    url: `${APP_URL}/marketplace`,
    "agent-card": `${APP_URL}/.well-known/agent-card.json`,
    "current-price-tier": "$0.02 / quote",
  },
  "agent-eoa.tradewise.agentlab.eth": {
    description:
      "Tradewise agent operator wallet (EOA). Receives x402 settlements on Base Sepolia; signs ENS heartbeats and ERC-8004 feedback.",
    url: "https://sepolia.etherscan.io/address/0x7a83678e330a0C565e6272498FFDF421621820A3",
  },
  "pricewatch-deployer.agentlab.eth": {
    description:
      "Pricewatch deployer wallet — Sepolia gas pool, INFT minter, AgentBids/Merger broadcaster.",
    url: "https://sepolia.etherscan.io/address/0xBf5df5c89b1eCa32C1E8AC7ECdd93d44F86F2469",
  },
  "validator.agentlab.eth": {
    description:
      "ERC-8004 validator wallet. Approves or slashes SLA bonds and compliance-manifest challenges.",
    url: "https://sepolia.etherscan.io/address/0x01340D5A7A6995513C0C3EdF0367236e5b9C83F6",
  },
  "keeperhub.agentlab.eth": {
    description:
      "KeeperHub Turnkey-managed wallet. Runs heartbeat, reputation-pulse, avatar-sync, and gateway-cache-invalidate workflows for tradewise.",
    url: "https://app.keeperhub.com",
  },
};

async function main() {
  const r = getRedis();
  if (!r) {
    console.error("REDIS_URL missing — set it in .env.local");
    process.exit(1);
  }

  let writes = 0;
  for (const [label, block] of Object.entries(SEED)) {
    for (const [key, value] of Object.entries(block)) {
      if (value === undefined) continue;
      const redisKey = `ens:static:${label}:${key}`;
      await r.set(redisKey, value);
      writes++;
      console.log(`  ✓ ${redisKey} = ${value.length > 60 ? value.slice(0, 57) + "..." : value}`);
    }
  }
  console.log(`\nseeded ${writes} static ENS records across ${Object.keys(SEED).length} labels.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
