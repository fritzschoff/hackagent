import { getRecentKeeperhubRuns, type KeeperhubRunKind } from "@/lib/redis";
import {
  getKeeperHubWorkflowIdByKind,
  getSepoliaAddresses,
} from "@/lib/edge-config";
import {
  AGENT_ENS,
  SEPOLIA_PUBLIC_RESOLVER,
} from "@/lib/ens-constants";
import { buildManifestRoot, TRADEWISE_MANIFEST } from "@/lib/compliance";
import { namehash } from "viem";
import SiteNav from "@/components/site-nav";

export const revalidate = 30;

const SEPOLIA_ETHERSCAN = "https://sepolia.etherscan.io";

type NodeKind = "trigger" | "web3-read" | "web3-write" | "transform" | "conditional" | "webhook";

type RecipeNode = {
  kind: NodeKind;
  title: string;
  /// Lines of `key: value` rendered as a copyable definition list.
  props: Array<{ k: string; v: string; mono?: boolean }>;
  note?: string;
};

type Workflow = {
  kind: KeeperhubRunKind;
  title: string;
  schedule: string;
  description: string;
  envVar: string;
  recipe: RecipeNode[];
};

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

const NODE_LABEL: Record<NodeKind, string> = {
  trigger: "trigger",
  "web3-read": "web3 · read",
  "web3-write": "web3 · write",
  transform: "transform",
  conditional: "conditional",
  webhook: "http · webhook",
};

const NODE_TONE: Record<NodeKind, string> = {
  trigger: "text-(--color-amber)",
  "web3-read": "text-(--color-muted)",
  "web3-write": "text-(--color-accent)",
  transform: "text-(--color-muted)",
  conditional: "text-(--color-muted)",
  webhook: "text-(--color-accent)",
};

export default async function KeeperHubPage() {
  const addresses = await getSepoliaAddresses();
  const reputationRegistry = addresses.reputationRegistry;
  const complianceManifest = addresses.complianceManifestAddress ?? "(deploy ComplianceManifest first)";
  const ensNode = namehash(AGENT_ENS);
  const expectedRoot = buildManifestRoot(TRADEWISE_MANIFEST);
  const webhookBase =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://hackagent-nine.vercel.app";
  const webhookUrl = `${webhookBase}/api/webhooks/keeperhub`;

  const WORKFLOWS: Workflow[] = [
    {
      kind: "heartbeat",
      title: "ens heartbeat",
      schedule: "push from x402 · daily fallback",
      envVar: "KEEPERHUB_WORKFLOW_ID_HEARTBEAT",
      description:
        "writes `last-seen-at` to the agent's ENS text record. fires push-style from /api/a2a/jobs on every paid x402 quote (debounced 5min) — one setText per real activity, not per cron tick. daily 06:00 UTC cron is the still-alive fallback if the agent goes idle.",
      recipe: [
        {
          kind: "trigger",
          title: "cron schedule",
          props: [
            { k: "cron", v: "0 * * * *", mono: true },
            { k: "input.ts", v: "{{$now.timestamp}}", mono: true },
            {
              k: "or webhook",
              v: `POST ${webhookBase}/api/cron/ens-heartbeat`,
              mono: true,
            },
          ],
          note: "either keeperhub's own cron, or call the vercel cron route which forwards to this workflow when the env var is set.",
        },
        {
          kind: "web3-write",
          title: "setText (sepolia)",
          props: [
            { k: "chain", v: "ethereum sepolia (11155111)", mono: false },
            { k: "address", v: SEPOLIA_PUBLIC_RESOLVER, mono: true },
            { k: "function", v: "setText(bytes32,string,string)", mono: true },
            { k: "node", v: ensNode, mono: true },
            { k: "key", v: "last-seen-at", mono: true },
            { k: "value", v: "{{$trigger.input.ts}}", mono: true },
            { k: "signer", v: "PRICEWATCH_PK (deployer wallet)", mono: false },
          ],
          note: "ENS PublicResolver on Sepolia. node = namehash('tradewise.agentlab.eth'). signer must own the ENS subname (deployer pricewatch wallet does).",
        },
        {
          kind: "webhook",
          title: "callback to /api/webhooks/keeperhub",
          props: [
            { k: "method", v: "POST", mono: true },
            { k: "url", v: webhookUrl, mono: true },
            {
              k: "body",
              v: '{"kind":"heartbeat","workflowRunId":"{{$run.id}}","txHash":"{{$step2.txHash}}","summary":"ens last-seen-at updated"}',
              mono: true,
            },
          ],
        },
      ],
    },
    {
      kind: "reputation-cache",
      title: "reputation cache",
      schedule: "push from x402 · daily fallback",
      envVar: "KEEPERHUB_WORKFLOW_ID_REPUTATION_CACHE",
      description:
        "reads ERC-8004 feedbackCount and writes a compact summary into the `reputation-summary` ENS text record. fires push-style from /api/a2a/jobs on every paid x402 quote (debounced 5min). daily 06:00 UTC cron is the still-alive fallback.",
      recipe: [
        {
          kind: "trigger",
          title: "cron schedule",
          props: [
            { k: "cron", v: "0 * * * *", mono: true },
            { k: "input.agentId", v: String(addresses.agentId), mono: true },
          ],
        },
        {
          kind: "web3-read",
          title: "ReputationRegistry.feedbackCount",
          props: [
            { k: "chain", v: "sepolia", mono: false },
            { k: "address", v: reputationRegistry, mono: true },
            {
              k: "function",
              v: "feedbackCount(uint256) view returns (uint256)",
              mono: true,
            },
            { k: "args", v: "[{{$trigger.input.agentId}}]", mono: true },
            { k: "outputAs", v: "$step2.count", mono: true },
          ],
        },
        {
          kind: "transform",
          title: "compose summary string",
          props: [
            {
              k: "expression",
              v: '"feedback=" + $step2.count + " ts=" + $trigger.input.ts',
              mono: true,
            },
            { k: "outputAs", v: "$step3.summary", mono: true },
          ],
        },
        {
          kind: "web3-read",
          title: "ENS PublicResolver.text (idempotency check)",
          props: [
            { k: "address", v: SEPOLIA_PUBLIC_RESOLVER, mono: true },
            {
              k: "function",
              v: "text(bytes32,string) view returns (string)",
              mono: true,
            },
            { k: "args", v: `[${ensNode}, "reputation-summary"]`, mono: true },
            { k: "outputAs", v: "$step4.current", mono: true },
          ],
          note: "skip the write step if $step4.current === $step3.summary — saves gas on quiet hours.",
        },
        {
          kind: "conditional",
          title: "$step4.current !== $step3.summary",
          props: [
            { k: "if false", v: "skip step 6 (and webhook with summary='no-op')", mono: false },
            { k: "if true", v: "continue to setText", mono: false },
          ],
        },
        {
          kind: "web3-write",
          title: "setText reputation-summary",
          props: [
            { k: "address", v: SEPOLIA_PUBLIC_RESOLVER, mono: true },
            { k: "function", v: "setText(bytes32,string,string)", mono: true },
            { k: "node", v: ensNode, mono: true },
            { k: "key", v: "reputation-summary", mono: true },
            { k: "value", v: "{{$step3.summary}}", mono: true },
            { k: "signer", v: "PRICEWATCH_PK", mono: false },
          ],
        },
        {
          kind: "webhook",
          title: "callback",
          props: [
            { k: "url", v: webhookUrl, mono: true },
            {
              k: "body",
              v: '{"kind":"reputation-cache","workflowRunId":"{{$run.id}}","txHash":"{{$step6.txHash}}","summary":"{{$step3.summary}}"}',
              mono: true,
            },
          ],
        },
      ],
    },
    {
      kind: "compliance-attest",
      title: "compliance attest",
      schedule: "every 6h",
      envVar: "KEEPERHUB_WORKFLOW_ID_COMPLIANCE_ATTEST",
      description:
        "re-reads the on-chain manifest root, compares to the expected root passed in by the caller, fires an alarm if they drift. ties issue #6 (compliance) to issue #7 (keeper).",
      recipe: [
        {
          kind: "trigger",
          title: "cron schedule",
          props: [
            { k: "cron", v: "0 */6 * * *", mono: true },
            { k: "input.registry", v: complianceManifest, mono: true },
            { k: "input.agentId", v: String(addresses.agentId), mono: true },
            { k: "input.expectedRoot", v: expectedRoot, mono: true },
          ],
          note: "expectedRoot = keccak256(canonicalJson(TRADEWISE_MANIFEST)) computed off chain. anyone can re-derive it.",
        },
        {
          kind: "web3-read",
          title: "ComplianceManifest.getManifest",
          props: [
            { k: "chain", v: "sepolia", mono: false },
            { k: "address", v: "{{$trigger.input.registry}}", mono: true },
            {
              k: "function",
              v: "getManifest(uint256) view returns (address,bytes32,string,uint256,uint64,uint8,address,uint256,string)",
              mono: true,
            },
            { k: "args", v: "[{{$trigger.input.agentId}}]", mono: true },
            { k: "outputAs", v: "$step2 (manifestRoot at index 1)", mono: true },
          ],
        },
        {
          kind: "conditional",
          title: "$step2[1] === $trigger.input.expectedRoot",
          props: [
            { k: "if true", v: 'webhook summary = "verified"', mono: false },
            {
              k: "if false",
              v: 'webhook summary = "DRIFT detected: " + $step2[1] + " vs " + $trigger.input.expectedRoot',
              mono: false,
            },
          ],
          note: "drift means either the manifest doc was updated without re-committing, or someone overwrote the on-chain root. both demand human attention.",
        },
        {
          kind: "webhook",
          title: "callback",
          props: [
            { k: "url", v: webhookUrl, mono: true },
            {
              k: "body",
              v: '{"kind":"compliance-attest","workflowRunId":"{{$run.id}}","txHash":null,"summary":"{{$step3.summary}}"}',
              mono: true,
            },
          ],
        },
      ],
    },
    // swap-mirror retired: KeeperHub's Turnkey wallet generates invalid
    // EIP-1559 transactions (priorityFee > maxFee), so it never landed
    // a single tx. See docs/keeperhub-feedback.md §3.1.
  ];

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
          KeeperHub schedules and executes the agent&apos;s automations. Each
          workflow card below is a recipe — open KeeperHub&apos;s dashboard,
          create a new workflow, drop in the listed nodes with the exact
          parameters shown, and paste the resulting workflow id back into the
          env var (or Edge Config key). Vercel cron handlers stay as
          fallbacks; the primary execution path is keeper-driven.
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
          value={allRuns[0] ? relativeAge(allRuns[0].ts) : "—"}
          mono
        />
      </section>

      <section className="mt-10 card-flat reveal reveal-3 space-y-3 text-xs leading-relaxed">
        <p className="tag">shared parameters · copy these into every workflow</p>
        <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-y-1.5 font-mono">
          <dt className="tag">webhook url</dt>
          <dd className="break-all">{webhookUrl}</dd>
          <dt className="tag">ens name</dt>
          <dd>{AGENT_ENS}</dd>
          <dt className="tag">ens namehash</dt>
          <dd className="break-all text-(--color-accent)">{ensNode}</dd>
          <dt className="tag">resolver</dt>
          <dd>{SEPOLIA_PUBLIC_RESOLVER}</dd>
          <dt className="tag">reputation registry</dt>
          <dd>{reputationRegistry}</dd>
          <dt className="tag">compliance registry</dt>
          <dd>{complianceManifest}</dd>
          <dt className="tag">expected manifest root</dt>
          <dd className="break-all text-(--color-accent)">{expectedRoot}</dd>
          <dt className="tag">signer wallet</dt>
          <dd>
            PRICEWATCH_PK ·{" "}
            <span className="text-(--color-muted)">
              owns the ENS subname; use it for any setText / setAgentWallet writes
            </span>
          </dd>
        </dl>
      </section>

      <div className="mt-12 space-y-12 reveal reveal-3">
        {WORKFLOWS.map((w, i) => {
          const runs = allRuns.filter((r) => r.kind === w.kind).slice(0, 6);
          const id = idByKind[w.kind];
          const lastTs = lastRunByKind[w.kind];
          return (
            <section key={w.kind}>
              <div className="flex items-baseline gap-5 mb-5">
                <span className="section-marker">§0{i + 1}</span>
                <div>
                  <h2 className="display text-2xl">{w.title}</h2>
                  <p className="tag mt-1">
                    {w.schedule} ·{" "}
                    {id ? (
                      <span className="text-(--color-accent)">configured</span>
                    ) : (
                      <span className="text-(--color-amber)">not configured</span>
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

              <div className="card-flat space-y-4">
                <p className="text-xs text-(--color-muted) leading-relaxed">
                  {w.description}
                </p>
                <p className="text-xs font-mono text-(--color-muted)">
                  env var ·{" "}
                  {id ? (
                    <span className="text-(--color-fg)">{w.envVar} = {id}</span>
                  ) : (
                    <span className="text-(--color-amber)">
                      set {w.envVar} = &lt;workflow id&gt; in vercel + .env.local
                    </span>
                  )}
                </p>

                <div className="pt-3 border-t border-(--color-rule) space-y-3">
                  <p className="tag">recipe · {w.recipe.length} nodes</p>
                  <ol className="space-y-3">
                    {w.recipe.map((n, idx) => (
                      <li key={idx} className="flex gap-3">
                        <span className="display-italic text-base text-(--color-amber) shrink-0 w-7 leading-none pt-1">
                          {idx + 1}.
                        </span>
                        <div className="flex-1 space-y-1.5">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span
                              className={`pill text-[0.65rem] ${NODE_TONE[n.kind]}`}
                            >
                              {NODE_LABEL[n.kind]}
                            </span>
                            <span className="display text-base">
                              {n.title}
                            </span>
                          </div>
                          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-0.5 text-[0.7rem]">
                            {n.props.map((p, j) => (
                              <div key={j} className="contents">
                                <dt className="tag">{p.k}</dt>
                                <dd
                                  className={
                                    p.mono
                                      ? "font-mono break-all text-(--color-fg)"
                                      : "text-(--color-muted)"
                                  }
                                >
                                  {p.v}
                                </dd>
                              </div>
                            ))}
                          </dl>
                          {n.note ? (
                            <p className="text-[0.7rem] text-(--color-muted) italic leading-relaxed">
                              {n.note}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>

                {runs.length > 0 ? (
                  <div className="pt-3 border-t border-(--color-rule)">
                    <p className="tag mb-2">recent runs</p>
                    <ul>
                      {runs.map((r) => (
                        <li
                          key={`${r.workflowRunId}-${r.ts}`}
                          className="flex items-baseline gap-3 py-1.5 border-b border-(--color-rule) last:border-0 font-mono text-xs"
                        >
                          <span className="tag w-20 shrink-0">
                            {relativeAge(r.ts)}
                          </span>
                          <span className="text-(--color-muted) flex-1 truncate">
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
                            <span className="text-(--color-muted)">no tx</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-xs text-(--color-muted) italic pt-3 border-t border-(--color-rule)">
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
