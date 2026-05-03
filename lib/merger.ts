import { type Address, type Hex, type AbiEvent } from "viem";
import { sepoliaPublicClient } from "@/lib/wallets";
import { getLogsChunked } from "@/lib/log-chunks";
import AgentMergerAbi from "@/lib/abis/AgentMerger.json";

const ABI = AgentMergerAbi as readonly unknown[];

const MERGED_EVENT = (ABI as AbiEvent[]).find(
  (e) => e.type === "event" && e.name === "AgentsMerged",
) as AbiEvent;

const SEPOLIA_DEPLOY_BLOCK_DEFAULT = 6_000_000n;

export type MergerLineage = {
  mergerIndex: bigint;
  mergedAgentId: bigint;
  sourceAgentId1: bigint;
  sourceAgentId2: bigint;
  sourceTokenId1: bigint;
  sourceTokenId2: bigint;
  sealedMemoryRoot: Hex;
  mergedAt: bigint;
  recordedBy: Address;
};

export async function readMergerCount(args: {
  mergerAddress: Address;
}): Promise<bigint> {
  const client = sepoliaPublicClient();
  try {
    return (await client.readContract({
      address: args.mergerAddress,
      abi: ABI,
      functionName: "mergerCount",
    })) as bigint;
  } catch {
    return 0n;
  }
}

export async function readMergerHistory(args: {
  mergerAddress: Address;
  limit?: number;
}): Promise<MergerLineage[]> {
  const client = sepoliaPublicClient();
  const tip = await client.getBlockNumber();
  const fromBlock =
    tip > SEPOLIA_DEPLOY_BLOCK_DEFAULT
      ? tip - 100_000n
      : SEPOLIA_DEPLOY_BLOCK_DEFAULT;

  const logs = await getLogsChunked(client, {
    label: "merger",
    address: args.mergerAddress,
    event: MERGED_EVENT,
    fromBlock,
    toBlock: tip,
  });
  type MergerArgs = {
    mergerIndex: bigint;
    mergedAgentId: bigint;
    sourceAgentId1: bigint;
    sourceAgentId2: bigint;
    sourceTokenId1: bigint;
    sourceTokenId2: bigint;
    sealedMemoryRoot: Hex;
    recordedBy: Address;
  };
  const mapped = logs.map((log) => {
    const a = log.args as unknown as MergerArgs;
    return {
      mergerIndex: a.mergerIndex,
      mergedAgentId: a.mergedAgentId,
      sourceAgentId1: a.sourceAgentId1,
      sourceAgentId2: a.sourceAgentId2,
      sourceTokenId1: a.sourceTokenId1,
      sourceTokenId2: a.sourceTokenId2,
      sealedMemoryRoot: a.sealedMemoryRoot,
      mergedAt: log.blockNumber,
      recordedBy: a.recordedBy,
    } satisfies MergerLineage;
  });
  mapped.sort((a, b) => Number(b.mergerIndex - a.mergerIndex));
  return mapped.slice(0, args.limit ?? 20);
}

export async function readEffectiveFeedback(args: {
  mergerAddress: Address;
  agentId: bigint;
}): Promise<bigint> {
  const client = sepoliaPublicClient();
  try {
    return (await client.readContract({
      address: args.mergerAddress,
      abi: ABI,
      functionName: "effectiveFeedbackCount",
      args: [args.agentId],
    })) as bigint;
  } catch {
    return 0n;
  }
}
