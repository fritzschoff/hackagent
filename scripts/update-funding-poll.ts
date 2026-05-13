/** Re-push the current TreasuryFundingPoll spec to KeeperHub. */
import { buildTreasuryFundingPoll } from "../lib/keeperhub-workflows";

const WORKFLOW_ID = "lztdq78elnuue6l6ipa74";

async function main(): Promise<void> {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  const secret = process.env.KEEPERHUB_WEBHOOK_SECRET;
  if (!apiKey || !secret) {
    console.error("missing KEEPERHUB_API_KEY or KEEPERHUB_WEBHOOK_SECRET");
    process.exit(1);
  }
  const spec = buildTreasuryFundingPoll({
    appUrl: "https://hackagent-nine.vercel.app",
    exchange: "0x415559D5310c16e1f1235594534D0D68B6eAeD39",
    webhookSecret: secret,
  });

  const init = await fetch("https://app.keeperhub.com/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "update-funding-poll", version: "0" },
      },
    }),
  });
  const sid = init.headers.get("mcp-session-id");
  if (!sid) throw new Error("no session id");

  const r = await fetch("https://app.keeperhub.com/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "mcp-session-id": sid,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "update_workflow",
        arguments: {
          workflowId: WORKFLOW_ID,
          nodes: spec.nodes,
          edges: spec.edges,
        },
      },
    }),
  });
  const text = await r.text();
  const m = text.match(/data:\s*(\{[\s\S]*\})/);
  const body = m ? JSON.parse(m[1]) : JSON.parse(text);
  console.log(JSON.stringify(body, null, 2).slice(0, 500));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
