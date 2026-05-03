import { type Address, type Hex, type AbiEvent } from "viem";
import { sepoliaPublicClient } from "@/lib/wallets";
import { getLogsChunked } from "@/lib/log-chunks";
import ReputationCreditAbi from "@/lib/abis/ReputationCredit.json";

const ABI = ReputationCreditAbi as readonly unknown[];

const BORROWED = (ABI as AbiEvent[]).find(
  (e) => e.type === "event" && e.name === "Borrowed",
) as AbiEvent;
const REPAID = (ABI as AbiEvent[]).find(
  (e) => e.type === "event" && e.name === "Repaid",
) as AbiEvent;
const LIQUIDATED = (ABI as AbiEvent[]).find(
  (e) => e.type === "event" && e.name === "Liquidated",
) as AbiEvent;

const SEPOLIA_DEPLOY_BLOCK_DEFAULT = 6_000_000n;

export type CreditView = {
  totalAssets: bigint;
  totalLent: bigint;
  totalShares: bigint;
  freeLiquidity: bigint;
  navPerShare: bigint;
  agentLoan: {
    principal: bigint;
    borrowedAt: bigint;
    borrowedAtFeedback: bigint;
    defaulted: boolean;
  } | null;
  agentCreditLimit: bigint;
  agentCurrentFeedback: bigint;
  isLiquidatable: boolean;
};

export type CreditEvent =
  | {
      kind: "borrowed";
      agentId: bigint;
      agentAddress: Address;
      amount: bigint;
      feedbackAtBorrow: bigint;
      txHash: Hex;
      blockNumber: bigint;
    }
  | {
      kind: "repaid";
      agentId: bigint;
      payer: Address;
      amount: bigint;
      txHash: Hex;
      blockNumber: bigint;
    }
  | {
      kind: "liquidated";
      agentId: bigint;
      outstanding: bigint;
      currentFeedback: bigint;
      borrowedAtFeedback: bigint;
      txHash: Hex;
      blockNumber: bigint;
    };

export async function readCreditPool(args: {
  creditAddress: Address;
  agentId: bigint;
  reputationRegistry: Address;
  usdcAddress: Address;
}): Promise<CreditView | null> {
  const client = sepoliaPublicClient();
  try {
    const [totalAssets, totalLent, totalShares, free, loan, limit, fb] =
      await Promise.all([
        client.readContract({
          address: args.creditAddress,
          abi: ABI,
          functionName: "totalAssets",
        }) as Promise<bigint>,
        client.readContract({
          address: args.creditAddress,
          abi: ABI,
          functionName: "totalLent",
        }) as Promise<bigint>,
        client.readContract({
          address: args.creditAddress,
          abi: ABI,
          functionName: "totalShares",
        }) as Promise<bigint>,
        client.readContract({
          address: args.usdcAddress,
          abi: [
            {
              type: "function",
              name: "balanceOf",
              stateMutability: "view",
              inputs: [{ name: "owner", type: "address" }],
              outputs: [{ name: "", type: "uint256" }],
            },
          ] as const,
          functionName: "balanceOf",
          args: [args.creditAddress],
        }) as Promise<bigint>,
        client.readContract({
          address: args.creditAddress,
          abi: ABI,
          functionName: "loans",
          args: [args.agentId],
        }) as Promise<readonly [bigint, bigint, bigint, boolean]>,
        client.readContract({
          address: args.creditAddress,
          abi: ABI,
          functionName: "creditLimit",
          args: [args.agentId],
        }) as Promise<bigint>,
        client.readContract({
          address: args.reputationRegistry,
          abi: [
            {
              type: "function",
              name: "feedbackCount",
              stateMutability: "view",
              inputs: [{ name: "agentId", type: "uint256" }],
              outputs: [{ name: "", type: "uint256" }],
            },
          ] as const,
          functionName: "feedbackCount",
          args: [args.agentId],
        }) as Promise<bigint>,
      ]);

    const [liquidatable] = (await client.readContract({
      address: args.creditAddress,
      abi: ABI,
      functionName: "isLiquidatable",
      args: [args.agentId],
    })) as readonly [boolean, bigint];

    const principal = loan[0];
    const navPerShare =
      totalShares === 0n
        ? 0n
        : (totalAssets * 1_000_000n) / totalShares;

    return {
      totalAssets,
      totalLent,
      totalShares,
      freeLiquidity: free,
      navPerShare,
      agentLoan:
        principal === 0n
          ? null
          : {
              principal,
              borrowedAt: loan[1],
              borrowedAtFeedback: loan[2],
              defaulted: loan[3],
            },
      agentCreditLimit: limit,
      agentCurrentFeedback: fb,
      isLiquidatable: liquidatable,
    };
  } catch (err) {
    console.error(
      "[credit] readCreditPool failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function readCreditHistory(args: {
  creditAddress: Address;
  agentId: bigint;
  limit?: number;
}): Promise<CreditEvent[]> {
  const client = sepoliaPublicClient();
  const tip = await client.getBlockNumber();
  const fromBlock =
    tip > SEPOLIA_DEPLOY_BLOCK_DEFAULT
      ? tip - 100_000n
      : SEPOLIA_DEPLOY_BLOCK_DEFAULT;

  const [borrowedLogs, repaidLogs, liqLogs] = await Promise.all([
    getLogsChunked(client, {
      label: "credit",
      address: args.creditAddress,
      event: BORROWED,
      eventArgs: { agentId: args.agentId },
      fromBlock,
      toBlock: tip,
    }),
    getLogsChunked(client, {
      label: "credit",
      address: args.creditAddress,
      event: REPAID,
      eventArgs: { agentId: args.agentId },
      fromBlock,
      toBlock: tip,
    }),
    getLogsChunked(client, {
      label: "credit",
      address: args.creditAddress,
      event: LIQUIDATED,
      eventArgs: { agentId: args.agentId },
      fromBlock,
      toBlock: tip,
    }),
  ]);

  const events: CreditEvent[] = [];
  for (const log of borrowedLogs) {
    const a = log.args as {
      agentId: bigint;
      agentAddress: Address;
      amount: bigint;
      feedbackAtBorrow: bigint;
    };
    events.push({
      kind: "borrowed",
      agentId: a.agentId,
      agentAddress: a.agentAddress,
      amount: a.amount,
      feedbackAtBorrow: a.feedbackAtBorrow,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    });
  }
  for (const log of repaidLogs) {
    const a = log.args as { agentId: bigint; payer: Address; amount: bigint };
    events.push({
      kind: "repaid",
      agentId: a.agentId,
      payer: a.payer,
      amount: a.amount,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    });
  }
  for (const log of liqLogs) {
    const a = log.args as {
      agentId: bigint;
      outstanding: bigint;
      currentFeedback: bigint;
      borrowedAtFeedback: bigint;
    };
    events.push({
      kind: "liquidated",
      agentId: a.agentId,
      outstanding: a.outstanding,
      currentFeedback: a.currentFeedback,
      borrowedAtFeedback: a.borrowedAtFeedback,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    });
  }
  events.sort((a, b) => Number(b.blockNumber - a.blockNumber));
  return events.slice(0, args.limit ?? 20);
}

export function formatUsdc(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const frac = (amount % 1_000_000n).toString().padStart(6, "0").slice(0, 4);
  return `$${whole}.${frac}`;
}
