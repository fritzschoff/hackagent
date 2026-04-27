/**
 * Patch the misconfigured KeeperHub workflows via MCP update_workflow.
 *
 *   pnpm tsx scripts/patch-keeperhub-workflows.ts
 *
 * - reputation-cache: fix args, add setText write node, fix webhook URL,
 *   convert template references to KeeperHub's `{{@nodeId:Label.field}}`
 *   syntax.
 * - compliance-attest: convert condition expression from `$step2[1]` to
 *   the named-output reference.
 * - heartbeat: convert the setText `value` from `{{$trigger.input.ts}}`
 *   to `{{@trigger-cron:Cron Trigger.data.ts}}`, the actual KeeperHub syntax.
 */

const MCP_URL = process.env.KEEPERHUB_MCP_URL ?? "https://app.keeperhub.com/mcp";

const REPUTATION_REGISTRY = "0x477D6FeFCE87B627a7B2215ee62a4E21fc102BbA";
const PUBLIC_RESOLVER = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";
const ENS_NODE =
  "0x6d81003b2f91af0480ced9f5ab8aec945befadb5342a572c264ec86bcfc00cce";
const WEBHOOK_URL = "https://hackagent-nine.vercel.app/api/webhooks/keeperhub";
const INTEGRATION_ID = "i2ywfgrbbmtpr0hf1xh80";

const FEEDBACK_COUNT_ABI = JSON.stringify([
  {
    type: "function",
    name: "feedbackCount",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
]);

const RESOLVER_TEXT_ABI = JSON.stringify([
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
]);

const RESOLVER_SETTEXT_ABI = JSON.stringify([
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
]);

let cachedSession: string | null = null;

async function getSession(apiKey: string): Promise<string> {
  if (cachedSession) return cachedSession;
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
        clientInfo: { name: "hack-agent-patch", version: "0" },
      },
    }),
  });
  const sid = res.headers.get("mcp-session-id");
  if (!sid) throw new Error("no session id");
  cachedSession = sid;
  return sid;
}

async function tool<T = unknown>(
  apiKey: string,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const sid = await getSession(apiKey);
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "mcp-session-id": sid,
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
  const text = await res.text();
  const trimmed = text.trim();
  let body: { result?: { content?: { text: string }[] }; error?: { message?: string } };
  if (trimmed.startsWith("{")) {
    body = JSON.parse(trimmed);
  } else {
    const m = text.match(/data:\s*(\{[\s\S]*?\})\s*$/m);
    if (!m) throw new Error(`unparseable: ${text.slice(0, 200)}`);
    body = JSON.parse(m[1]);
  }
  if (body.error) throw new Error(`${name}: ${body.error.message}`);
  const content = body.result?.content?.[0]?.text;
  if (!content) throw new Error(`${name}: empty content`);
  return JSON.parse(content) as T;
}

async function patchHeartbeat(apiKey: string) {
  const id = process.env.KEEPERHUB_WORKFLOW_ID_HEARTBEAT!;
  console.log(`\n=== heartbeat ${id} ===`);
  const wf = await tool<{ nodes: { id: string; data: { label: string; config: Record<string, unknown> } }[]; edges: unknown[] }>(
    apiKey,
    "get_workflow",
    { workflowId: id },
  );

  // Fix the setText `value` arg: switch from {{$trigger.input.ts}} (which is
  // not KeeperHub syntax) to {{@trigger-cron:Cron Trigger.data.ts}} (named output
  // reference).
  for (const n of wf.nodes) {
    if (n.id === "web3-write") {
      const cfg = n.data.config;
      cfg.functionArgs = JSON.stringify([
        ENS_NODE,
        "last-seen-at",
        "{{@trigger-cron:Cron Trigger.data.ts}}",
      ]);
      console.log(`  patched value template → {{@trigger-cron:Cron Trigger.data.ts}}`);
    }
  }

  await tool(apiKey, "update_workflow", {
    workflowId: id,
    nodes: wf.nodes,
    edges: wf.edges,
  });
  console.log("  saved.");
}

async function patchReputationCache(apiKey: string) {
  const id = process.env.KEEPERHUB_WORKFLOW_ID_REPUTATION_CACHE!;
  console.log(`\n=== reputation-cache ${id} ===`);
  const wf = await tool<{ nodes: { id: string; data: { label: string; config: Record<string, unknown> } }[]; edges: { id: string; source: string; target: string; type?: string }[] }>(
    apiKey,
    "get_workflow",
    { workflowId: id },
  );

  // KeeperHub silently exits a Run-Code transform node when the expression
  // has unresolvable templates, so we drop transform + idempotency-read +
  // conditional and inline the summary into the setText `value` template
  // (KeeperHub does substitute templates inside functionArgs strings).
  const triggerNode = wf.nodes.find(
    (n) =>
      n.data.label?.toLowerCase().includes("trigger") ||
      ((n.data.config as Record<string, unknown>)?.triggerType as string)
        ?.length > 0,
  );
  const triggerId = triggerNode?.id ?? "trigger";
  const triggerLabel = triggerNode?.data.label ?? "Cron Trigger";

  const readNode = wf.nodes.find((n) => n.id === "read-web3-1");
  if (readNode) {
    readNode.data.config.abi = FEEDBACK_COUNT_ABI;
    readNode.data.config.useManualAbi = "true";
    readNode.data.config.functionArgs = JSON.stringify([1]);
    console.log(`  read-web3-1: args [1] + manual abi`);
  }

  const settextValue = `feedback={{@read-web3-1:Web3 Read - ReputationRegistry.result}} ts={{@${triggerId}:${triggerLabel}.data.ts}}`;
  const writeNode = {
    id: "write-setText",
    type: "action",
    position: { x: 1500, y: 0 },
    data: {
      type: "action",
      label: "Web3 Write setText",
      config: {
        actionType: "web3/write-contract",
        contractAddress: PUBLIC_RESOLVER,
        abi: RESOLVER_SETTEXT_ABI,
        useManualAbi: "true",
        abiFunction: "setText",
        functionArgs: JSON.stringify([
          ENS_NODE,
          "reputation-summary",
          settextValue,
        ]),
        signer: "test",
        integrationId: INTEGRATION_ID,
        network: "11155111",
        usePrivateMempool: false,
      },
      status: "idle",
    },
  };

  wf.nodes = wf.nodes.filter(
    (n) =>
      n.id !== "transform-1" &&
      n.id !== "read-web3-2" &&
      n.id !== "cond-1" &&
      n.id !== "write-setText",
  );
  wf.nodes.push(writeNode);
  console.log(`  pruned transform-1, read-web3-2, cond-1; inserted write-setText`);

  const webhookNode = wf.nodes.find((n) => n.id === "webhook-1");
  if (webhookNode) {
    webhookNode.data.config.webhookUrl = WEBHOOK_URL;
    webhookNode.data.config.webhookPayload = JSON.stringify({
      kind: "reputation-cache",
      workflowRunId: "",
      txHash: "{{@write-setText:Web3 Write setText.txHash}}",
      summary: settextValue,
    });
    console.log(`  webhook-1: URL + payload reset`);
  }

  wf.edges = [
    { id: "e1", source: triggerId, target: "read-web3-1", type: "animated" },
    {
      id: "e2",
      source: "read-web3-1",
      target: "write-setText",
      type: "animated",
    },
    {
      id: "e3",
      source: "write-setText",
      target: "webhook-1",
      type: "animated",
    },
  ];
  console.log(
    `  rewired ${triggerId} → read-web3-1 → write-setText → webhook-1`,
  );

  await tool(apiKey, "update_workflow", {
    workflowId: id,
    nodes: wf.nodes,
    edges: wf.edges,
  });
  console.log("  saved.");
}

async function patchComplianceAttest(apiKey: string) {
  const id = process.env.KEEPERHUB_WORKFLOW_ID_COMPLIANCE_ATTEST!;
  console.log(`\n=== compliance-attest ${id} ===`);
  const wf = await tool<{ nodes: { id: string; data: { label: string; config: Record<string, unknown> } }[]; edges: { id: string; source: string; target: string; type?: string }[] }>(
    apiKey,
    "get_workflow",
    { workflowId: id },
  );

  // KeeperHub's `result` field for tuple-returning view functions is opaque
  // (no bracket access on action outputs), so the conditional in-workflow is
  // not viable. Drop the condition node and let the webhook receiver do the
  // comparison. /api/webhooks/keeperhub already knows the expected root, and
  // its summary string surfaces in the dashboard runs list.
  for (const n of wf.nodes) {
    if (n.id === "webhook-action") {
      // Tuple read returns named fields under `result` — use
      // `result.manifestRoot` to access the bytes32. Comparison happens in
      // the webhook receiver because KeeperHub's in-workflow conditional
      // does not allow bracket access on action outputs.
      n.data.config.webhookPayload = JSON.stringify({
        kind: "compliance-attest",
        workflowRunId: "",
        txHash: null,
        manifestRoot:
          "{{@web3-read:Web3 Read.result.manifestRoot}}",
        expectedRoot:
          "{{@cron-trigger:Cron Trigger.data.expectedRoot}}",
        summary: "manifest read",
      });
      console.log(`  webhook-action: payload uses result.manifestRoot`);
    }
  }

  // Drop the condition node + rewire web3-read directly to webhook-action.
  const before = wf.nodes.length;
  wf.nodes = wf.nodes.filter((n) => n.id !== "condition");
  if (wf.nodes.length < before) console.log(`  - removed condition node`);
  wf.edges = wf.edges
    .filter((e) => e.source !== "condition" && e.target !== "condition")
    .concat([
      {
        id: "e-read-webhook",
        source: "web3-read",
        target: "webhook-action",
        type: "animated",
      },
    ]);
  // Dedup edges by source+target
  const seen = new Set<string>();
  wf.edges = wf.edges.filter((e) => {
    const k = `${e.source}->${e.target}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  console.log(`  rewired web3-read → webhook-action`);

  await tool(apiKey, "update_workflow", {
    workflowId: id,
    nodes: wf.nodes,
    edges: wf.edges,
  });
  console.log("  saved.");
}

async function main() {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) throw new Error("KEEPERHUB_API_KEY missing");
  await patchHeartbeat(apiKey);
  await patchReputationCache(apiKey);
  await patchComplianceAttest(apiKey);
  console.log("\ndone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
