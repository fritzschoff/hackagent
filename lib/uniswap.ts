import type { SwapIntent, Quote } from "@/lib/types";

const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";
const ETHEREUM_MAINNET_CHAIN_ID = 1;

export async function quoteSwap(intent: SwapIntent): Promise<Quote> {
  const apiKey = process.env.UNISWAP_API_KEY;
  if (!apiKey) {
    return mockQuote(intent);
  }

  const body = {
    type: "EXACT_INPUT",
    tokenIn: intent.tokenIn,
    tokenOut: intent.tokenOut,
    amount: intent.amountIn,
    swapper: "0x0000000000000000000000000000000000000000",
    tokenInChainId: ETHEREUM_MAINNET_CHAIN_ID,
    tokenOutChainId: ETHEREUM_MAINNET_CHAIN_ID,
    slippageTolerance: intent.maxSlippageBps / 100,
    routingPreference: "CLASSIC",
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
      quote?: {
        output?: { amount?: string };
        amountOut?: string;
        gasFee?: string;
        gasFeeUSD?: string;
      };
    };
    const amountOut =
      data.quote?.output?.amount ?? data.quote?.amountOut ?? "0";
    const slippageMul =
      (10_000 - intent.maxSlippageBps).toString();
    const amountOutMin = (
      (BigInt(amountOut) * BigInt(slippageMul)) /
      10_000n
    ).toString();

    return {
      amountOut,
      amountOutMin,
      route: "uniswap-classic-v3",
      gasEstimate: data.quote?.gasFee,
      feeUSD: data.quote?.gasFeeUSD,
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
