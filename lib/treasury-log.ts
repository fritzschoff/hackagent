import type { Hex } from "viem";
import { writeState } from "@/lib/zg-storage";
import { getRedis } from "@/lib/redis";

/// Append-only audit record for every treasury state transition.
/// One record per successful contract write (open / close / distribute /
/// emergencyExit). Captures both on-chain (txHash) and off-chain
/// (decision reasoning, funding snapshot at decision time) context so
/// shareholders can reconstruct *why* the agent did what it did, not just
/// what.
export type TradeLogEntry = {
  ts: number;
  action: "open" | "close" | "distribute" | "emergencyExit" | "heartbeat";
  txHash: string;
  reason: string;
  /// Pre-action treasury snapshot, minimal subset.
  preState?: {
    usdcBalance: string;
    positionSize: string;
    positionCollateral: string;
  };
  /// Funding rate (USDC base units per asset unit per second) at the
  /// moment of decision, if available.
  fundingRatePerSecond?: string;
  /// Open action only.
  size?: string;
  collateral?: string;
  side?: "long" | "short";
  /// Distribute action only.
  amount?: string;
};

/// Pushed alongside the 0G root so the dashboard can render history
/// without doing on-chain reads. The 0G root is the tamper-evident
/// reference for anyone who wants to audit independently.
export type PersistedTradeLogEntry = TradeLogEntry & {
  zgRoot: string | null;
  zgTxHash: string | null;
  zgAnchored: boolean;
};

const REDIS_KEY = "treasury:trade-log";

/// Write `entry` to 0G (best-effort) and stash the result in Redis for
/// dashboard reads. Returns the persisted entry so callers can also
/// surface the 0G root/tx in their own response if useful.
export async function appendTradeLog(
  entry: TradeLogEntry,
): Promise<PersistedTradeLogEntry> {
  let zgRoot: string | null = null;
  let zgTxHash: string | null = null;
  let zgAnchored = false;
  try {
    const res = await writeState("treasury:trade-log", entry);
    if (res) {
      zgRoot = res.rootHash;
      zgTxHash = res.txHash || null;
      zgAnchored = res.anchored;
    }
  } catch (err) {
    console.error(
      "[treasury-log] zg write failed:",
      err instanceof Error ? err.message : err,
    );
  }

  const persisted: PersistedTradeLogEntry = {
    ...entry,
    zgRoot,
    zgTxHash,
    zgAnchored,
  };

  const r = getRedis();
  if (r) {
    await r.lpush(REDIS_KEY, JSON.stringify(persisted));
    await r.ltrim(REDIS_KEY, 0, 99);
  }

  return persisted;
}

export async function getRecentTradeLog(
  limit = 20,
): Promise<PersistedTradeLogEntry[]> {
  const r = getRedis();
  if (!r) return [];
  const raw = await r.lrange(REDIS_KEY, 0, limit - 1);
  return raw
    .map((s) => {
      try {
        return JSON.parse(s) as PersistedTradeLogEntry;
      } catch {
        return null;
      }
    })
    .filter((x): x is PersistedTradeLogEntry => x !== null);
}

/// Minimal helper for callers that already have a txHash from a contract
/// write — packages the entry, snapshot, and reasoning into the standard
/// shape.
export function buildOpenEntry(args: {
  txHash: Hex;
  reason: string;
  side: "long" | "short";
  size: bigint;
  collateral: bigint;
  fundingRatePerSecond?: string;
  preState: TradeLogEntry["preState"];
}): TradeLogEntry {
  return {
    ts: Date.now(),
    action: "open",
    txHash: args.txHash,
    reason: args.reason,
    preState: args.preState,
    fundingRatePerSecond: args.fundingRatePerSecond,
    size: args.size.toString(),
    collateral: args.collateral.toString(),
    side: args.side,
  };
}

export function buildCloseEntry(args: {
  txHash: Hex;
  reason: string;
  fundingRatePerSecond?: string;
  preState: TradeLogEntry["preState"];
}): TradeLogEntry {
  return {
    ts: Date.now(),
    action: "close",
    txHash: args.txHash,
    reason: args.reason,
    preState: args.preState,
    fundingRatePerSecond: args.fundingRatePerSecond,
  };
}

export function buildDistributeEntry(args: {
  txHash: Hex;
  amount: bigint;
  preState: TradeLogEntry["preState"];
}): TradeLogEntry {
  return {
    ts: Date.now(),
    action: "distribute",
    txHash: args.txHash,
    reason: `weekly dividend → splitter`,
    preState: args.preState,
    amount: args.amount.toString(),
  };
}
