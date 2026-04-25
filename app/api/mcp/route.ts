export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32601, message: "MCP server lands in P4" },
    },
    { status: 501 },
  );
}

export async function GET() {
  return Response.json({
    server: "tradewise.agentlab.eth",
    status: "not_implemented",
    note: "MCP server endpoint reserved for P4 (KeeperHub integration)",
  });
}
