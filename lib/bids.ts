import { type Address, type Hex, type AbiEvent } from "viem";
import { sepoliaPublicClient } from "@/lib/wallets";
import AgentBidsAbi from "@/lib/abis/AgentBids.json";

const ABI = AgentBidsAbi as readonly unknown[];

const BID_PLACED = (ABI as AbiEvent[]).find(
  (e) => e.type === "event" && e.name === "BidPlaced",
) as AbiEvent;
const BID_WITHDRAWN = (ABI as AbiEvent[]).find(
  (e) => e.type === "event" && e.name === "BidWithdrawn",
) as AbiEvent;
const BID_ACCEPTED = (ABI as AbiEvent[]).find(
  (e) => e.type === "event" && e.name === "BidAccepted",
) as AbiEvent;

const SEPOLIA_DEPLOY_BLOCK_DEFAULT = 6_000_000n;
const LOG_CHUNK_BLOCKS = 49_000n;

type MinedLog = {
  args: Record<string, unknown>;
  transactionHash: Hex;
  blockNumber: bigint;
};

async function getLogsChunked(
  client: ReturnType<typeof sepoliaPublicClient>,
  args: {
    address: Address;
    event: AbiEvent;
    eventArgs?: Record<string, unknown>;
    fromBlock: bigint;
    toBlock: bigint;
  },
): Promise<MinedLog[]> {
  const out: MinedLog[] = [];
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
        args: args.eventArgs,
        fromBlock: from,
        toBlock: to,
      });
      out.push(...(logs as unknown as MinedLog[]));
    } catch (e) {
      console.error(
        `[bids] getLogs ${args.event.name} ${from}..${to} failed:`,
        (e as Error).message,
      );
    }
    from = to + 1n;
  }
  return out;
}

export type StandingBid = {
  bidder: Address;
  amount: bigint;
  createdAt: bigint;
  active: boolean;
};

export type BidEvent =
  | {
      kind: "placed";
      bidder: Address;
      amount: bigint;
      txHash: Hex;
      blockNumber: bigint;
    }
  | {
      kind: "withdrawn";
      bidder: Address;
      amount: bigint;
      txHash: Hex;
      blockNumber: bigint;
    }
  | {
      kind: "accepted";
      seller: Address;
      bidder: Address;
      amount: bigint;
      txHash: Hex;
      blockNumber: bigint;
    };

export async function readStandingBids(args: {
  bidsAddress: Address;
  tokenId: bigint;
}): Promise<StandingBid[]> {
  const client = sepoliaPublicClient();
  try {
    const bidders = (await client.readContract({
      address: args.bidsAddress,
      abi: ABI,
      functionName: "listBidders",
      args: [args.tokenId],
    })) as Address[];

    if (bidders.length === 0) return [];

    const standing = await Promise.all(
      bidders.map(async (b) => {
        const r = (await client.readContract({
          address: args.bidsAddress,
          abi: ABI,
          functionName: "bids",
          args: [args.tokenId, b],
        })) as readonly [Address, bigint, bigint, boolean];
        return {
          bidder: r[0],
          amount: r[1],
          createdAt: r[2],
          active: r[3],
        } satisfies StandingBid;
      }),
    );
    return standing
      .filter((b) => b.active)
      .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  } catch (err) {
    console.error(
      "[bids] readStandingBids failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export async function readBidHistory(args: {
  bidsAddress: Address;
  tokenId: bigint;
  limit?: number;
}): Promise<BidEvent[]> {
  const client = sepoliaPublicClient();
  const tip = await client.getBlockNumber();
  const fromBlock =
    tip > SEPOLIA_DEPLOY_BLOCK_DEFAULT
      ? tip - 100_000n
      : SEPOLIA_DEPLOY_BLOCK_DEFAULT;

  try {
    const [placedLogs, withdrawnLogs, acceptedLogs] = await Promise.all([
      getLogsChunked(client, {
        address: args.bidsAddress,
        event: BID_PLACED,
        eventArgs: { tokenId: args.tokenId },
        fromBlock,
        toBlock: tip,
      }),
      getLogsChunked(client, {
        address: args.bidsAddress,
        event: BID_WITHDRAWN,
        eventArgs: { tokenId: args.tokenId },
        fromBlock,
        toBlock: tip,
      }),
      getLogsChunked(client, {
        address: args.bidsAddress,
        event: BID_ACCEPTED,
        eventArgs: { tokenId: args.tokenId },
        fromBlock,
        toBlock: tip,
      }),
    ]);

    const events: BidEvent[] = [];
    for (const log of placedLogs) {
      const a = log.args as unknown as { bidder: Address; amount: bigint };
      events.push({
        kind: "placed",
        bidder: a.bidder,
        amount: a.amount,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      });
    }
    for (const log of withdrawnLogs) {
      const a = log.args as unknown as { bidder: Address; amount: bigint };
      events.push({
        kind: "withdrawn",
        bidder: a.bidder,
        amount: a.amount,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      });
    }
    for (const log of acceptedLogs) {
      const a = log.args as unknown as {
        seller: Address;
        bidder: Address;
        amount: bigint;
      };
      events.push({
        kind: "accepted",
        seller: a.seller,
        bidder: a.bidder,
        amount: a.amount,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      });
    }
    events.sort((a, b) => Number(b.blockNumber - a.blockNumber));
    return events.slice(0, args.limit ?? 20);
  } catch (err) {
    console.error(
      "[bids] readBidHistory failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/// Format USDC amount (6 decimals) as "$X.XX"
export function formatUsdc(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const frac = (amount % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `$${whole}.${frac}`;
}
