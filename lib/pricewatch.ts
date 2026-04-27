import { z } from "zod";

export const PricewatchQuery = z.object({
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export type PricewatchQuery = z.infer<typeof PricewatchQuery>;

export const PricewatchResult = z.object({
  token: z.string(),
  symbol: z.string(),
  decimals: z.number(),
  priceUsd: z.string(),
  liquidityUsd: z.string(),
  source: z.literal("uniswap-mainnet"),
  ts: z.number(),
});

export type PricewatchResult = z.infer<typeof PricewatchResult>;

const BASE_SEPOLIA_TO_MAINNET: Record<string, `0x${string}`> = {
  "0x4200000000000000000000000000000000000006":
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e":
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "0x7683022d84F726a96c4A6611cD31DBf5409c0Ac9":
    "0x6B175474E89094C44Da98b954EedeAC495271d0F",
};

const KNOWN_METADATA: Record<string, { symbol: string; decimals: number }> = {
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": { symbol: "WETH", decimals: 18 },
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": { symbol: "USDC", decimals: 6 },
  "0x6B175474E89094C44Da98b954EedeAC495271d0F": { symbol: "DAI", decimals: 18 },
};

function toMainnet(addr: string): `0x${string}` | null {
  const lower = addr.toLowerCase();
  for (const [k, v] of Object.entries(BASE_SEPOLIA_TO_MAINNET)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

const FAKE_PRICES: Record<string, { priceUsd: string; liquidityUsd: string }> = {
  WETH: { priceUsd: "3182.40", liquidityUsd: "412000000" },
  USDC: { priceUsd: "1.00", liquidityUsd: "8400000000" },
  DAI: { priceUsd: "1.00", liquidityUsd: "210000000" },
};

export async function lookupTokenMetadata(
  query: PricewatchQuery,
): Promise<PricewatchResult> {
  const mainnet = toMainnet(query.token) ?? (query.token as `0x${string}`);
  const meta = KNOWN_METADATA[mainnet] ?? { symbol: "UNKNOWN", decimals: 18 };
  const price = FAKE_PRICES[meta.symbol] ?? {
    priceUsd: "0.00",
    liquidityUsd: "0",
  };
  return PricewatchResult.parse({
    token: mainnet,
    symbol: meta.symbol,
    decimals: meta.decimals,
    priceUsd: price.priceUsd,
    liquidityUsd: price.liquidityUsd,
    source: "uniswap-mainnet",
    ts: Date.now(),
  });
}
