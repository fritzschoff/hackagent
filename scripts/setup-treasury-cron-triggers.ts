/**
 * Provision three Schedule-triggered KeeperHub workflows that hit our
 * existing cron endpoints with bearer-auth headers:
 *
 *   TreasuryHeartbeatTrigger  — every 30 min → /api/cron/treasury-heartbeat
 *   TreasuryStrategyTrigger   — every 15 min → /api/cron/treasury-strategy
 *   TreasuryStrategyHLTrigger — every 15 min → /api/cron/treasury-strategy-hl
 *
 * After these run, the corresponding Vercel cron entries become
 * redundant — remove them from vercel.json. The endpoint code is
 * unchanged; it still authenticates via verifyCronAuth(CRON_SECRET).
 *
 * Usage:
 *   pnpm tsx scripts/setup-treasury-cron-triggers.ts            # live
 *   pnpm tsx scripts/setup-treasury-cron-triggers.ts --dry-run  # print specs
 */

import {
  buildScheduledCronTrigger,
  type WorkflowSpec,
} from "../lib/keeperhub-workflows";

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
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret && !isDryRun) {
    console.error("Error: CRON_SECRET missing");
    process.exit(1);
  }
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://hackagent-nine.vercel.app";

  const specs: { envKey: string; spec: WorkflowSpec }[] = [
    {
      envKey: "KEEPERHUB_WORKFLOW_ID_HEARTBEAT_TRIGGER",
      spec: buildScheduledCronTrigger({
        name: "TreasuryHeartbeatTrigger",
        description:
          "Schedule-triggered (every 30 min). GETs /api/cron/treasury-heartbeat with Bearer ${CRON_SECRET}. Replaces the Vercel cron of the same path — same code, KH-driven schedule. Pinging the TradingTreasury heartbeat well inside the 6h kill-switch window from AGENT_PK on Base Sepolia.",
        cron: "*/30 * * * *",
        appUrl,
        routePath: "/api/cron/treasury-heartbeat",
        cronSecret: cronSecret ?? "<CRON_SECRET>",
      }),
    },
    {
      envKey: "KEEPERHUB_WORKFLOW_ID_STRATEGY_TRIGGER",
      spec: buildScheduledCronTrigger({
        name: "TreasuryStrategyTrigger",
        description:
          "Schedule-triggered (every 15 min). GETs /api/cron/treasury-strategy with Bearer ${CRON_SECRET}. The endpoint reads on-chain state + the latest TreasuryFundingPoll snapshot, runs pure decide(), and executes open/close on TradingTreasury via AGENT_PK.",
        cron: "*/15 * * * *",
        appUrl,
        routePath: "/api/cron/treasury-strategy",
        cronSecret: cronSecret ?? "<CRON_SECRET>",
      }),
    },
    {
      envKey: "KEEPERHUB_WORKFLOW_ID_STRATEGY_HL_TRIGGER",
      spec: buildScheduledCronTrigger({
        name: "TreasuryStrategyHLTrigger",
        description:
          "Schedule-triggered (every 15 min). GETs /api/cron/treasury-strategy-hl with Bearer ${CRON_SECRET}. The endpoint reads HyperliquidTreasury state via the L1Read precompiles, pulls funding via the HL REST API, runs HL-shape decide(), and executes via the contract on HyperEVM.",
        cron: "*/15 * * * *",
        appUrl,
        routePath: "/api/cron/treasury-strategy-hl",
        cronSecret: cronSecret ?? "<CRON_SECRET>",
      }),
    },
  ];

  if (isDryRun) {
    console.log("=== DRY RUN — Scheduled cron triggers ===\n");
    for (const { envKey, spec } of specs) {
      console.log(`--- ${spec.name} (${envKey}) ---`);
      console.log(JSON.stringify(spec, null, 2));
      console.log();
    }
    return;
  }

  console.log("Provisioning 3 KH cron triggers...\n");
  const created: { envKey: string; id: string }[] = [];

  for (const { envKey, spec } of specs) {
    process.stdout.write(`  ${spec.name}... `);
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
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    console.log(`OK (${id})`);
    created.push({ envKey, id });
  }

  console.log("\n=== Env vars to set (vercel env add ...) ===\n");
  for (const { envKey, id } of created) {
    console.log(`${envKey}=${id}`);
  }
  console.log(
    "\nNote: vercel.json cron entries for these endpoints can now be removed.",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
