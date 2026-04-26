import type { SwapIntent, Quote } from "@/lib/types";

const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";
const ETHEREUM_MAINNET_CHAIN_ID = 1;

const BASE_SEPOLIA_TO_MAINNET: Record<string, `0x${string}`> = {
  "0x4200000000000000000000000000000000000006":
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e":
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "0x7683022d84F726a96c4A6611cD31DBf5409c0Ac9":
    "0x6B175474E89094C44Da98b954EedeAC495271d0F",
};

function toMainnet(addr: `0x${string}`): `0x${string}` | null {
  const lower = addr.toLowerCase();
  for (const k of Object.keys(
    BASE_SEPOLIA_TO_MAINNET,
  ) as (keyof typeof BASE_SEPOLIA_TO_MAINNET)[]) {
    if (k.toLowerCase() === lower) {
      const v = BASE_SEPOLIA_TO_MAINNET[k];
      if (v) return v;
    }
  }
  if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return addr;
  return null;
}

export async function quoteSwap(intent: SwapIntent): Promise<Quote> {
  const apiKey = process.env.UNISWAP_API_KEY;
  if (!apiKey) {
    return mockQuote(intent);
  }

  const tokenInMainnet = toMainnet(intent.tokenIn as `0x${string}`);
  const tokenOutMainnet = toMainnet(intent.tokenOut as `0x${string}`);
  if (!tokenInMainnet || !tokenOutMainnet) {
    return mockQuote(intent, "unmapped_token");
  }

  const body = {
    type: "EXACT_INPUT",
    tokenIn: tokenInMainnet,
    tokenOut: tokenOutMainnet,
    amount: intent.amountIn,
    swapper: "0x0000000000000000000000000000000000000000",
    tokenInChainId: ETHEREUM_MAINNET_CHAIN_ID,
    tokenOutChainId: ETHEREUM_MAINNET_CHAIN_ID,
    slippageTolerance: intent.maxSlippageBps / 100,
    routingPreference: "BEST_PRICE",
  };

  try {
    const res = await fetch(`${UNISWAP_API_BASE}/quote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return mockQuote(intent, `uniswap_api_${res.status}`);
    }

    const data = (await res.json()) as {
      routing?: string;
      quote?: {
        output?: { amount?: string };
        amountOut?: string;
        gasFee?: string;
        gasFeeUSD?: number | string;
        priceImpact?: number;
      };
    };
    const amountOut =
      data.quote?.output?.amount ?? data.quote?.amountOut ?? "0";
    const slippageMul = (10_000 - intent.maxSlippageBps).toString();
    const amountOutMin = (
      (BigInt(amountOut) * BigInt(slippageMul)) /
      10_000n
    ).toString();

    return {
      amountOut,
      amountOutMin,
      route: `uniswap-${(data.routing ?? "best-price").toLowerCase()}`,
      gasEstimate: data.quote?.gasFee,
      feeUSD:
        typeof data.quote?.gasFeeUSD === "number"
          ? data.quote.gasFeeUSD.toFixed(4)
          : data.quote?.gasFeeUSD,
    };
  } catch {
    return mockQuote(intent, "uniswap_api_error");
  }
}

function mockQuote(intent: SwapIntent, route = "mock-quote"): Quote {
  const amountIn = BigInt(intent.amountIn);
  const amountOut = (amountIn * 998n) / 1000n;
  const amountOutMin =
    (amountOut * BigInt(10_000 - intent.maxSlippageBps)) / 10_000n;
  return {
    amountOut: amountOut.toString(),
    amountOutMin: amountOutMin.toString(),
    route,
  };
}

export const TEST_TOKENS = {
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  DAI: "0x7683022d84F726a96c4A6611cD31DBf5409c0Ac9",
} as const;

export function randomTestIntent(): SwapIntent {
  const tokens: Array<`0x${string}`> = [
    TEST_TOKENS.WETH,
    TEST_TOKENS.USDC,
    TEST_TOKENS.DAI,
  ];
  const i = Math.floor(Math.random() * tokens.length);
  let j = Math.floor(Math.random() * tokens.length);
  if (i === j) j = (j + 1) % tokens.length;
  const tokenIn = tokens[i] ?? TEST_TOKENS.WETH;
  const tokenOut = tokens[j] ?? TEST_TOKENS.USDC;
  return {
    task: "swap" as const,
    tokenIn,
    tokenOut,
    amountIn: String(1_000_000 + Math.floor(Math.random() * 9_000_000)),
    maxSlippageBps: 100,
  };
}
