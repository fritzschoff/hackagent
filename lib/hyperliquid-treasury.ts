import { type Address, type Hex } from "viem";
import {
  hyperEvmPublicClient,
  hyperEvmWalletClient,
} from "@/lib/wallets";
import HyperliquidTreasuryAbi from "@/lib/abis/HyperliquidTreasury.json";

/**
 * Off-chain wrapper for the HyperliquidTreasury contract on HyperEVM.
 * Mirrors lib/treasury.ts but for the HL-native treasury — readState +
 * the agent-only write helpers. Address is read from
 * HYPERLIQUID_TREASURY_ADDRESS env (env, not Edge Config, because the
 * contract is single-deploy and Vercel env propagates fast enough for
 * iteration).
 */

const ABI = HyperliquidTreasuryAbi as readonly unknown[];

function treasuryAddress(): Address | null {
  const raw = process.env.HYPERLIQUID_TREASURY_ADDRESS;
  if (!raw || !/^0x[a-fA-F0-9]{40}$/.test(raw)) return null;
  return raw as Address;
}

export type HlPosition = {
  szi: bigint;
  entryNtl: bigint;
  isolatedRawUsd: bigint;
  leverage: number;
  isIsolated: boolean;
};

export type HlMarginSummary = {
  accountValue: bigint;
  marginUsed: bigint;
  ntlPos: bigint;
  rawUsd: bigint;
};

export type HlTreasuryView = {
  address: Address;
  agent: Address;
  owner: Address;
  asset: number;
  usdcBalance: bigint;
  lastHeartbeat: bigint;
  heartbeatTimeout: bigint;
  heartbeatStale: boolean;
  killed: boolean;
  oraclePx: bigint;
  markPx: bigint;
  hlPosition: HlPosition;
  marginSummary: HlMarginSummary;
};

/// Read a flat snapshot of the contract state plus the on-chain L1Read
/// passthroughs. Returns null if the treasury env isn't configured.
/// Wraps individual reads in try/catch so a transient HyperEVM RPC hiccup
/// degrades to partial state rather than tripping the caller.
export async function readHlTreasury(): Promise<HlTreasuryView | null> {
  const address = treasuryAddress();
  if (!address) return null;
  const client = hyperEvmPublicClient();

  try {
    const [
      agent,
      owner,
      asset,
      lastHeartbeat,
      heartbeatTimeout,
      heartbeatStale,
      killed,
      usdcAddr,
    ] = (await Promise.all([
      client.readContract({ address, abi: ABI, functionName: "agent" }),
      client.readContract({ address, abi: ABI, functionName: "owner" }),
      client.readContract({ address, abi: ABI, functionName: "asset" }),
      client.readContract({
        address,
        abi: ABI,
        functionName: "lastHeartbeat",
      }),
      client.readContract({
        address,
        abi: ABI,
        functionName: "heartbeatTimeout",
      }),
      client.readContract({
        address,
        abi: ABI,
        functionName: "heartbeatStale",
      }),
      client.readContract({ address, abi: ABI, functionName: "killed" }),
      client.readContract({ address, abi: ABI, functionName: "USDC" }),
    ])) as [Address, Address, number, bigint, bigint, boolean, boolean, Address];

    const [usdcBalance, oraclePx, markPx, hlPositionRaw, marginRaw] =
      (await Promise.all([
        client.readContract({
          address: usdcAddr,
          abi: [
            {
              type: "function",
              name: "balanceOf",
              stateMutability: "view",
              inputs: [{ name: "owner", type: "address" }],
              outputs: [{ name: "", type: "uint256" }],
            },
          ],
          functionName: "balanceOf",
          args: [address],
        }),
        client
          .readContract({ address, abi: ABI, functionName: "oraclePx" })
          .catch(() => 0n),
        client
          .readContract({ address, abi: ABI, functionName: "markPx" })
          .catch(() => 0n),
        client
          .readContract({ address, abi: ABI, functionName: "hlPosition" })
          .catch(() => zeroPosition()),
        client
          .readContract({ address, abi: ABI, functionName: "marginSummary" })
          .catch(() => zeroMargin()),
      ])) as [bigint, bigint, bigint, HlPosition, HlMarginSummary];

    return {
      address,
      agent,
      owner,
      asset,
      usdcBalance,
      lastHeartbeat,
      heartbeatTimeout,
      heartbeatStale,
      killed,
      oraclePx,
      markPx,
      hlPosition: hlPositionRaw,
      marginSummary: marginRaw,
    };
  } catch (err) {
    console.error(
      "[hl-treasury] read failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function zeroPosition(): HlPosition {
  return {
    szi: 0n,
    entryNtl: 0n,
    isolatedRawUsd: 0n,
    leverage: 0,
    isIsolated: false,
  };
}

function zeroMargin(): HlMarginSummary {
  return { accountValue: 0n, marginUsed: 0n, ntlPos: 0n, rawUsd: 0n };
}

// ─── writes (agent-only) ──────────────────────────────────────────────────

async function write(
  fn: string,
  args: readonly unknown[],
): Promise<Hex> {
  const address = treasuryAddress();
  if (!address) throw new Error("HYPERLIQUID_TREASURY_ADDRESS missing");
  const wallet = hyperEvmWalletClient("agent");
  return wallet.writeContract({ address, abi: ABI, functionName: fn, args });
}

export function pingHeartbeat(): Promise<Hex> {
  return write("heartbeat", []);
}

export function depositToSpot(amount: bigint): Promise<Hex> {
  return write("depositToSpot", [amount]);
}

export function moveToPerp(amount: bigint): Promise<Hex> {
  return write("moveToPerp", [amount]);
}

export function moveToSpot(amount: bigint): Promise<Hex> {
  return write("moveToSpot", [amount]);
}

export function openPosition(args: {
  isBuy: boolean;
  limitPx: bigint;
  size: bigint;
  tif: number; // 1=Alo, 2=Gtc, 3=Ioc
}): Promise<Hex> {
  return write("openPosition", [
    args.isBuy,
    args.limitPx,
    args.size,
    args.tif,
  ]);
}

export function closePosition(limitPx: bigint): Promise<Hex> {
  return write("closePosition", [limitPx]);
}

export function distributeRevenue(amount: bigint): Promise<Hex> {
  return write("distributeRevenue", [amount]);
}
