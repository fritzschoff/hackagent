import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth, unauthorized } from "@/lib/cron-auth";
import { recordCronTick, pushKeeperhubRun } from "@/lib/redis";
import {
  readHlTreasury,
  openPosition,
  closePosition,
} from "@/lib/hyperliquid-treasury";
import {
  decide,
  DEFAULT_OPEN_SIZE,
  type HlAction,
} from "@/lib/treasury-strategy-hl";
import { getFundingRate, getAssetIndex } from "@/lib/hyperliquid";
import { appendTradeLog } from "@/lib/treasury-log";

export const runtime = "nodejs";
export const maxDuration = 30;

const ROUTE = "/api/cron/treasury-strategy-hl";

/// 15-minute cron driving the HyperliquidTreasury on HyperEVM.
///
/// Reads:
///   - On-chain treasury state + L1Read passthroughs via HyperEVM RPC
///   - HL ETH funding rate via the testnet/mainnet REST API
///     (lib/hyperliquid.ts — not the funding-poll workflow, because
///     the L1Read precompile doesn't expose funding directly and a
///     parallel KH workflow for HL adds complexity we don't need yet)
///
/// Decides via the pure decide() and executes via the HyperliquidTreasury
/// contract. Idempotent at the contract level — open while open and
/// close while flat both revert.
///
/// Skips silently if HYPERLIQUID_TREASURY_ADDRESS isn't set; this lets
/// the cron ship before HyperEVM deploy without breaking other code.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();

  const treasury = await readHlTreasury();
  if (!treasury) {
    await recordCronTick(ROUTE, "ok");
    return NextResponse.json({ ok: true, skipped: "no-treasury" });
  }

  const env = (process.env.HL_ENV ?? "testnet") as "mainnet" | "testnet";
  const assetCoin = process.env.HL_ASSET_COIN ?? "ETH";

  let fundingHourly: number | null = null;
  try {
    const assetIdx = await getAssetIndex(env, assetCoin);
    if (assetIdx !== treasury.asset) {
      console.warn(
        `[strategy-hl] asset mismatch: HL ${assetCoin}=${assetIdx} vs treasury.asset=${treasury.asset}`,
      );
    }
    const f = await getFundingRate(env, assetCoin);
    fundingHourly = f.fundingHourly;
  } catch (err) {
    console.error(
      "[strategy-hl] funding fetch failed:",
      err instanceof Error ? err.message : err,
    );
  }

  const openSize = parseEnvBigInt("HL_OPEN_SIZE", DEFAULT_OPEN_SIZE);
  const action = decide({ treasury, fundingHourly, openSize });
  const ts = Date.now();
  let txHash: `0x${string}` | null = null;
  let error: string | null = null;
  let zgRoot: string | null = null;

  try {
    if (action.kind === "open") {
      txHash = await openPosition({
        isBuy: action.isBuy,
        limitPx: action.limitPx,
        size: action.size,
        tif: action.tif,
      });
    } else if (action.kind === "close") {
      txHash = await closePosition(action.limitPx);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error(`[strategy-hl] ${action.kind} failed:`, error);
  }

  if (txHash && !error) {
    try {
      const persisted = await appendTradeLog({
        ts,
        action: action.kind === "open" ? "open" : "close",
        txHash,
        reason: action.reason,
        preState: {
          usdcBalance: treasury.usdcBalance.toString(),
          positionSize: treasury.hlPosition.szi.toString(),
          positionCollateral: treasury.marginSummary.marginUsed.toString(),
        },
        fundingRatePerSecond:
          fundingHourly !== null
            ? (fundingHourly / 3600).toString()
            : undefined,
        size: action.kind === "open" ? action.size.toString() : undefined,
        side: action.kind === "open" ? action.side : undefined,
      });
      zgRoot = persisted.zgRoot;
    } catch (err) {
      console.error(
        "[strategy-hl] trade-log append failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  await pushKeeperhubRun({
    kind: "strategy",
    jobId: `strategy-hl-${ts}`,
    workflowRunId: `strategy-hl-${ts}`,
    txHash,
    summary: `[hl] ${action.kind} · ${action.reason}${error ? ` · ERR ${error.slice(0, 80)}` : ""}${zgRoot ? ` · 0G ${zgRoot.slice(0, 10)}…` : ""}`,
    ts,
  });

  await recordCronTick(ROUTE, error ? "fail" : "ok");
  return NextResponse.json({
    ok: error === null,
    action: summarize(action),
    txHash,
    error,
  });
}

function parseEnvBigInt(envName: string, fallback: bigint): bigint {
  const raw = process.env[envName];
  if (!raw) return fallback;
  try {
    return BigInt(raw);
  } catch {
    console.warn(`[strategy-hl] ${envName}=${raw} is not a valid bigint`);
    return fallback;
  }
}

function summarize(a: HlAction): Record<string, unknown> {
  if (a.kind === "open") {
    return {
      kind: a.kind,
      side: a.side,
      size: a.size.toString(),
      limitPx: a.limitPx.toString(),
      reason: a.reason,
    };
  }
  if (a.kind === "close") {
    return { kind: a.kind, limitPx: a.limitPx.toString(), reason: a.reason };
  }
  return { kind: a.kind, reason: a.reason };
}
