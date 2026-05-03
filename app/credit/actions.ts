"use server";

import { parseUnits, formatUnits } from "viem";
import { getSepoliaAddresses } from "@/lib/edge-config";
import {
  sepoliaPublicClient,
  sepoliaWalletClient,
  tryLoadAccount,
} from "@/lib/wallets";
import { revalidatePath } from "next/cache";
import ReputationCreditAbi from "@/lib/abis/ReputationCredit.json";

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const MAX_UINT256 = (1n << 256n) - 1n;

export type ActionResult = { ok: true; txHash: `0x${string}` } | { ok: false; error: string };

/// Server-side helper: have the agent's own EOA call borrow(agentId, amount).
/// Used by the demo button on /credit so users don't need to import the
/// agent's private key into MetaMask. In production this would be triggered
/// by the agent's autonomous runtime when it decides to draw credit.
export async function agentBorrow(amountUsdc: string): Promise<ActionResult> {
  const account = tryLoadAccount("agent");
  if (!account) return { ok: false, error: "AGENT_PK not configured" };
  const addresses = await getSepoliaAddresses();
  if (!addresses.reputationCreditAddress) {
    return { ok: false, error: "reputationCreditAddress not in edge config" };
  }
  if (addresses.agentId === 0) {
    return { ok: false, error: "agentId is 0 — agent not registered" };
  }
  let amount: bigint;
  try {
    amount = parseUnits(amountUsdc, 6);
  } catch {
    return { ok: false, error: `invalid amount: ${amountUsdc}` };
  }
  if (amount === 0n) return { ok: false, error: "amount must be > 0" };

  const wc = sepoliaWalletClient("agent");
  const pc = sepoliaPublicClient();
  try {
    const tx = await wc.writeContract({
      address: addresses.reputationCreditAddress,
      abi: ReputationCreditAbi,
      functionName: "borrow",
      args: [BigInt(addresses.agentId), amount],
    });
    await pc.waitForTransactionReceipt({ hash: tx, confirmations: 1 });
    revalidatePath("/credit");
    return { ok: true, txHash: tx };
  } catch (err) {
    return {
      ok: false,
      error:
        err && typeof err === "object" && "shortMessage" in err
          ? String((err as { shortMessage: unknown }).shortMessage)
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
}

/// Server-side helper: have the agent repay its own loan in USDC. Approves
/// USDC to the credit contract first if allowance is short.
export async function agentRepay(amountUsdc: string): Promise<ActionResult> {
  const account = tryLoadAccount("agent");
  if (!account) return { ok: false, error: "AGENT_PK not configured" };
  const addresses = await getSepoliaAddresses();
  if (!addresses.reputationCreditAddress || !addresses.sepoliaUsdcAddress) {
    return { ok: false, error: "credit/usdc address not in edge config" };
  }
  let amount: bigint;
  try {
    amount = parseUnits(amountUsdc, 6);
  } catch {
    return { ok: false, error: `invalid amount: ${amountUsdc}` };
  }
  if (amount === 0n) return { ok: false, error: "amount must be > 0" };

  const wc = sepoliaWalletClient("agent");
  const pc = sepoliaPublicClient();

  try {
    const allowance = (await pc.readContract({
      address: addresses.sepoliaUsdcAddress,
      abi: ERC20_APPROVE_ABI,
      functionName: "allowance",
      args: [account.address, addresses.reputationCreditAddress],
    })) as bigint;
    if (allowance < amount) {
      const approveTx = await wc.writeContract({
        address: addresses.sepoliaUsdcAddress,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [addresses.reputationCreditAddress, MAX_UINT256],
      });
      await pc.waitForTransactionReceipt({ hash: approveTx, confirmations: 1 });
    }
    const tx = await wc.writeContract({
      address: addresses.reputationCreditAddress,
      abi: ReputationCreditAbi,
      functionName: "repay",
      args: [BigInt(addresses.agentId), amount],
    });
    await pc.waitForTransactionReceipt({ hash: tx, confirmations: 1 });
    revalidatePath("/credit");
    return { ok: true, txHash: tx };
  } catch (err) {
    return {
      ok: false,
      error:
        err && typeof err === "object" && "shortMessage" in err
          ? String((err as { shortMessage: unknown }).shortMessage)
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
}

/// Read-only helper for the UI to display formatted limits.
export async function readAgentBorrowable(): Promise<{
  agentAddress: `0x${string}` | null;
  creditLimitUsdc: string;
  outstandingUsdc: string;
}> {
  const addresses = await getSepoliaAddresses();
  if (!addresses.reputationCreditAddress || addresses.agentId === 0) {
    return { agentAddress: null, creditLimitUsdc: "0", outstandingUsdc: "0" };
  }
  const pc = sepoliaPublicClient();
  try {
    const [limit, loan] = await Promise.all([
      pc.readContract({
        address: addresses.reputationCreditAddress,
        abi: ReputationCreditAbi,
        functionName: "creditLimit",
        args: [BigInt(addresses.agentId)],
      }) as Promise<bigint>,
      pc.readContract({
        address: addresses.reputationCreditAddress,
        abi: ReputationCreditAbi,
        functionName: "loans",
        args: [BigInt(addresses.agentId)],
      }) as Promise<readonly [bigint, number, boolean]>,
    ]);
    return {
      agentAddress: addresses.agentEOA,
      creditLimitUsdc: formatUnits(limit, 6),
      outstandingUsdc: formatUnits(loan[0], 6),
    };
  } catch {
    return { agentAddress: addresses.agentEOA, creditLimitUsdc: "0", outstandingUsdc: "0" };
  }
}
