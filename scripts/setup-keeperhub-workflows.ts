/**
 * Provision 3 new KeeperHub workflows for W3 primary names.
 *
 * Workflows created:
 *   ENSPrimaryNameSetter     → KEEPERHUB_WORKFLOW_ID_PRIMARY_NAME
 *   ENSAvatarSync            → KEEPERHUB_WORKFLOW_ID_AVATAR_SYNC
 *   GatewayCacheInvalidator  → KEEPERHUB_WORKFLOW_ID_GATEWAY_INVALIDATE
 *
 * Usage:
 *   pnpm exec tsx scripts/setup-keeperhub-workflows.ts            # live
 *   pnpm exec tsx scripts/setup-keeperhub-workflows.ts --dry-run  # print specs
 *
 * NOTE: heartbeat + reputation-cache workflows are NOT deleted (PR #13 already
 * converted them to webhook-only triggers; they remain as zero-gas heartbeat
 * sources).
 */

import {
  buildEnsPrimaryNameSetter,
  buildEnsAvatarSync,
  buildGatewayCacheInvalidator,
  type WorkflowSpec,
} from "../lib/keeperhub-workflows";

// ─── addresses ───────────────────────────────────────────────────────────────

const REVERSE_REGISTRAR_SEPOLIA =
  "0xA0a1AbcDAe1a2a4A2EF8e9113Ff0e02DD81DC0C6" as const;
const REVERSE_REGISTRAR_BASE_SEPOLIA =
  "0x00000BeEF055f7934784D6d81b6BC86665630dbA" as const;
const PUBLIC_RESOLVER_SEPOLIA =
  "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5" as const;
// namehash("agentlab.eth") — computed via viem.namehash
const AGENTLAB_ETH_NAMEHASH =
  "0xb89a63df7ba3ce90f2bce041fc8f78683388f4d03a77ea44b761015524848ce0" as const;

// ─── MCP helpers ─────────────────────────────────────────────────────────────

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

async function rpc<T = unknown>(
  apiKey: string,
  method: string,
  params: unknown,
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
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  return parseMcpBody(await res.text()) as T;
}

async function callTool<T = unknown>(
  apiKey: string,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const r = await rpc<{
    result?: { content?: { text: string }[] };
    error?: { message?: string };
  }>(apiKey, "tools/call", { name, arguments: args });
  if (r.error) throw new Error(`KeeperHub ${name}: ${r.error.message}`);
  const text = r.result?.content?.[0]?.text;
  if (!text) throw new Error(`KeeperHub ${name}: empty content`);
  return JSON.parse(text) as T;
}

// ─── provision ───────────────────────────────────────────────────────────────

async function createWorkflow(
  apiKey: string,
  spec: WorkflowSpec,
): Promise<string> {
  const result = await callTool<{ id?: string; workflowId?: string }>(
    apiKey,
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
    throw new Error(
      `create_workflow returned no id: ${JSON.stringify(result)}`,
    );
  }
  return id;
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey && !isDryRun) {
    console.error("Error: KEEPERHUB_API_KEY missing");
    process.exit(1);
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://hackagent-nine.vercel.app";
  const webhookSecret =
    process.env.KEEPERHUB_WEBHOOK_SECRET ?? "<KEEPERHUB_WEBHOOK_SECRET>";

  // Read INFT address from env (deployed in W1, stored in Edge Config)
  const inftAddress = (process.env.INFT_ADDRESS ??
    "0x0000000000000000000000000000000000000000") as `0x${string}`;

  const specs: { envKey: string; spec: WorkflowSpec }[] = [
    {
      envKey: "KEEPERHUB_WORKFLOW_ID_PRIMARY_NAME",
      spec: buildEnsPrimaryNameSetter({
        appUrl,
        reverseRegistrarSepolia: REVERSE_REGISTRAR_SEPOLIA,
        reverseRegistrarBaseSepolia: REVERSE_REGISTRAR_BASE_SEPOLIA,
      }),
    },
    {
      envKey: "KEEPERHUB_WORKFLOW_ID_AVATAR_SYNC",
      spec: buildEnsAvatarSync({
        appUrl,
        publicResolverSepolia: PUBLIC_RESOLVER_SEPOLIA,
        agentlabEthNamehash: AGENTLAB_ETH_NAMEHASH,
        inftAddress,
      }),
    },
    {
      envKey: "KEEPERHUB_WORKFLOW_ID_GATEWAY_INVALIDATE",
      spec: buildGatewayCacheInvalidator({
        appUrl,
        webhookSecret,
      }),
    },
  ];

  if (isDryRun) {
    console.log("=== DRY RUN — workflow specs (no MCP calls) ===\n");
    for (const { envKey, spec } of specs) {
      console.log(`--- ${spec.name} (${envKey}) ---`);
      console.log(JSON.stringify(spec, null, 2));
      console.log();
    }
    console.log("Pass without --dry-run to create these workflows.");
    return;
  }

  console.log("Provisioning 3 new KeeperHub workflows...\n");

  const created: { envKey: string; name: string; id: string }[] = [];

  for (const { envKey, spec } of specs) {
    process.stdout.write(`  Creating ${spec.name}... `);
    try {
      const id = await createWorkflow(apiKey!, spec);
      console.log(`OK (${id})`);
      created.push({ envKey, name: spec.name, id });
    } catch (err) {
      console.log(`FAILED`);
      console.error(
        `  Error:`,
        err instanceof Error ? err.message : String(err),
      );
      process.exit(1);
    }
  }

  console.log("\n=== Add these env vars to .env.local + Vercel ===\n");
  for (const { envKey, id } of created) {
    console.log(`${envKey}=${id}`);
  }
  console.log(`
# Edge Config keys to set (or update) via the Vercel dashboard:
#   keeperhub_workflow_primary_name  = <KEEPERHUB_WORKFLOW_ID_PRIMARY_NAME>
#   keeperhub_workflow_avatar_sync   = <KEEPERHUB_WORKFLOW_ID_AVATAR_SYNC>
#   keeperhub_workflow_gateway_invalidate = <KEEPERHUB_WORKFLOW_ID_GATEWAY_INVALIDATE>

# heartbeat + reputation-cache workflows were NOT deleted.
# They are now webhook-only triggers (PR #13) — zero-gas heartbeat sources.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
