/**
 * V1 smoke test against HL testnet. No funds required, no writes.
 *
 * Calls every read in lib/hyperliquid.ts:
 *   - getMeta            → universe of assets
 *   - getAssetIndex      → ETH index
 *   - getFundingRate     → current ETH funding rate + mark
 *   - getClearinghouseState (for AGENT_PK) → account exists?
 *
 * Run:
 *   pnpm tsx scripts/hl-smoke.ts
 */

import { privateKeyToAccount } from "viem/accounts";
import {
  getMeta,
  getAssetIndex,
  getFundingRate,
  getClearinghouseState,
} from "../lib/hyperliquid";

async function main(): Promise<void> {
  const env = "testnet" as const;

  console.log("• meta");
  const meta = await getMeta(env);
  console.log(
    `  universe length: ${meta.universe.length}, first five: ${meta.universe
      .slice(0, 5)
      .map((a) => a.name)
      .join(", ")}`,
  );

  console.log("• asset index");
  const ethIdx = await getAssetIndex(env, "ETH");
  console.log(`  ETH index: ${ethIdx}`);

  console.log("• funding rate (ETH)");
  const f = await getFundingRate(env, "ETH");
  console.log(
    `  hourly funding=${f.fundingHourly}, mark=${f.markPx}, oracle=${f.oraclePx}`,
  );

  const pk = process.env.AGENT_PK;
  if (!pk) {
    console.log("• clearinghouseState: skipped (no AGENT_PK)");
    return;
  }
  const account = privateKeyToAccount(
    (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`,
  );
  console.log(`• clearinghouseState for ${account.address}`);
  const ch = await getClearinghouseState(env, account.address);
  console.log(
    `  accountValue=${ch.marginSummary.accountValue} withdrawable=${ch.withdrawable} positions=${ch.assetPositions.length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
