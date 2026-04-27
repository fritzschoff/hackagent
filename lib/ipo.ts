import { type Address, type Hex, type AbiEvent } from "viem";
import { baseSepoliaPublicClient } from "@/lib/wallets";
import AgentSharesAbi from "@/lib/abis/AgentShares.json";
import RevenueSplitterAbi from "@/lib/abis/RevenueSplitter.json";
import SharesSaleAbi from "@/lib/abis/SharesSale.json";

const SHARES_ABI = AgentSharesAbi as readonly unknown[];
const SPLITTER_ABI = RevenueSplitterAbi as readonly unknown[];
const SALE_ABI = SharesSaleAbi as readonly unknown[];

const PURCHASE_EVENT = (SALE_ABI as AbiEvent[]).find(
  (e) => e.type === "event" && e.name === "Purchase",
) as AbiEvent;
const CLAIMED_EVENT = (SPLITTER_ABI as AbiEvent[]).find(
  (e) => e.type === "event" && e.name === "Claimed",
) as AbiEvent;

const BASE_DEPLOY_BLOCK_DEFAULT = 14_000_000n;

export type IpoView = {
  shares: Address;
  splitter: Address;
  sale: Address;
  usdc: Address;
  pricePerShareUsdc: bigint;
  totalSupply: bigint;
  saleAvailable: bigint;
  splitterTotalReceived: bigint;
  splitterTotalReleased: bigint;
};

export type IpoEvent =
  | {
      kind: "purchase";
      buyer: Address;
      sharesAmount: bigint;
      usdcPaid: bigint;
      txHash: Hex;
      blockNumber: bigint;
    }
  | {
      kind: "claim";
      holder: Address;
      amount: bigint;
      txHash: Hex;
      blockNumber: bigint;
    };

export async function readIpo(args: {
  shares: Address;
  splitter: Address;
  sale: Address;
  usdc: Address;
}): Promise<IpoView | null> {
  const client = baseSepoliaPublicClient();
  try {
    const [
      totalSupply,
      saleAvailable,
      pricePerShareUsdc,
      splitterReceived,
      splitterReleased,
    ] = await Promise.all([
      client.readContract({
        address: args.shares,
        abi: SHARES_ABI,
        functionName: "totalSupply",
      }) as Promise<bigint>,
      client.readContract({
        address: args.sale,
        abi: SALE_ABI,
        functionName: "sharesAvailable",
      }) as Promise<bigint>,
      client.readContract({
        address: args.sale,
        abi: SALE_ABI,
        functionName: "pricePerShareUsdc",
      }) as Promise<bigint>,
      client.readContract({
        address: args.splitter,
        abi: SPLITTER_ABI,
        functionName: "totalReceived",
      }) as Promise<bigint>,
      client.readContract({
        address: args.splitter,
        abi: SPLITTER_ABI,
        functionName: "totalReleased",
      }) as Promise<bigint>,
    ]);

    return {
      shares: args.shares,
      splitter: args.splitter,
      sale: args.sale,
      usdc: args.usdc,
      pricePerShareUsdc,
      totalSupply,
      saleAvailable,
      splitterTotalReceived: splitterReceived,
      splitterTotalReleased: splitterReleased,
    };
  } catch (err) {
    console.error(
      "[ipo] readIpo failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function readIpoHistory(args: {
  splitter: Address;
  sale: Address;
  limit?: number;
}): Promise<IpoEvent[]> {
  const client = baseSepoliaPublicClient();
  const tip = await client.getBlockNumber();
  const fromBlock =
    tip > BASE_DEPLOY_BLOCK_DEFAULT
      ? tip - 100_000n
      : BASE_DEPLOY_BLOCK_DEFAULT;

  try {
    const [purchaseLogs, claimLogs] = await Promise.all([
      client.getLogs({
        address: args.sale,
        event: PURCHASE_EVENT,
        fromBlock,
        toBlock: tip,
      }),
      client.getLogs({
        address: args.splitter,
        event: CLAIMED_EVENT,
        fromBlock,
        toBlock: tip,
      }),
    ]);

    const events: IpoEvent[] = [];
    for (const log of purchaseLogs) {
      const a = log.args as unknown as {
        buyer: Address;
        sharesAmount: bigint;
        usdcPaid: bigint;
      };
      events.push({
        kind: "purchase",
        buyer: a.buyer,
        sharesAmount: a.sharesAmount,
        usdcPaid: a.usdcPaid,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      });
    }
    for (const log of claimLogs) {
      const a = log.args as unknown as { holder: Address; amount: bigint };
      events.push({
        kind: "claim",
        holder: a.holder,
        amount: a.amount,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      });
    }
    events.sort((a, b) => Number(b.blockNumber - a.blockNumber));
    return events.slice(0, args.limit ?? 20);
  } catch (err) {
    console.error(
      "[ipo] readIpoHistory failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export function formatShares(amount: bigint): string {
  const whole = amount / 10n ** 18n;
  return whole.toString();
}

export function formatUsdc(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const frac = (amount % 1_000_000n).toString().padStart(6, "0").slice(0, 4);
  return `$${whole}.${frac}`;
}
