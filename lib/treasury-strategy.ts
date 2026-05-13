import type { TreasuryView } from "@/lib/treasury";
import type { FundingSnapshot } from "@/lib/redis";

/// Strategy thresholds (USDC base units per asset unit per second).
///
/// OPEN: rate magnitude must exceed this to open a fresh position from flat.
/// Keep meaningfully above CLOSE to avoid flapping near the threshold.
///
/// CLOSE: once positioned, close when rate magnitude drops below this OR
/// when the sign flips against the held side.
///
/// Numbers chosen for the M1 mock exchange where setFundingRatePerSecond(278)
/// ≈ $1/hr per unit. Real Hyperliquid funding rates are orders of magnitude
/// smaller and need to be rescaled before swapping the exchange adapter.
export const OPEN_THRESHOLD = 100n;
export const CLOSE_THRESHOLD = 50n;

/// Fraction of free treasury USDC committed as collateral on a new position
/// (denominator). 2 = half. Conservative for M1.
export const COLLATERAL_DENOMINATOR = 2n;

/// Notional size in asset units (1e18 = 1 unit). For the mock at markPrice
/// 1e6 = $1/unit this puts the position notional at $1 per unit and
/// collateral covers it cleanly; doubled if collateral is larger.
const POSITION_UNIT = 10n ** 18n;

const ZERO_POSITION_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export type Action =
  | { kind: "hold"; reason: string }
  | { kind: "skip"; reason: string }
  | {
      kind: "open";
      side: "long" | "short";
      size: bigint;
      collateral: bigint;
      reason: string;
    }
  | { kind: "close"; reason: string };

export type StrategyInput = {
  treasury: TreasuryView;
  funding: FundingSnapshot | null;
};

/// Pure decision function. Given the current treasury state and the latest
/// funding snapshot, return what (if anything) the agent should do next.
///
/// Idempotent — calling decide twice in a row with the same inputs returns
/// the same Action, and re-applying the contract calls is safe (open while
/// already positioned reverts, close while flat reverts; both are guard
/// rails, not bugs).
export function decide(input: StrategyInput): Action {
  const { treasury, funding } = input;

  if (treasury.killed) {
    return { kind: "skip", reason: "treasury killed" };
  }
  if (treasury.heartbeatStale) {
    return {
      kind: "skip",
      reason: "heartbeat stale — operator should investigate before trading",
    };
  }
  if (!funding) {
    return { kind: "skip", reason: "no funding snapshot yet" };
  }

  const rate = parseRate(funding.ratePerSecond);
  const positionOpen = treasury.positionId !== ZERO_POSITION_ID;
  const isShort = positionOpen && treasury.positionSize < 0n;
  const isLong = positionOpen && treasury.positionSize > 0n;
  const absRate = rate < 0n ? -rate : rate;

  if (!positionOpen) {
    if (absRate < OPEN_THRESHOLD) {
      return {
        kind: "hold",
        reason: `flat · |rate|=${absRate} below OPEN_THRESHOLD=${OPEN_THRESHOLD}`,
      };
    }
    // Positive rate ⇒ longs pay shorts ⇒ open short.
    const side: "long" | "short" = rate > 0n ? "short" : "long";
    const free = treasury.usdcBalance;
    if (free === 0n) {
      return { kind: "hold", reason: "no free USDC to open with" };
    }
    const collateral = free / COLLATERAL_DENOMINATOR;
    if (collateral === 0n) {
      return { kind: "hold", reason: "free balance too small to fund half" };
    }
    const sizedSize = side === "short" ? -POSITION_UNIT : POSITION_UNIT;
    return {
      kind: "open",
      side,
      size: sizedSize,
      collateral,
      reason: `flat · rate=${rate} crosses OPEN_THRESHOLD · ${side}`,
    };
  }

  // Currently positioned. Close if rate flipped against the held side or
  // dropped below CLOSE_THRESHOLD.
  const heldSignAligned = isShort ? rate > 0n : isLong && rate < 0n;
  if (!heldSignAligned) {
    return {
      kind: "close",
      reason: `rate=${rate} flipped against ${isShort ? "short" : "long"}`,
    };
  }
  if (absRate < CLOSE_THRESHOLD) {
    return {
      kind: "close",
      reason: `|rate|=${absRate} below CLOSE_THRESHOLD=${CLOSE_THRESHOLD}`,
    };
  }
  return {
    kind: "hold",
    reason: `${isShort ? "short" : "long"} · rate=${rate} aligned · holding`,
  };
}

function parseRate(s: string): bigint {
  try {
    return BigInt(s);
  } catch {
    // A poisoned funding snapshot (non-numeric string from the
    // funding-poll workflow) must not silently collapse to 0 — it would
    // masquerade as "rate below threshold" and look like normal holds.
    console.warn(
      `[treasury-strategy] parseRate failed for ${JSON.stringify(s)}; falling back to 0`,
    );
    return 0n;
  }
}
