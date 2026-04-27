import { type Address } from "viem";
import { sepoliaPublicClient } from "@/lib/wallets";
import { getRedis } from "@/lib/redis";
import ReputationRegistryAbi from "@/lib/abis/ReputationRegistry.json";

const REP_ABI = ReputationRegistryAbi as readonly unknown[];

export type PriceTier = {
  minFeedback: number;
  price: `$${string}`;
};

/// More feedback -> higher price. The curve is the agent quoting itself
/// up as its on-chain reputation accrues.
export const PRICE_TIERS: PriceTier[] = [
  { minFeedback: 0, price: "$0.10" },
  { minFeedback: 50, price: "$0.15" },
  { minFeedback: 100, price: "$0.20" },
];

const CACHE_KEY = "agent:price";
const CACHE_TTL_SEC = 60;

export function pickPrice(feedbackCount: number): `$${string}` {
  let chosen: `$${string}` = PRICE_TIERS[0]!.price;
  for (const tier of PRICE_TIERS) {
    if (feedbackCount >= tier.minFeedback) chosen = tier.price;
  }
  return chosen;
}

export async function readFeedbackCount(args: {
  reputationRegistry: Address;
  agentId: bigint;
}): Promise<number> {
  const client = sepoliaPublicClient();
  try {
    const v = (await client.readContract({
      address: args.reputationRegistry,
      abi: REP_ABI,
      functionName: "feedbackCount",
      args: [args.agentId],
    })) as bigint;
    return Number(v);
  } catch (err) {
    console.error(
      "[pricing] feedbackCount failed:",
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}

export async function getQuotePrice(args: {
  reputationRegistry: Address;
  agentId: bigint;
}): Promise<{ price: `$${string}`; feedbackCount: number }> {
  const redis = getRedis();
  if (redis) {
    const cached = await redis.get(CACHE_KEY).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as {
          price: `$${string}`;
          feedbackCount: number;
        };
      } catch {
        // fall through
      }
    }
  }

  const feedbackCount = await readFeedbackCount(args);
  const price = pickPrice(feedbackCount);
  const result = { price, feedbackCount };

  if (redis) {
    await redis
      .set(CACHE_KEY, JSON.stringify(result), "EX", CACHE_TTL_SEC)
      .catch(() => undefined);
  }
  return result;
}
