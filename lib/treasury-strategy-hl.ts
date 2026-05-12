import type { HlTreasuryView } from "@/lib/hyperliquid-treasury";

/// HL funding rates are quoted per hour. Defaults below are tuned for
/// the M2 testnet stub where the rate is whatever HL reports for ETH
/// — at the time of writing that floated around 1.4e-4/hr (~120% APY
/// compounded). Mainnet rates are typically 1–2 orders of magnitude
/// smaller; thresholds will need to drop along with that in M3.
///
/// Values are floats (number) because HL exposes them as decimal
/// strings via REST and as scaled uint64 via the precompile — we
/// pre-convert at the read layer.
export const OPEN_THRESHOLD_HOURLY = 5e-5; // ~44% APY
export const CLOSE_THRESHOLD_HOURLY = 2.5e-5; // ~22% APY

/// Default position size when opening — in HL wire units (10^szDecimals
/// per asset unit). For ETH testnet (szDecimals=4 at time of writing)
/// 100 = 0.01 ETH. Override via env HL_OPEN_SIZE for M2 tuning.
const DEFAULT_OPEN_SIZE: bigint = 100n;

/// Slippage allowed on IOC limit price, in bps of mark.
const SLIPPAGE_BPS = 50n;

const ZERO_POSITION_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const TIF_IOC = 3;

export type HlAction =
  | { kind: "hold"; reason: string }
  | { kind: "skip"; reason: string }
  | {
      kind: "open";
      side: "long" | "short";
      isBuy: boolean;
      size: bigint;
      limitPx: bigint;
      tif: number;
      reason: string;
    }
  | { kind: "close"; limitPx: bigint; reason: string };

export type HlStrategyInput = {
  treasury: HlTreasuryView;
  /// Funding rate per hour as a float. Caller pulls this from HL's
  /// metaAndAssetCtxs REST endpoint (see lib/hyperliquid.ts).
  fundingHourly: number | null;
};

/// Pure decision function for the HL-native strategy. Same shape as
/// treasury-strategy.decide but parameterised for HL primitives:
/// account-level margin, asset-indexed position, hourly funding.
export function decide(input: HlStrategyInput): HlAction {
  const { treasury, fundingHourly } = input;

  if (treasury.killed) {
    return { kind: "skip", reason: "treasury killed" };
  }
  if (treasury.heartbeatStale) {
    return {
      kind: "skip",
      reason: "heartbeat stale — operator should investigate",
    };
  }
  if (fundingHourly === null || Number.isNaN(fundingHourly)) {
    return { kind: "skip", reason: "no funding rate" };
  }
  if (treasury.markPx === 0n) {
    return { kind: "skip", reason: "no mark price from precompile" };
  }

  const absFunding = Math.abs(fundingHourly);
  const synthPositionOpen = treasury.positionId !== ZERO_POSITION_ID;
  const hlSize = treasury.hlPosition.szi;
  const isShort = hlSize < 0n;
  const isLong = hlSize > 0n;

  if (!synthPositionOpen && hlSize === 0n) {
    if (absFunding < OPEN_THRESHOLD_HOURLY) {
      return {
        kind: "hold",
        reason: `flat · |funding|=${fundingHourly} below OPEN_THRESHOLD=${OPEN_THRESHOLD_HOURLY}`,
      };
    }
    // Positive funding ⇒ longs pay shorts ⇒ open short.
    const isBuy = fundingHourly < 0;
    const side: "long" | "short" = isBuy ? "long" : "short";
    const size = parseEnvBigInt("HL_OPEN_SIZE", DEFAULT_OPEN_SIZE);
    const limitPx = applySlippage(treasury.markPx, isBuy);
    return {
      kind: "open",
      side,
      isBuy,
      size,
      limitPx,
      tif: TIF_IOC,
      reason: `flat · funding=${fundingHourly} crosses OPEN_THRESHOLD · ${side}`,
    };
  }

  // We expect synthetic state to match HL state. If they diverge
  // (synthetic open but HL flat, or vice versa), prefer HL — close
  // synthetically by returning a "close" so the cron can sync.
  if (synthPositionOpen && hlSize === 0n) {
    return {
      kind: "skip",
      reason:
        "synthetic open but HL flat — operator should sync state before next tick",
    };
  }

  const heldSignAligned = isShort
    ? fundingHourly > 0
    : isLong && fundingHourly < 0;
  if (!heldSignAligned) {
    const closeIsBuy = isShort; // buy to close short
    const limitPx = applySlippage(treasury.markPx, closeIsBuy);
    return {
      kind: "close",
      limitPx,
      reason: `funding=${fundingHourly} flipped against ${isShort ? "short" : "long"}`,
    };
  }
  if (absFunding < CLOSE_THRESHOLD_HOURLY) {
    const closeIsBuy = isShort;
    const limitPx = applySlippage(treasury.markPx, closeIsBuy);
    return {
      kind: "close",
      limitPx,
      reason: `|funding|=${fundingHourly} below CLOSE_THRESHOLD=${CLOSE_THRESHOLD_HOURLY}`,
    };
  }
  return {
    kind: "hold",
    reason: `${isShort ? "short" : "long"} · funding=${fundingHourly} aligned`,
  };
}

function applySlippage(markPx: bigint, isBuy: boolean): bigint {
  const delta = (markPx * SLIPPAGE_BPS) / 10_000n;
  return isBuy ? markPx + delta : markPx - delta;
}

function parseEnvBigInt(envName: string, fallback: bigint): bigint {
  const raw = process.env[envName];
  if (!raw) return fallback;
  try {
    return BigInt(raw);
  } catch {
    return fallback;
  }
}
