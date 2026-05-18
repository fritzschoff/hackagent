/**
 * First-fund the HyperliquidTreasury: heartbeat + approve + fund +
 * depositToSpot + moveToPerp. Run once after the user lands USDC on
 * the broadcaster wallet on HyperEVM.
 *
 *   pnpm tsx scripts/first-fund-hl.ts <amountUSDC>
 *
 * `amountUSDC` is in whole USDC (6 decimals applied internally). e.g.
 * 100 = 100_000_000 base units. Minimum 11 USDC to clear HL's $10
 * min-notional plus a buffer.
 *
 * Submits 5 HyperEVM txes in sequence; each waits for the previous
 * receipt before the next. HL spot/perp ledger credits are async on
 * the HL side (~1 HyperCore block) — verify post-run with
 * `cast call <treasury> marginSummary()`.
 */

import { parseUnits } from "viem";
import { hyperEvmPublicClient, hyperEvmWalletClient } from "../lib/wallets";
import HyperliquidTreasuryAbi from "../lib/abis/HyperliquidTreasury.json";

const TREASURY = "0x6aF06f682A7Ba7Db32587FDedF51B9190EF738fA" as const;
const USDC = "0xb88339CB7199b77E23DB6E890353E22632Ba630f" as const;
const MIN_USDC = 11n; // whole-USDC; below HL's $10 min-notional is silly

const ABI = HyperliquidTreasuryAbi as readonly unknown[];

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
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
] as const;

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: pnpm tsx scripts/first-fund-hl.ts <amountUSDC>");
    process.exit(1);
  }
  const whole = BigInt(arg);
  if (whole < MIN_USDC) {
    console.error(`amount must be >= ${MIN_USDC} USDC (HL min-notional)`);
    process.exit(1);
  }
  const amount = parseUnits(arg, 6); // USDC has 6 decimals

  const pub = hyperEvmPublicClient();
  const wallet = hyperEvmWalletClient("agent");
  const agent = wallet.account.address;

  // Pre-flight: HYPE, USDC balance, treasury not killed.
  const hype = await pub.getBalance({ address: agent });
  if (hype < 1_000_000_000_000_000n) {
    // < 0.001 HYPE
    console.error(
      `broadcaster HYPE low: ${hype} wei. Top up before running.`,
    );
    process.exit(1);
  }
  const usdcBalance = (await pub.readContract({
    address: USDC,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [agent],
  })) as bigint;
  if (usdcBalance < amount) {
    console.error(
      `USDC short: have ${usdcBalance}, need ${amount}. Bridge USDC onto HyperEVM (${USDC}) on the broadcaster first.`,
    );
    process.exit(1);
  }
  const killed = (await pub.readContract({
    address: TREASURY,
    abi: ABI,
    functionName: "killed",
  })) as boolean;
  if (killed) {
    console.error("treasury is killed — re-deploy required");
    process.exit(1);
  }

  console.log(`Funding ${whole} USDC into ${TREASURY}...\n`);

  // 1. heartbeat — reset the staleness clock.
  console.log("1/5 heartbeat()");
  const tx1 = await wallet.writeContract({
    address: TREASURY,
    abi: ABI,
    functionName: "heartbeat",
  });
  await pub.waitForTransactionReceipt({ hash: tx1 });
  console.log(`     ${tx1}\n`);

  // 2. approve USDC → treasury for the upcoming fund pull.
  console.log("2/5 USDC.approve(treasury, amount)");
  const tx2 = await wallet.writeContract({
    address: USDC,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [TREASURY, amount],
  });
  await pub.waitForTransactionReceipt({ hash: tx2 });
  console.log(`     ${tx2}\n`);

  // 3. fund — pulls USDC from broadcaster into treasury.
  console.log(`3/5 treasury.fund(${amount})`);
  const tx3 = await wallet.writeContract({
    address: TREASURY,
    abi: ABI,
    functionName: "fund",
    args: [amount],
  });
  await pub.waitForTransactionReceipt({ hash: tx3 });
  console.log(`     ${tx3}\n`);

  // 4. depositToSpot — ERC-20 → HL spot (system address transfer).
  console.log(`4/5 treasury.depositToSpot(${amount})`);
  const tx4 = await wallet.writeContract({
    address: TREASURY,
    abi: ABI,
    functionName: "depositToSpot",
    args: [amount],
  });
  await pub.waitForTransactionReceipt({ hash: tx4 });
  console.log(`     ${tx4}\n`);

  // 5. moveToPerp — HL spot → HL perp (usdClassTransfer via CoreWriter).
  // Note: depositToSpot credits HL spot async (~1 HyperCore block). HL
  // serialises usdClassTransfer behind the spot credit, so submitting
  // back-to-back is safe — the perp credit just lands a block later.
  // moveToPerp takes uint64, not uint256.
  const amount64 = BigInt(amount);
  console.log(`5/5 treasury.moveToPerp(${amount64})`);
  const tx5 = await wallet.writeContract({
    address: TREASURY,
    abi: ABI,
    functionName: "moveToPerp",
    args: [amount64],
  });
  await pub.waitForTransactionReceipt({ hash: tx5 });
  console.log(`     ${tx5}\n`);

  console.log("===");
  console.log(`Funded ${whole} USDC into HL perp account for ${TREASURY}.`);
  console.log(
    "HL settles spot+perp credits asynchronously (~1 HyperCore block each).",
  );
  console.log("Verify with:");
  console.log(
    `  cast call ${TREASURY} 'marginSummary()(uint64,uint64,uint64,uint64)' --rpc-url https://rpc.hyperliquid.xyz/evm`,
  );
  console.log(
    "When accountValue > 0, you can re-enable TreasuryStrategyHLTrigger:",
  );
  console.log(
    "  edit scripts/pause-strategy-hl.ts → ENABLED = true; pnpm tsx scripts/pause-strategy-hl.ts",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
