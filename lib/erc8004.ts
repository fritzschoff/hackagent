import {
  keccak256,
  parseAbi,
  toBytes,
  type Address,
  type Hex,
  type AbiEvent,
} from "viem";
import { sepoliaPublicClient, sepoliaWalletClient } from "@/lib/wallets";
import type { WalletId } from "@/lib/wallets";
import { getSepoliaAddresses } from "@/lib/edge-config";
import IdentityRegistryAbi from "@/lib/abis/IdentityRegistry.json";
import ReputationRegistryAbi from "@/lib/abis/ReputationRegistry.json";
import ValidationRegistryAbi from "@/lib/abis/ValidationRegistry.json";

const REP_ABI = ReputationRegistryAbi as readonly unknown[];
const VAL_ABI = ValidationRegistryAbi as readonly unknown[];
const ID_ABI = IdentityRegistryAbi as readonly unknown[];

const FEEDBACK_POSTED = (REP_ABI as AbiEvent[]).find(
  (e) => e.type === "event" && e.name === "FeedbackPosted",
) as AbiEvent;

const VALIDATION_RESPONSE_POSTED = (VAL_ABI as AbiEvent[]).find(
  (e) => e.type === "event" && e.name === "ValidationResponsePosted",
) as AbiEvent;

const SEPOLIA_DEPLOY_BLOCK_DEFAULT = 6_000_000n;

// Sepolia public RPCs (publicnode, thirdweb fallback) cap eth_getLogs at
// 50k or 1k blocks respectively. Chunk to stay safely under the lower cap.
const LOG_CHUNK_BLOCKS = 49_000n;

async function getLogsChunked<T>(
  client: ReturnType<typeof sepoliaPublicClient>,
  args: {
    address: Address;
    event: AbiEvent;
    fromBlock: bigint;
    toBlock: bigint;
  },
): Promise<T[]> {
  const out: T[] = [];
  let from = args.fromBlock;
  while (from <= args.toBlock) {
    const to =
      from + LOG_CHUNK_BLOCKS - 1n > args.toBlock
        ? args.toBlock
        : from + LOG_CHUNK_BLOCKS - 1n;
    try {
      const logs = await client.getLogs({
        address: args.address,
        event: args.event,
        fromBlock: from,
        toBlock: to,
      });
      out.push(...(logs as T[]));
    } catch (e) {
      console.error(
        `getLogs ${args.event.name} ${from}..${to} failed:`,
        (e as Error).message,
      );
    }
    from = to + 1n;
  }
  return out;
}

export type FeedbackEntry = {
  agentId: bigint;
  client: Address;
  score: number;
  decimals: number;
  tag: string;
  ts: number;
  txHash: Hex;
  blockNumber: bigint;
  detailUri: string;
};

export type ValidationEntry = {
  jobId: Hex;
  validator: Address;
  score: number;
  decimals: number;
  ts: number;
  txHash: Hex;
  blockNumber: bigint;
  detailUri: string;
};

export type AgentRecord = {
  agentId: bigint;
  agentDomain: string;
  agentAddress: Address;
  agentWallet: Address;
  registeredAt: bigint;
  active: boolean;
};

const tagAbi = parseAbi([
  "function bytes32ToString(bytes32) pure returns (string)",
]);
void tagAbi;

function decodeTag(tag: Hex): string {
  const hex = tag.slice(2);
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const c = parseInt(hex.slice(i, i + 2), 16);
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

export async function readAgent(agentId: bigint): Promise<AgentRecord | null> {
  const { identityRegistry } = await getSepoliaAddresses();
  if (identityRegistry === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  const client = sepoliaPublicClient();
  try {
    const a = (await client.readContract({
      address: identityRegistry,
      abi: ID_ABI,
      functionName: "getAgent",
      args: [agentId],
    })) as AgentRecord;
    if (a.agentId !== agentId) return null;
    return a;
  } catch {
    return null;
  }
}

export async function readRecentFeedback(
  limit = 50,
): Promise<FeedbackEntry[]> {
  const { reputationRegistry } = await getSepoliaAddresses();
  if (reputationRegistry === "0x0000000000000000000000000000000000000000") {
    return [];
  }
  const client = sepoliaPublicClient();
  const tip = await client.getBlockNumber();
  const fromBlock =
    tip > SEPOLIA_DEPLOY_BLOCK_DEFAULT
      ? tip - 100_000n
      : SEPOLIA_DEPLOY_BLOCK_DEFAULT;

  type LogShape = {
    args: {
      agentId: bigint;
      client: Address;
      score: number;
      decimals: number;
      tag: Hex;
      timestamp: bigint;
      detailUri: string;
    };
    transactionHash: Hex;
    blockNumber: bigint;
  };
  const logs = await getLogsChunked<LogShape>(client, {
    address: reputationRegistry,
    event: FEEDBACK_POSTED,
    fromBlock,
    toBlock: tip,
  });
  const recent = logs.slice(-limit).reverse();
  return recent.map((log) => ({
    agentId: log.args.agentId,
    client: log.args.client,
    score: Number(log.args.score),
    decimals: Number(log.args.decimals),
    tag: decodeTag(log.args.tag),
    ts: Number(log.args.timestamp) * 1000,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    detailUri: log.args.detailUri,
  }));
}

export async function readRecentValidations(
  limit = 50,
): Promise<ValidationEntry[]> {
  const { validationRegistry } = await getSepoliaAddresses();
  if (validationRegistry === "0x0000000000000000000000000000000000000000") {
    return [];
  }
  const client = sepoliaPublicClient();
  const tip = await client.getBlockNumber();
  const fromBlock =
    tip > SEPOLIA_DEPLOY_BLOCK_DEFAULT
      ? tip - 100_000n
      : SEPOLIA_DEPLOY_BLOCK_DEFAULT;

  type LogShape = {
    args: {
      jobId: Hex;
      validator: Address;
      score: number;
      decimals: number;
      detailUri: string;
      timestamp: bigint;
    };
    transactionHash: Hex;
    blockNumber: bigint;
  };
  const logs = await getLogsChunked<LogShape>(client, {
    address: validationRegistry,
    event: VALIDATION_RESPONSE_POSTED,
    fromBlock,
    toBlock: tip,
  });
  const recent = logs.slice(-limit).reverse();
  return recent.map((log) => ({
    jobId: log.args.jobId,
    validator: log.args.validator,
    score: Number(log.args.score),
    decimals: Number(log.args.decimals),
    ts: Number(log.args.timestamp) * 1000,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    detailUri: log.args.detailUri,
  }));
}

export async function postFeedback(args: {
  agentId: bigint;
  score: number;
  decimals: number;
  tag: string;
  detailUri?: string;
  clientWallet: WalletId;
}): Promise<{ txHash: Hex } | null> {
  const { reputationRegistry } = await getSepoliaAddresses();
  if (reputationRegistry === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  const wallet = sepoliaWalletClient(args.clientWallet);
  const tagBytes = tagToBytes32(args.tag);
  const txHash = await wallet.writeContract({
    address: reputationRegistry,
    abi: REP_ABI,
    functionName: "postFeedback",
    args: [
      args.agentId,
      args.score,
      args.decimals,
      tagBytes,
      args.detailUri ?? "",
    ],
  });
  return { txHash };
}

export function jobIdToBytes32(jobIdStr: string): Hex {
  return keccak256(toBytes(jobIdStr));
}

export async function readValidationRequest(jobId: Hex): Promise<{
  agentId: bigint;
  createdAt: bigint;
  resolved: boolean;
} | null> {
  const { validationRegistry } = await getSepoliaAddresses();
  if (validationRegistry === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  const client = sepoliaPublicClient();
  try {
    const v = (await client.readContract({
      address: validationRegistry,
      abi: VAL_ABI,
      functionName: "requests",
      args: [jobId],
    })) as readonly [bigint, Hex, Address, string, bigint, bigint, boolean];
    return { agentId: v[0], createdAt: v[4], resolved: v[6] };
  } catch {
    return null;
  }
}

export async function readValidationResponseCount(jobId: Hex): Promise<bigint> {
  const { validationRegistry } = await getSepoliaAddresses();
  if (validationRegistry === "0x0000000000000000000000000000000000000000") {
    return 0n;
  }
  const client = sepoliaPublicClient();
  try {
    return (await client.readContract({
      address: validationRegistry,
      abi: VAL_ABI,
      functionName: "responseCount",
      args: [jobId],
    })) as bigint;
  } catch {
    return 0n;
  }
}

export async function requestValidation(args: {
  agentId: bigint;
  jobId: Hex;
  detailUri?: string;
  deadlineUnixSec: number;
  walletId: WalletId;
}): Promise<{ txHash: Hex } | null> {
  const { validationRegistry } = await getSepoliaAddresses();
  if (validationRegistry === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  const wallet = sepoliaWalletClient(args.walletId);
  const txHash = await wallet.writeContract({
    address: validationRegistry,
    abi: VAL_ABI,
    functionName: "requestValidation",
    args: [
      args.agentId,
      args.jobId,
      args.detailUri ?? "",
      BigInt(args.deadlineUnixSec),
    ],
  });
  return { txHash };
}

export async function postValidationResponse(args: {
  jobId: Hex;
  score: number;
  decimals: number;
  detailUri?: string;
  walletId: WalletId;
}): Promise<{ txHash: Hex } | null> {
  const { validationRegistry } = await getSepoliaAddresses();
  if (validationRegistry === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  const wallet = sepoliaWalletClient(args.walletId);
  const txHash = await wallet.writeContract({
    address: validationRegistry,
    abi: VAL_ABI,
    functionName: "postResponse",
    args: [args.jobId, args.score, args.decimals, args.detailUri ?? ""],
  });
  return { txHash };
}

function tagToBytes32(s: string): Hex {
  const bytes = new TextEncoder().encode(s).slice(0, 32);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return (hex.padEnd(66, "0") as Hex);
}
