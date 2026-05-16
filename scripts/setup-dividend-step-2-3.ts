/**
 * Provision the M3 DividendStep2Burn + DividendStep3Mint workflows on
 * KeeperHub. Run AFTER setup-dividend-step-1.ts (D1 should already
 * exist and be enabled).
 *
 * Usage:
 *   pnpm tsx scripts/setup-dividend-step-2-3.ts            # live
 *   pnpm tsx scripts/setup-dividend-step-2-3.ts --dry-run  # print specs
 */

import {
  buildDividendStep2Burn,
  buildDividendStep3Mint,
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
  const webhookSecret =
    process.env.KEEPERHUB_WEBHOOK_SECRET ??
    (isDryRun ? "<KEEPERHUB_WEBHOOK_SECRET>" : "");
  if (!webhookSecret) {
    console.error("Error: KEEPERHUB_WEBHOOK_SECRET missing");
    process.exit(1);
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://hackagent-nine.vercel.app";

  const specs = [
    buildDividendStep2Burn({ appUrl, webhookSecret }),
    buildDividendStep3Mint({ appUrl, webhookSecret }),
  ];

  if (isDryRun) {
    for (const s of specs) {
      console.log(`=== DRY RUN — ${s.name} ===\n`);
      console.log(JSON.stringify(s, null, 2));
      console.log();
    }
    return;
  }

  const created: { name: string; id: string }[] = [];
  for (const spec of specs) {
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
    created.push({ name: spec.name, id });
  }

  console.log(`
=== Next steps ===
`);
  for (const c of created) {
    const envKey =
      c.name === "DividendStep2Burn"
        ? "KEEPERHUB_WORKFLOW_ID_DIVIDEND_STEP_2"
        : "KEEPERHUB_WORKFLOW_ID_DIVIDEND_STEP_3";
    console.log(`  vercel env add ${envKey} production`);
    console.log(`  # paste: ${c.id}\n`);
  }
  console.log(`
D2 schedule: weekly, Sundays 00:15 UTC (15 min after D1)
D3 schedule: every 5 min

Manual tests (will return ok+skipped until D1 has settled USDC on Arb):
  curl -X POST '${appUrl}/api/keeperhub/dividend-step-2-burn' \\
    -H "Authorization: Bearer $KEEPERHUB_WEBHOOK_SECRET" -d '{}'

  curl -X POST '${appUrl}/api/keeperhub/dividend-step-3-mint' \\
    -H "Authorization: Bearer $KEEPERHUB_WEBHOOK_SECRET" -d '{}'
`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
