/**
 * One-shot snapshot of the HyperliquidTreasury on chain 999 + live HL
 * funding rate. Use to sanity-check state before re-enabling the
 * strategy cron, or to debug why a cron tick returned `skip`.
 *
 *   pnpm tsx scripts/state-hl.ts
 *
 * Reads only — no txes, no gas.
 */

import { readHlTreasury } from "../lib/hyperliquid-treasury";
import { getFundingRate } from "../lib/hyperliquid";

function pad(n: number, decimals = 6): string {
  return `${n.toFixed(decimals)}`;
}

function fmtUsdc(amount: bigint, decimals = 6): string {
  const denom = 10n ** BigInt(decimals);
  const whole = amount / denom;
  const frac = amount % denom;
  return `${whole}.${frac.toString().padStart(decimals, "0")}`;
}

function fmtSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

async function main(): Promise<void> {
  const t = await readHlTreasury();
  if (!t) {
    console.error(
      "readHlTreasury returned null — HYPERLIQUID_TREASURY_ADDRESS missing or RPC failed",
    );
    process.exit(1);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const lastSec = Number(t.lastHeartbeat);
  const ageSec = nowSec - lastSec;
  const staleAt = lastSec + Number(t.heartbeatTimeout);
  const untilStale = staleAt - nowSec;

  console.log(`\nHyperliquidTreasury  ${t.address}`);
  console.log(`──────────────────────────────────────────────`);
  console.log(`agent           ${t.agent}`);
  console.log(`owner           ${t.owner}`);
  console.log(`asset           ${t.asset}    (1=ETH on mainnet)`);
  console.log(`killed          ${t.killed}`);
  console.log(
    `heartbeat       ${ageSec >= 0 ? fmtSeconds(ageSec) : "?"} ago` +
      `   (timeout ${fmtSeconds(Number(t.heartbeatTimeout))})`,
  );
  console.log(
    `heartbeatStale  ${t.heartbeatStale}` +
      (t.heartbeatStale
        ? "   ← anyone can call emergencyExit()"
        : `   (${fmtSeconds(untilStale)} until stale)`),
  );

  console.log(`\nBalances`);
  console.log(`──────────────────────────────────────────────`);
  console.log(`USDC ERC-20     ${fmtUsdc(t.usdcBalance)} USDC  (HyperEVM-side)`);
  console.log(`HL perp account`);
  console.log(`  accountValue  ${fmtUsdc(t.marginSummary.accountValue, 8)} USDC*`);
  console.log(`  marginUsed    ${fmtUsdc(t.marginSummary.marginUsed, 8)} USDC*`);
  console.log(`  rawUsd        ${fmtUsdc(t.marginSummary.rawUsd, 8)} USDC*`);
  console.log(`  ntlPos        ${fmtUsdc(t.marginSummary.ntlPos, 8)} USDC*`);
  console.log(`  * HL exposes 8-decimal scaled; divide by 100 for true USDC`);

  console.log(`\nPosition (L1Read.position2)`);
  console.log(`──────────────────────────────────────────────`);
  const szi = t.hlPosition.szi;
  console.log(
    `szi             ${szi}` +
      (szi === 0n ? "  (flat)" : szi < 0n ? "  (SHORT)" : "  (LONG)"),
  );
  console.log(`entryNtl        ${t.hlPosition.entryNtl}`);
  console.log(`leverage        ${t.hlPosition.leverage}x`);
  console.log(`isIsolated      ${t.hlPosition.isIsolated}`);

  console.log(`\nPrices (L1Read precompiles)`);
  console.log(`──────────────────────────────────────────────`);
  console.log(`oraclePx        ${t.oraclePx}`);
  console.log(`markPx          ${t.markPx}`);

  // HL funding rate
  const env = (process.env.HL_ENV ?? "mainnet") as "mainnet" | "testnet";
  const coin = process.env.HL_ASSET_COIN ?? "ETH";
  try {
    const f = await getFundingRate(env, coin);
    console.log(`\nLive funding (${env}, ${coin})`);
    console.log(`──────────────────────────────────────────────`);
    console.log(`hourly          ${f.fundingHourly}`);
    console.log(
      `apy (compounded) ~${pad((f.fundingHourly ?? 0) * 24 * 365 * 100, 2)}%`,
    );
  } catch (err) {
    console.log(`\nfunding fetch failed: ${err instanceof Error ? err.message : err}`);
  }

  // What would decide() say right now?
  console.log(`\nStrategy gate prediction`);
  console.log(`──────────────────────────────────────────────`);
  if (t.killed) {
    console.log(`→ skip:killed`);
  } else if (t.heartbeatStale) {
    console.log(`→ skip:heartbeat-stale   (call heartbeat() first)`);
  } else if (t.markPx === 0n) {
    console.log(`→ skip:no-mark-price`);
  } else if (t.marginSummary.accountValue === 0n && szi === 0n) {
    console.log(`→ skip:no-perp-margin    (fund + depositToSpot + moveToPerp first)`);
  } else {
    console.log(`→ would evaluate funding-rate threshold — strategy can act`);
  }
  console.log();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
