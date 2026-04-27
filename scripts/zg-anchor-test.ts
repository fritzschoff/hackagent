import { appendJobLog } from "../lib/zg-storage";
import type { Job } from "../lib/types";

async function main() {
  const fakeJob: Job = {
    id: "test-anchor-" + Date.now(),
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

  console.log("calling appendJobLog...");
  const res = await appendJobLog(fakeJob);
  console.log("result:", res);
  if (res?.anchored && res.txHash) {
    console.log(
      "✓ anchored on-chain",
      `https://chainscan-galileo.0g.ai/tx/${res.txHash}`,
    );
  }
  if (res?.segmentsUploaded) {
    console.log(`✓ segments uploaded for root=${res.rootHash}`);
  } else if (res?.anchored) {
    console.warn("✗ segments not uploaded — anchored but storage nodes never indexed");
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
