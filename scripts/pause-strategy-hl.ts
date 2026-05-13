/** One-shot: pause the TreasuryStrategyHLTrigger workflow on KeeperHub.
 *
 * Use `enabled: false` (non-destructive) — config + history retained.
 * Re-enable with the same script + `enabled: true` (or run from KH dashboard).
 *
 *   pnpm tsx scripts/pause-strategy-hl.ts
 */
const WORKFLOW_ID = "97cd7hif10whqny6tket3"; // TreasuryStrategyHLTrigger
const ENABLED = false;

async function main(): Promise<void> {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) {
    console.error("missing KEEPERHUB_API_KEY");
    process.exit(1);
  }

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
        clientInfo: { name: "pause-strategy-hl", version: "0" },
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
        arguments: { workflowId: WORKFLOW_ID, enabled: ENABLED },
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
  console.log(`${ENABLED ? "enabled" : "paused"}: ${WORKFLOW_ID}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
