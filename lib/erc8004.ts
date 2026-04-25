import type { Address } from "viem";

export type FeedbackEntry = {
  agentId: bigint;
  client: Address;
  score: number;
  decimals: number;
  tag: string;
  ts: number;
  txHash: `0x${string}`;
};

export type ValidationEntry = {
  agentId: bigint;
  validator: Address;
  jobId: string;
  score: number;
  ts: number;
  txHash: `0x${string}`;
};

export async function readRecentFeedback(_limit = 50): Promise<FeedbackEntry[]> {
  return [];
}

export async function readRecentValidations(
  _limit = 50,
): Promise<ValidationEntry[]> {
  return [];
}

export async function postFeedback(_args: {
  agentId: bigint;
  score: number;
  tag: string;
  clientWallet: "client1" | "client2" | "client3";
}): Promise<{ txHash: `0x${string}` } | null> {
  return null;
}

export async function postValidation(_args: {
  agentId: bigint;
  jobId: string;
  score: number;
}): Promise<{ txHash: `0x${string}` } | null> {
  return null;
}
