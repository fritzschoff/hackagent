/* Direct MCP wrapper — list tools and read workflow definitions. */
const MCP_URL = process.env.KEEPERHUB_MCP_URL ?? "https://app.keeperhub.com/mcp";
const apiKey = process.env.KEEPERHUB_API_KEY;
if (!apiKey) {
  console.error("KEEPERHUB_API_KEY missing");
  process.exit(1);
}

let cachedSession: string | null = null;

async function getSession(): Promise<string> {
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
        clientInfo: { name: "hack-agent-debug", version: "0.0.1" },
      },
    }),
  });
  const sid = res.headers.get("mcp-session-id");
  if (!sid) throw new Error("no session id");
  cachedSession = sid;
  return sid;
}

async function parseMcpBody(text: string): Promise<unknown> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const m = text.match(/data:\s*(\{[\s\S]*?\})\s*$/m);
  if (m && m[1]) return JSON.parse(m[1]);
  throw new Error(`unparseable MCP body: ${text.slice(0, 200)}`);
}

async function rpc(method: string, params: unknown): Promise<unknown> {
  const sessionId = await getSession();
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
  return parseMcpBody(await res.text());
}

async function tool<T = unknown>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const r = (await rpc("tools/call", { name, arguments: args })) as {
    result?: { content?: { text: string }[] };
    error?: { message?: string };
  };
  if (r.error) throw new Error(`${name}: ${r.error.message}`);
  const text = r.result?.content?.[0]?.text;
  if (!text) throw new Error(`${name}: empty content`);
  return JSON.parse(text) as T;
}

async function main() {
  const cmd = process.argv[2] ?? "tools";

  if (cmd === "tools") {
    const r = (await rpc("tools/list", {})) as {
      result?: { tools?: { name: string; description?: string }[] };
    };
    const tools = r.result?.tools ?? [];
    console.log(`\n${tools.length} tools:\n`);
    for (const t of tools) {
      console.log(`  ${t.name.padEnd(35)} ${t.description?.slice(0, 60) ?? ""}`);
    }
    return;
  }

  if (cmd === "workflow") {
    const id = process.argv[3];
    if (!id) throw new Error("usage: workflow <id>");
    const r = await tool("get_workflow", { workflowId: id });
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  if (cmd === "execution") {
    const id = process.argv[3];
    if (!id) throw new Error("usage: execution <id>");
    const r = await tool("get_execution_logs", { executionId: id });
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  console.error(`unknown cmd: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
