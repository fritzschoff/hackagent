/**
 * Provision the M1 TreasuryKillSwitch workflow on KeeperHub.
 *
 * Reads the TradingTreasury address from env (REVENUE_TREASURY_ADDRESS or
 * TRADING_TREASURY_ADDRESS, in that order) and creates a Schedule-triggered
 * workflow that hourly checks `heartbeatStale()` and, if true, calls
 * `emergencyExit()` via the Turnkey integration. After creation, the
 * workflow id is also pushed into Vercel Edge Config so the dashboard can
 * surface it without an env-var redeploy.
 *
 * Usage:
 *   pnpm tsx scripts/setup-treasury-killswitch.ts            # live
 *   pnpm tsx scripts/setup-treasury-killswitch.ts --dry-run  # print spec only
 */

import { buildTreasuryKillSwitch } from "../lib/keeperhub-workflows";

const MCP_URL =
  process.env.KEEPERHUB_MCP_URL ?? "https://app.keeperhub.com/mcp";

let _session: string | null = null;

async function initSession(apiKey: string): Promise<string> {
  if (_session) return _session;
  const res = await fetch(MCP_URL, {
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
        clientInfo: { name: "hack-agent-setup", version: "0.1.0" },
      },
    }),
  });
  const sid = res.headers.get("mcp-session-id");
  if (!sid) throw new Error("KeeperHub MCP: no session id returned");
  _session = sid;
  return sid;
}

async function parseMcpBody(text: string): Promise<unknown> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const m = text.match(/data:\s*(\{[\s\S]*?\})\s*$/m);
  if (m && m[1]) return JSON.parse(m[1]);
  throw new Error(`KeeperHub MCP: unparseable response: ${text.slice(0, 300)}`);
}

async function callTool<T = unknown>(
  apiKey: string,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const sessionId = await initSession(apiKey);
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "mcp-session-id": sessionId,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const parsed = (await parseMcpBody(await res.text())) as {
    result?: { content?: { text: string }[] };
    error?: { message?: string };
  };
  if (parsed.error) {
    throw new Error(`KeeperHub ${name}: ${parsed.error.message}`);
  }
  const text = parsed.result?.content?.[0]?.text;
  if (!text) throw new Error(`KeeperHub ${name}: empty content`);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

async function main(): Promise<void> {
  const isDryRun = process.argv.includes("--dry-run");
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey && !isDryRun) {
    console.error("Error: KEEPERHUB_API_KEY missing");
    process.exit(1);
  }

  const treasury = (process.env.TRADING_TREASURY_ADDRESS ??
    process.env.REVENUE_TREASURY_ADDRESS) as `0x${string}` | undefined;
  if (!treasury) {
    console.error(
      "Error: TRADING_TREASURY_ADDRESS missing (set to the Base Sepolia TradingTreasury contract address)",
    );
    process.exit(1);
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(treasury)) {
    console.error(`Error: invalid address ${treasury}`);
    process.exit(1);
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://hackagent-nine.vercel.app";

  const spec = buildTreasuryKillSwitch({
    appUrl,
    tradingTreasury: treasury,
  });

  if (isDryRun) {
    console.log("=== DRY RUN — TreasuryKillSwitch spec ===\n");
    console.log(JSON.stringify(spec, null, 2));
    return;
  }

  process.stdout.write(`Creating ${spec.name} on KeeperHub... `);
  const result = await callTool<{ id?: string; workflowId?: string }>(
    apiKey!,
    "create_workflow",
    {
      name: spec.name,
      description: spec.description,
      nodes: spec.nodes,
      edges: spec.edges,
      enabled: true,
    },
  );
  const id = result.id ?? result.workflowId;
  if (!id) {
    console.log("FAILED");
    console.error(`create_workflow returned no id: ${JSON.stringify(result)}`);
    process.exit(1);
  }
  console.log(`OK (${id})`);

  console.log(`
=== Next steps ===

  vercel env add KEEPERHUB_WORKFLOW_ID_KILL_SWITCH production
  # paste: ${id}

# Or via Edge Config (preferred — no redeploy):
#   key: keeperhub_workflow_kill_switch
#   val: ${id}

Treasury watched: ${treasury}
Schedule:        every hour, top of the hour, UTC
Webhook target:  ${appUrl}/api/webhooks/keeperhub  (kind: "kill-switch")
`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
