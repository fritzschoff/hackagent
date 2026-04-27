import { readRecentFeedback, type FeedbackEntry } from "@/lib/erc8004";

export type ReputationSummary = {
  agentId: number;
  count: number;
  avgScore: number;
  distinctClients: number;
  lastTagCounts: Record<string, number>;
  lastEventAt: string | null; // ISO timestamp
  generatedAt: string; // ISO timestamp
};

export async function computeReputationSummary(args: {
  agentId: number;
  windowSize?: number;
}): Promise<ReputationSummary> {
  const window = args.windowSize ?? 200;
  const events = (await readRecentFeedback(window)).filter(
    (e) => Number(e.agentId) === args.agentId,
  );

  const count = events.length;
  const avgScore =
    count === 0
      ? 0
      : Math.round(
          (events.reduce((acc, e) => acc + e.score, 0) / count) * 100,
        ) / 100;
  const distinctClients = new Set(
    events.map((e) => e.client.toLowerCase()),
  ).size;

  const lastTagCounts: Record<string, number> = {};
  for (const e of events) {
    if (!e.tag) continue;
    lastTagCounts[e.tag] = (lastTagCounts[e.tag] ?? 0) + 1;
  }

  const newest: FeedbackEntry | undefined = events.reduce<
    FeedbackEntry | undefined
  >((acc, e) => (acc && acc.ts > e.ts ? acc : e), undefined);
  const lastEventAt = newest ? new Date(newest.ts).toISOString() : null;

  return {
    agentId: args.agentId,
    count,
    avgScore,
    distinctClients,
    lastTagCounts,
    lastEventAt,
    generatedAt: new Date().toISOString(),
  };
}

export function summaryToCompactText(s: ReputationSummary): string {
  // Compressed text-record-friendly JSON. Stable key order.
  const compact = {
    a: s.agentId,
    n: s.count,
    s: s.avgScore,
    c: s.distinctClients,
    t: s.lastTagCounts,
    l: s.lastEventAt,
    g: s.generatedAt,
  };
  return JSON.stringify(compact);
}
