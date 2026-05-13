/** Push current ENS workflow specs (PrimaryName, AvatarSync,
 *  GatewayCacheInvalidator) to KH. Used to clear leftover `{{$run.id}}`
 *  references that KH's strict template resolver rejects. */
import {
  buildEnsPrimaryNameSetter,
  buildEnsAvatarSync,
  buildGatewayCacheInvalidator,
  type WorkflowSpec,
} from "../lib/keeperhub-workflows";

const TARGETS = [
  {
    id: "x3x1yxn1i9fi6qs63v4lu",
    name: "ENSPrimaryNameSetter",
    spec: () =>
      buildEnsPrimaryNameSetter({
        appUrl: "https://hackagent-nine.vercel.app",
        reverseRegistrarSepolia: "0xA0a1AbcDAe1a2a4A2EF8e9113Ff0e02DD81DC0C6",
        reverseRegistrarBaseSepolia:
          "0x00000BeEF055f7934784D6d81b6BC86665630dbA",
      }),
  },
  {
    id: "iosfz5m65htyd18be78sp",
    name: "ENSAvatarSync",
    spec: () =>
      buildEnsAvatarSync({
        appUrl: "https://hackagent-nine.vercel.app",
        publicResolverSepolia: "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5",
        agentlabEthNamehash:
          "0xb89a63df7ba3ce90f2bce041fc8f78683388f4d03a77ea44b761015524848ce0",
        inftAddress: "0x103B2F28480c57ba49efeF50379Ef674d805DeDA",
      }),
  },
  {
    id: "3tzmhfpvsnom1bnkeieoz",
    name: "GatewayCacheInvalidator",
    spec: (secret: string) =>
      buildGatewayCacheInvalidator({
        appUrl: "https://hackagent-nine.vercel.app",
        webhookSecret: secret,
      }),
  },
];

async function rpc(method: string, params: unknown, sid?: string) {
  const url = "https://app.keeperhub.com/mcp";
  const apiKey = process.env.KEEPERHUB_API_KEY;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sid) headers["mcp-session-id"] = sid;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  return { sid: res.headers.get("mcp-session-id") ?? sid, text: await res.text() };
}

function parseBody(text: string): unknown {
  const t = text.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  const m = text.match(/data:\s*(\{[\s\S]*?\})\s*$/m);
  if (m && m[1]) return JSON.parse(m[1]);
  throw new Error(`unparseable: ${text.slice(0, 200)}`);
}

async function main(): Promise<void> {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  const secret = process.env.KEEPERHUB_WEBHOOK_SECRET;
  if (!apiKey || !secret) {
    console.error("missing KEEPERHUB_API_KEY or KEEPERHUB_WEBHOOK_SECRET");
    process.exit(1);
  }

  // init session
  const { sid } = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "update-ens-workflows", version: "0" },
  });
  if (!sid) throw new Error("no session id");

  for (const t of TARGETS) {
    const spec: WorkflowSpec =
      t.name === "GatewayCacheInvalidator"
        ? (t.spec as (s: string) => WorkflowSpec)(secret)
        : (t.spec as () => WorkflowSpec)();
    const r = await rpc(
      "tools/call",
      {
        name: "update_workflow",
        arguments: {
          workflowId: t.id,
          nodes: spec.nodes,
          edges: spec.edges,
        },
      },
      sid,
    );
    const body = parseBody(r.text) as { error?: { message: string } };
    if (body.error) {
      console.error(`  ${t.name}: ERROR — ${body.error.message}`);
      process.exit(1);
    }
    console.log(`  ${t.name} (${t.id}): updated`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
