/** Re-push the current TreasuryKillSwitch spec to KeeperHub. */
import { buildTreasuryKillSwitch } from "../lib/keeperhub-workflows";

const WORKFLOW_ID = "xbsxr90axg3s6rhzbtyko";

async function main(): Promise<void> {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) {
    console.error("missing KEEPERHUB_API_KEY");
    process.exit(1);
  }
  const spec = buildTreasuryKillSwitch({
    appUrl: "https://hackagent-nine.vercel.app",
    tradingTreasury: "0x7F860F68278435951d324Ee2eD801D910b6F53b3",
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
        clientInfo: { name: "update-killswitch", version: "0" },
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
  if (body.error) {
    console.error(body.error);
    process.exit(1);
  }
  console.log("updated:", WORKFLOW_ID);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
