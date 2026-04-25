import type { SwapIntent, Quote } from "@/lib/types";

export type WorkflowResult = {
  workflowRunId: string;
  txHash: `0x${string}` | null;
  status: "queued" | "running" | "completed" | "failed";
};

export async function callSwapWorkflow(_args: {
  intent: SwapIntent;
  quote: Quote;
}): Promise<WorkflowResult | null> {
  return null;
}

export async function getWorkflowRun(
  _runId: string,
): Promise<WorkflowResult | null> {
  return null;
}
