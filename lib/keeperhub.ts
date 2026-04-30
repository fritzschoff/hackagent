import type { SwapIntent, Quote } from "@/lib/types";
import {
  getKeeperHubWorkflowId,
  getKeeperHubWorkflowIdByKind,
  type KeeperHubKind,
} from "@/lib/edge-config";

const MCP_URL = process.env.KEEPERHUB_MCP_URL ?? "https://app.keeperhub.com/mcp";

export type WorkflowResult = {
  workflowRunId: string;
  txHash: `0x${string}` | null;
  status: "queued" | "running" | "completed" | "failed";
};

let cachedSession: { id: string; expiresAt: number } | null = null;

async function getSession(apiKey: string): Promise<string> {
  if (cachedSession && cachedSession.expiresAt > Date.now() + 60_000) {
    return cachedSession.id;
  }
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
        clientInfo: { name: "hack-agent", version: "0.0.1" },
      },
    }),
  });
  const sessionId = res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("keeperhub mcp: no session id returned");
  cachedSession = {
    id: sessionId,
    expiresAt: Date.now() + 23 * 60 * 60 * 1000,
  };
  return sessionId;
}

async function parseMcpBody(text: string): Promise<unknown> {
  if (text.startsWith("event:") || text.startsWith("data:")) {
    const m = text.match(/data:\s*(\{[\s\S]*\})/);
    if (m && m[1]) return JSON.parse(m[1]);
  }
  return JSON.parse(text);
}

async function callTool<T = unknown>(
  apiKey: string,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const sessionId = await getSession(apiKey);
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
  const text = await res.text();
  const parsed = (await parseMcpBody(text)) as {
    result?: { content?: { type: string; text: string }[] };
    error?: { message?: string };
  };
  if (parsed.error) {
    throw new Error(`keeperhub ${name}: ${parsed.error.message}`);
  }
  const content = parsed.result?.content?.[0]?.text;
  if (!content) throw new Error(`keeperhub ${name}: empty result`);
  return JSON.parse(content) as T;
}

export async function callSwapWorkflow(args: {
  intent: SwapIntent;
  quote: Quote;
}): Promise<WorkflowResult | null> {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) return null;

  const workflowId =
    process.env.KEEPERHUB_WORKFLOW_ID_SWAP ??
    (await getKeeperHubWorkflowId());
  if (!workflowId) return null;

  try {
    const start = await callTool<{ executionId: string; status: string }>(
      apiKey,
      "execute_workflow",
      {
        workflowId,
        input: {
          tokenIn: args.intent.tokenIn,
          tokenOut: args.intent.tokenOut,
          amountIn: args.intent.amountIn,
          amountOut: args.quote.amountOut,
        },
      },
    );

    const txHash = await pollForTxHash(apiKey, start.executionId, 30);
    return {
      workflowRunId: start.executionId,
      txHash,
      status: txHash ? "completed" : "running",
    };
  } catch (err) {
    console.error(
      "[keeperhub] callSwapWorkflow failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function pollForTxHash(
  apiKey: string,
  executionId: string,
  maxAttempts: number,
): Promise<`0x${string}` | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await callTool<{
      status?: string;
      errorContext?: { error?: string };
    }>(apiKey, "get_execution_status", { executionId });
    if (status.status === "failed" || status.status === "error") {
      console.error(
        `[keeperhub] execution ${executionId} ${status.status}:`,
        status.errorContext?.error ?? "(no error context)",
      );
      return null;
    }
    if (status.status === "success") {
      const logs = await callTool<{
        logs?: { nodeType: string; output?: { transactionHash?: string } }[];
      }>(apiKey, "get_execution_logs", { executionId });
      const tx = logs.logs?.find((l) =>
        l.nodeType?.startsWith("web3/"),
      )?.output?.transactionHash;
      return (tx as `0x${string}` | undefined) ?? null;
    }
  }
  return null;
}

/// Generic kind-tagged trigger. Returns null when the workflow ID isn't
/// configured (env var or Edge Config) — callers fall back to the inline
/// implementation. The optional `pollForTx` flag controls whether we wait
/// for an on-chain transactionHash; for non-tx workflows (heartbeat etc.)
/// we return as soon as KeeperHub acknowledges the execution.
export async function triggerKeeperHub(args: {
  kind: KeeperHubKind;
  input: Record<string, unknown>;
  pollForTx?: boolean;
}): Promise<WorkflowResult | null> {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) return null;

  const workflowId = await getKeeperHubWorkflowIdByKind(args.kind);
  if (!workflowId) return null;

  try {
    const start = await callTool<{ executionId: string; status: string }>(
      apiKey,
      "execute_workflow",
      { workflowId, input: args.input },
    );
    if (!args.pollForTx) {
      return {
        workflowRunId: start.executionId,
        txHash: null,
        status: "running",
      };
    }
    const txHash = await pollForTxHash(apiKey, start.executionId, 30);
    return {
      workflowRunId: start.executionId,
      txHash,
      status: txHash ? "completed" : "running",
    };
  } catch (err) {
    console.error(
      `[keeperhub] triggerKeeperHub(${args.kind}) failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/// Convenience wrapper that accepts a plain string kind and routes to the
/// correct workflow via the existing KeeperHubKind routing. Returns null when
/// the kind is unrecognised or the workflow ID is not configured.
export async function triggerKeeperHubByKind(
  kind: string,
  input: Record<string, unknown>,
): Promise<{ workflowRunId: string } | null> {
  const VALID_KINDS: KeeperHubKind[] = [
    "swap",
    "heartbeat",
    "reputation-cache",
    "primary-name",
    "avatar-sync",
    "gateway-invalidate",
  ];
  if (!(VALID_KINDS as string[]).includes(kind)) {
    console.warn(
      `[keeperhub] no workflow id for kind=${kind}; skipping trigger`,
    );
    return null;
  }
  const result = await triggerKeeperHub({
    kind: kind as KeeperHubKind,
    input,
    pollForTx: false,
  });
  if (!result) return null;
  return { workflowRunId: result.workflowRunId };
}

export async function getWorkflowRun(
  runId: string,
): Promise<WorkflowResult | null> {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) return null;
  try {
    const logs = await callTool<{
      execution?: { status?: string };
      logs?: { nodeType: string; output?: { transactionHash?: string } }[];
    }>(apiKey, "get_execution_logs", { executionId: runId });
    const status = logs.execution?.status;
    const tx = logs.logs?.find((l) =>
      l.nodeType?.startsWith("web3/"),
    )?.output?.transactionHash as `0x${string}` | undefined;
    return {
      workflowRunId: runId,
      txHash: tx ?? null,
      status:
        status === "success"
          ? "completed"
          : status === "failed"
            ? "failed"
            : "running",
    };
  } catch {
    return null;
  }
}
