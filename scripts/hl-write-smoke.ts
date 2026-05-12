/**
 * V1 write-path validation against HL testnet.
 *
 * Sends one tiny signed limit order. The agent EOA has zero margin on
 * HL testnet, so HL will reject the order — *but* the rejection reason
 * tells us whether our signing wire is correct:
 *
 *   - "Insufficient margin" / order-related error  → signing works ✓
 *   - "User or API Wallet ... does not exist"      → wallet has never
 *       interacted with HL; signing works ✓ (just no account state yet)
 *   - "Signature error" / "invalid signature"     → bug in lib/hyperliquid.ts
 *
 * Run:
 *   pnpm tsx scripts/hl-write-smoke.ts
 */

import { privateKeyToAccount } from "viem/accounts";
import { openPosition, getFundingRate } from "../lib/hyperliquid";

async function main(): Promise<void> {
  const env = "testnet" as const;
  const pk = process.env.AGENT_PK;
  if (!pk) throw new Error("AGENT_PK missing");

  const account = privateKeyToAccount(
    (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`,
  );
  console.log(`account: ${account.address}`);

  const f = await getFundingRate(env, "ETH");
  console.log(`ETH mark=${f.markPx} oracle=${f.oraclePx}`);

  console.log("placing 0.001 ETH IOC long at +0.5% slippage (will fail on margin)…");
  const res = await openPosition({
    env,
    account,
    asset: "ETH",
    isBuy: true,
    size: 0.001,
    slippageBps: 50,
  });
  console.log("response:", JSON.stringify(res, null, 2));
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
