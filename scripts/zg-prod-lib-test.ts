import { reasonAboutQuote } from "../lib/zg-compute";
import { appendJobLog } from "../lib/zg-storage";
import type { Job } from "../lib/types";

async function main() {
  const job: Job = {
    id: "prod-lib-test-" + Date.now(),
    intent: {
      task: "swap",
      tokenIn: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      tokenOut: "0x4200000000000000000000000000000000000006",
      amountIn: "1000000",
      maxSlippageBps: 100,
    },
    quote: {
      amountOut: "1000000",
      amountOutMin: "990000",
      route: "test",
    },
    paymentTx: null,
    paymentFromAddress: null,
    ts: Date.now(),
  };

  console.log("→ reasonAboutQuote (lib/zg-compute.ts)…");
  const reasoning = await reasonAboutQuote({
    tokenIn: job.intent.tokenIn,
    tokenOut: job.intent.tokenOut,
    amountIn: job.intent.amountIn,
    amountOut: job.quote.amountOut,
  });
  if (!reasoning) {
    console.error("✗ reasonAboutQuote returned null");
    process.exit(1);
  }
  console.log("✓ model:", reasoning.model);
  console.log("✓ provider:", reasoning.provider);
  console.log("✓ teeAttested:", reasoning.teeAttested);
  console.log("✓ text:", reasoning.text);

  console.log("\n→ appendJobLog (lib/zg-storage.ts)…");
  const log = await appendJobLog(job);
  if (!log) {
    console.error("✗ appendJobLog returned null");
    process.exit(1);
  }
  console.log("✓ rootHash:", log.rootHash);
  console.log("✓ anchored:", log.anchored, "txHash:", log.txHash);
  console.log("✓ segmentsUploaded:", log.segmentsUploaded);
  if (!log.anchored || !log.segmentsUploaded || !reasoning.teeAttested) {
    console.error("\nFAIL — at least one component did not reach success state");
    process.exit(1);
  }
  console.log("\nALL GREEN");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
