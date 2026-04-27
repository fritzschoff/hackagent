import { getRecentKeeperhubRuns, type KeeperhubRunKind } from "@/lib/redis";
import { getKeeperHubWorkflowIdByKind } from "@/lib/edge-config";
import SiteNav from "@/components/site-nav";

export const revalidate = 30;

const SEPOLIA_ETHERSCAN = "https://sepolia.etherscan.io";

type Workflow = {
  kind: KeeperhubRunKind;
  title: string;
  schedule: string;
  description: string;
};

const WORKFLOWS: Workflow[] = [
  {
    kind: "heartbeat",
    title: "ens heartbeat",
    schedule: "hourly",
    description:
      "writes a `lastSeenAt` timestamp to the agent's ENS text records so the dashboard can show liveness without trusting our cron infra.",
  },
  {
    kind: "reputation-cache",
    title: "reputation cache",
    schedule: "hourly",
    description:
      "reads ERC-8004 feedback count + score, writes a compact summary to the `reputation-summary` ENS text record. one tx, idempotent (skipped when unchanged).",
  },
  {
    kind: "compliance-attest",
    title: "compliance attest",
    schedule: "every 6h",
    description:
      "re-hashes the canonical compliance manifest off chain, reads the on-chain root, fires an alarm if they drift. ties issue #6 to issue #7.",
  },
  {
    kind: "swap",
    title: "swap mirror",
    schedule: "per quote",
    description:
      "every paid x402 quote spawns a workflow that mirrors the swap intent as an on-chain ERC-20 transfer. the original keeperhub usecase, kept as a smoke test.",
  },
];

function relativeAge(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

function shortHex(hex: string): string {
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

export default async function KeeperHubPage() {
  const [allRuns, workflowIds] = await Promise.all([
    getRecentKeeperhubRuns(120),
    Promise.all(
      WORKFLOWS.map(async (w) => ({
        kind: w.kind,
        id: await getKeeperHubWorkflowIdByKind(w.kind),
      })),
    ),
  ]);

  const idByKind = Object.fromEntries(
    workflowIds.map((w) => [w.kind, w.id]),
  ) as Record<KeeperhubRunKind, string | null>;

  const lastRunByKind: Record<KeeperhubRunKind, number | null> = {
    swap: null,
    heartbeat: null,
    "reputation-cache": null,
    "compliance-attest": null,
  };
  for (const run of allRuns) {
    if (lastRunByKind[run.kind] === null) lastRunByKind[run.kind] = run.ts;
  }

  return (
    <main className="mx-auto max-w-5xl px-6 md:px-10 pb-24">
      <SiteNav active="keeperhub" />
      <header className="pt-6 pb-10 border-b-2 border-(--color-fg) reveal reveal-1">
        <p className="tag mb-2">issue #7 · automation gallery</p>
        <h1 className="display text-[clamp(2.25rem,6vw,4rem)] leading-[0.95] tracking-tight">
          keeper{" "}
          <span className="display-italic font-light text-(--color-muted)">
            / hub
          </span>
        </h1>
        <p className="mt-3 text-sm max-w-2xl text-(--color-muted)">
          The agent runs its own infrastructure. Vercel hosts the application;
          KeeperHub schedules and executes the agent&apos;s automations —
          ENS heartbeat, reputation cache, compliance attestation, swap
          mirror. Each workflow is configured in KeeperHub and triggered
          either by KeeperHub&apos;s own scheduler or by user activity.
          Vercel cron handlers stay as fallbacks; the primary execution path
          is keeper-driven.
        </p>
      </header>

      <section className="mt-10 reveal reveal-2 stat-grid">
        <Cell label="workflows" value={String(WORKFLOWS.length)} mono />
        <Cell
          label="configured"
          value={String(workflowIds.filter((w) => w.id).length)}
          mono
          accent
        />
        <Cell label="recent runs" value={String(allRuns.length)} accent />
        <Cell
          label="last run"
          value={
            allRuns[0] ? relativeAge(allRuns[0].ts) : "—"
          }
          mono
        />
      </section>

      <div className="mt-12 space-y-8 reveal reveal-3">
        {WORKFLOWS.map((w, i) => {
          const runs = allRuns.filter((r) => r.kind === w.kind).slice(0, 6);
          const id = idByKind[w.kind];
          const lastTs = lastRunByKind[w.kind];
          return (
            <section key={w.kind}>
              <div className="flex items-baseline gap-5 mb-5">
                <span className="section-marker">
                  §0{i + 1}
                </span>
                <div>
                  <h2 className="display text-2xl">{w.title}</h2>
                  <p className="tag mt-1">
                    {w.schedule} ·{" "}
                    {id ? (
                      <span className="text-(--color-accent)">
                        configured
                      </span>
                    ) : (
                      <span className="text-(--color-amber)">
                        not configured
                      </span>
                    )}
                    {lastTs ? (
                      <span className="text-(--color-muted)">
                        {" "}
                        · last {relativeAge(lastTs)}
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>

              <div className="card-flat space-y-3">
                <p className="text-xs text-(--color-muted) leading-relaxed">
                  {w.description}
                </p>
                {id ? (
                  <p className="text-xs font-mono text-(--color-muted)">
                    workflow id ·{" "}
                    <span className="text-(--color-fg)">{id}</span>
                  </p>
                ) : (
                  <p className="text-xs font-mono text-(--color-amber)">
                    set <code>KEEPERHUB_WORKFLOW_ID_{w.kind.toUpperCase().replace(/-/g, "_")}</code>{" "}
                    or the matching Edge Config key to enable
                  </p>
                )}

                {runs.length > 0 ? (
                  <ul className="pt-2 border-t border-(--color-rule)">
                    {runs.map((r) => (
                      <li
                        key={`${r.workflowRunId}-${r.ts}`}
                        className="flex items-baseline gap-3 py-2 border-b border-(--color-rule) last:border-0 font-mono text-xs"
                      >
                        <span className="tag w-20 shrink-0">
                          {relativeAge(r.ts)}
                        </span>
                        <span className="text-(--color-muted) flex-1">
                          {r.summary ?? r.workflowRunId.slice(0, 18)}
                        </span>
                        {r.txHash ? (
                          <a
                            href={`${SEPOLIA_ETHERSCAN}/tx/${r.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="link"
                          >
                            {shortHex(r.txHash)}
                          </a>
                        ) : (
                          <span className="text-(--color-muted)">
                            no tx
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-(--color-muted) italic pt-2 border-t border-(--color-rule)">
                    no runs recorded yet
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}

function Cell({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: string;
  accent?: boolean;
  mono?: boolean;
}) {
  const valueClass = `${
    mono ? "stat-value-mono" : "stat-value"
  } ${accent ? "stat-value-accent" : ""}`;
  return (
    <div className="stat-cell">
      <div className="stat-label">{label}</div>
      <div className={valueClass}>{value}</div>
    </div>
  );
}
