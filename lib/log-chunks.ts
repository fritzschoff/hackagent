import type { AbiEvent, Address, Hex } from "viem";

/// Public Sepolia + Base Sepolia RPCs cap eth_getLogs at 50k blocks per call
/// (publicnode), or much smaller on free Alchemy plans. Chunk every range
/// query into windows safely under the lower cap so the dashboard surfaces
/// real history instead of swallowing the RPC error.
export const LOG_CHUNK_BLOCKS = 49_000n;

/// Mined-log shape with non-null tx hash + block number — what callers need.
/// We narrow viem's nullable types here because we only feed mined logs in.
export type MinedLog = {
  args: Record<string, unknown>;
  transactionHash: Hex;
  blockNumber: bigint;
};

type GetLogsClient = {
  getLogs(args: {
    address: Address;
    event: AbiEvent;
    args?: Record<string, unknown>;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<unknown>;
};

export async function getLogsChunked(
  client: GetLogsClient,
  args: {
    label: string;
    address: Address;
    event: AbiEvent;
    eventArgs?: Record<string, unknown>;
    fromBlock: bigint;
    toBlock: bigint;
    chunk?: bigint;
  },
): Promise<MinedLog[]> {
  const chunk = args.chunk ?? LOG_CHUNK_BLOCKS;
  const out: MinedLog[] = [];
  let from = args.fromBlock;
  while (from <= args.toBlock) {
    const to =
      from + chunk - 1n > args.toBlock ? args.toBlock : from + chunk - 1n;
    try {
      const logs = (await client.getLogs({
        address: args.address,
        event: args.event,
        args: args.eventArgs,
        fromBlock: from,
        toBlock: to,
      })) as MinedLog[];
      out.push(...logs);
    } catch (e) {
      console.error(
        `[${args.label}] getLogs ${args.event.name} ${from}..${to} failed:`,
        (e as Error).message,
      );
    }
    from = to + 1n;
  }
  return out;
}
