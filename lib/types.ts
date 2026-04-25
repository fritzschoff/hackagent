import { z } from "zod";

export const SwapIntent = z.object({
  task: z.literal("swap"),
  tokenIn: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tokenOut: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amountIn: z.string().regex(/^\d+$/),
  maxSlippageBps: z.number().int().min(0).max(10_000).default(100),
  deadline: z.number().int().positive().optional(),
});

export type SwapIntent = z.infer<typeof SwapIntent>;

export const Quote = z.object({
  amountOut: z.string(),
  amountOutMin: z.string(),
  route: z.string(),
  gasEstimate: z.string().optional(),
  feeUSD: z.string().optional(),
});

export type Quote = z.infer<typeof Quote>;

export const Job = z.object({
  id: z.string(),
  intent: SwapIntent,
  quote: Quote,
  paymentTx: z.string().nullable(),
  paymentFromAddress: z.string().nullable(),
  ts: z.number(),
});

export type Job = z.infer<typeof Job>;

export type CronStatus = {
  route: string;
  lastTickAgoSec: number | null;
  lastStatus: "ok" | "fail" | null;
};
