import { getKeeperHubWorkflowIdByKind } from "../lib/edge-config";
import { triggerKeeperHub } from "../lib/keeperhub";

const kinds = [
  "heartbeat",
  "reputation-cache",
  "compliance-attest",
] as const;

async function main() {
  console.log("\n=== Configured workflow IDs ===\n");
  for (const k of kinds) {
    const id = await getKeeperHubWorkflowIdByKind(k);
    console.log(`  ${k.padEnd(20)} ${id ?? "(not configured)"}`);
  }

  console.log("\n=== Triggering each workflow ===\n");
  for (const k of kinds) {
    console.log(`\n[${k}] firing…`);
    const input =
      k === "heartbeat"
        ? { ts: Date.now() }
        : k === "reputation-cache"
          ? { agentId: 1, ts: Date.now() }
          : {
              registry: "0xD92F99A883B3Ca3F5736bf24361aa75B53168e7c",
              agentId: 1,
              expectedRoot:
                "0x6b675048fbacbe7c0b90b796ff07657ac2a410969018ff2436d6566e62952f12",
              ts: Date.now(),
            };
    const result = await triggerKeeperHub({
      kind: k,
      input,
      pollForTx: k !== "compliance-attest",
    });
    if (!result) {
      console.log(
        `  → null (workflow id missing or KEEPERHUB_API_KEY unset)`,
      );
      continue;
    }
    console.log(
      `  → runId=${result.workflowRunId} status=${result.status} tx=${result.txHash ?? "(none)"}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
