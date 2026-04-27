import {
  getRecentJobs,
  getEarningsCents,
  getRecentKeeperhubRuns,
  getRecentPricewatchCalls,
  getPricewatchEarningsCents,
} from "@/lib/redis";
import { getCronStatuses } from "@/lib/cron-auth";
import { readRecentFeedback, readRecentValidations } from "@/lib/erc8004";
import { getSepoliaAddresses } from "@/lib/edge-config";
import { AGENT_ENS, resolveAgentEns } from "@/lib/ens";

export const revalidate = 30;

const AGENT_EOA = "0x7a83678e330a0C565e6272498FFDF421621820A3";
const SEPOLIA_ETHERSCAN = "https://sepolia.etherscan.io";
const BASE_SEPOLIA_BASESCAN = "https://sepolia.basescan.org";
const ENS_APP = `https://sepolia.app.ens.domains/${AGENT_ENS}`;

function relativeAge(iso: string | null): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

export default async function DashboardPage() {
  const [
    jobs,
    earningsCents,
    crons,
    feedback,
    validations,
    addresses,
    khRuns,
    ens,
    pricewatchCalls,
    pricewatchEarningsCents,
  ] = await Promise.all([
    getRecentJobs(50),
    getEarningsCents(),
    getCronStatuses(),
    readRecentFeedback(10),
    readRecentValidations(10),
    getSepoliaAddresses(),
    getRecentKeeperhubRuns(10),
    resolveAgentEns(),
    getRecentPricewatchCalls(10),
    getPricewatchEarningsCents(),
  ]);

  const distinctClients = new Set(feedback.map((f) => f.client.toLowerCase()))
    .size;
  const live =
    jobs.length > 0 && feedback.length > 0 && addresses.agentId > 0;
  const ensResolved = ens.address !== null;
  const heartbeatAge = relativeAge(ens.lastSeenAt);
  const pricewatchActive = pricewatchCalls.length > 0;

  return (
    <main className="mx-auto max-w-5xl p-8 space-y-12">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">
          tradewise<span className="text-(--color-muted)">.agentlab.eth</span>
        </h1>
        <p className="text-(--color-muted) text-sm">
          autonomous on-chain agent · $0.10 / quote · base sepolia
        </p>
        <p className="text-xs flex flex-wrap gap-3 items-center">
          <span
            className={
              ensResolved
                ? "text-(--color-accent)"
                : "text-(--color-muted)"
            }
            title={
              ens.address ?? "ENS not resolved (check SEPOLIA_RPC_URL)"
            }
          >
            ens {ensResolved ? "✓" : "·"}{" "}
            {heartbeatAge ? `(beat ${heartbeatAge})` : "(no heartbeat yet)"}
          </span>
          <a
            href={ENS_APP}
            target="_blank"
            rel="noreferrer"
            className="text-(--color-accent) underline"
          >
            ENS profile ↗
          </a>
          <a
            href={`${SEPOLIA_ETHERSCAN}/address/${addresses.identityRegistry}`}
            target="_blank"
            rel="noreferrer"
            className="text-(--color-accent) underline"
          >
            ERC-8004 IdentityRegistry ↗
          </a>
          <a
            href={`${BASE_SEPOLIA_BASESCAN}/address/${AGENT_EOA}`}
            target="_blank"
            rel="noreferrer"
            className="text-(--color-accent) underline"
          >
            agent wallet (BaseScan) ↗
          </a>
          <a
            href="/.well-known/agent-card.json"
            className="text-(--color-accent) underline"
          >
            agent-card ↗
          </a>
          <a
            href="/inft"
            className="text-(--color-accent) underline"
          >
            inft viewer ↗
          </a>
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Stat
          label="earnings"
          value={`${(earningsCents / 100).toFixed(2)} USDC`}
          accent
        />
        <Stat label="quotes" value={String(jobs.length)} />
        <Stat label="feedback" value={String(feedback.length)} />
        <Stat label="clients" value={String(distinctClients)} />
        <Stat label="kh runs" value={String(khRuns.length)} />
        <Stat label="status" value={live ? "live" : "bootstrapping"} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold uppercase tracking-widest text-(--color-muted)">
          upstream agent — pricewatch.agentlab.eth
        </h2>
        <div className="border border-(--color-border) rounded-lg p-4 space-y-3">
          <p className="text-xs text-(--color-muted)">
            tradewise pays this sidecar agent <code>$0.02</code> per quote in
            x402 USDC for token metadata. each call is two-hop on chain:
            client → tradewise → pricewatch.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat
              label="pw earnings"
              value={`${(pricewatchEarningsCents / 100).toFixed(2)} USDC`}
              accent
            />
            <Stat label="pw calls" value={String(pricewatchCalls.length)} />
            <Stat
              label="pw status"
              value={pricewatchActive ? "active" : "idle"}
            />
            <Stat
              label="pw agentId"
              value={
                addresses.pricewatchAgentId
                  ? String(addresses.pricewatchAgentId)
                  : "—"
              }
            />
          </div>
          {pricewatchCalls.length > 0 ? (
            <ul className="text-xs space-y-1 font-mono">
              {pricewatchCalls.slice(0, 5).map((c) => (
                <li key={c.paymentTx} className="text-(--color-muted)">
                  <span>{c.symbol ?? "?"} </span>
                  <a
                    href={`${BASE_SEPOLIA_BASESCAN}/tx/${c.paymentTx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-(--color-accent) underline"
                  >
                    {c.paymentTx.slice(0, 10)}…
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold uppercase tracking-widest text-(--color-muted)">
          cron heartbeat
        </h2>
        <div className="border border-(--color-border) rounded-lg overflow-hidden">
          {crons.length === 0 ? (
            <p className="p-4 text-sm text-(--color-muted)">
              no cron ticks recorded yet — deploy with{" "}
              <code className="text-(--color-accent)">vercel deploy --prod</code>{" "}
              to activate the scheduler
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-(--color-card)">
                <tr>
                  <th className="text-left p-3 font-medium">route</th>
                  <th className="text-left p-3 font-medium">last tick</th>
                  <th className="text-left p-3 font-medium">status</th>
                </tr>
              </thead>
              <tbody>
                {crons.map((c) => (
                  <tr
                    key={c.route}
                    className="border-t border-(--color-border)"
                  >
                    <td className="p-3 font-mono">{c.route}</td>
                    <td className="p-3 text-(--color-muted)">
                      {c.lastTickAgoSec === null
                        ? "never"
                        : `${c.lastTickAgoSec}s ago`}
                    </td>
                    <td className="p-3">
                      <span
                        className={
                          c.lastStatus === "ok"
                            ? "text-(--color-accent)"
                            : "text-(--color-muted)"
                        }
                      >
                        {c.lastStatus ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold uppercase tracking-widest text-(--color-muted)">
          on-chain reputation (ERC-8004 · sepolia)
        </h2>
        <div className="border border-(--color-border) rounded-lg overflow-hidden">
          {feedback.length === 0 ? (
            <p className="p-4 text-sm text-(--color-muted)">
              no feedback events yet
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-(--color-card)">
                <tr>
                  <th className="text-left p-3 font-medium">client</th>
                  <th className="text-left p-3 font-medium">tag</th>
                  <th className="text-left p-3 font-medium">score</th>
                  <th className="text-left p-3 font-medium">tx</th>
                </tr>
              </thead>
              <tbody>
                {feedback.map((f) => (
                  <tr
                    key={f.txHash}
                    className="border-t border-(--color-border)"
                  >
                    <td className="p-3 font-mono text-xs">
                      {f.client.slice(0, 6)}…{f.client.slice(-4)}
                    </td>
                    <td className="p-3 text-(--color-muted)">{f.tag}</td>
                    <td className="p-3 text-(--color-accent)">{f.score}</td>
                    <td className="p-3">
                      <a
                        href={`${SEPOLIA_ETHERSCAN}/tx/${f.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-(--color-accent) underline font-mono text-xs"
                      >
                        {f.txHash.slice(0, 10)}…
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold uppercase tracking-widest text-(--color-muted)">
          validations (ERC-8004 · sepolia)
        </h2>
        <div className="border border-(--color-border) rounded-lg overflow-hidden">
          {validations.length === 0 ? (
            <p className="p-4 text-sm text-(--color-muted)">
              no validation responses yet
            </p>
          ) : (
            <ul className="divide-y divide-(--color-border)">
              {validations.map((v) => (
                <li
                  key={v.txHash}
                  className="p-3 flex justify-between text-sm font-mono text-xs"
                >
                  <span>
                    job {v.jobId.slice(0, 10)}… by{" "}
                    {v.validator.slice(0, 6)}…
                  </span>
                  <a
                    href={`${SEPOLIA_ETHERSCAN}/tx/${v.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-(--color-accent) underline"
                  >
                    score {v.score} ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold uppercase tracking-widest text-(--color-muted)">
          keeperhub workflow runs (base sepolia)
        </h2>
        <div className="border border-(--color-border) rounded-lg overflow-hidden">
          {khRuns.length === 0 ? (
            <p className="p-4 text-sm text-(--color-muted)">
              no workflow runs yet
            </p>
          ) : (
            <ul className="divide-y divide-(--color-border)">
              {khRuns.map((r) => (
                <li
                  key={r.workflowRunId}
                  className="p-3 flex justify-between text-sm font-mono text-xs"
                >
                  <span>
                    job {r.jobId.slice(0, 8)}… run {r.workflowRunId.slice(0, 8)}…
                  </span>
                  <a
                    href={`${BASE_SEPOLIA_BASESCAN}/tx/${r.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-(--color-accent) underline"
                  >
                    {r.txHash.slice(0, 10)}… ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold uppercase tracking-widest text-(--color-muted)">
          recent jobs
        </h2>
        <div className="border border-(--color-border) rounded-lg overflow-hidden">
          {jobs.length === 0 ? (
            <p className="p-4 text-sm text-(--color-muted)">
              no paid jobs yet — once cron is live, simulated clients post
              every 2-5 minutes
            </p>
          ) : (
            <ul className="divide-y divide-(--color-border)">
              {jobs.map((j) => (
                <li
                  key={j.id}
                  className="p-3 flex justify-between text-sm"
                >
                  <span className="font-mono truncate">
                    {j.intent.tokenIn.slice(0, 6)}…{" "}
                    →{" "}
                    {j.intent.tokenOut.slice(0, 6)}…
                  </span>
                  <span className="flex items-center gap-3">
                    {j.paymentTx && (
                      <a
                        href={`${BASE_SEPOLIA_BASESCAN}/tx/${j.paymentTx}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-(--color-muted) underline font-mono text-xs"
                      >
                        x402 ↗
                      </a>
                    )}
                    <span className="text-(--color-accent)">+0.10 USDC</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <footer className="text-xs text-(--color-muted) pt-8 border-t border-(--color-border) space-y-1">
        <p>
          agentId{" "}
          <span className="font-mono">{addresses.agentId}</span> on Identity
          Registry{" "}
          <a
            href={`${SEPOLIA_ETHERSCAN}/address/${addresses.identityRegistry}`}
            target="_blank"
            rel="noreferrer"
            className="text-(--color-accent) underline font-mono"
          >
            {addresses.identityRegistry.slice(0, 10)}…
          </a>
        </p>
      </footer>
    </main>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="border border-(--color-border) rounded-lg p-5 bg-(--color-card)">
      <div className="text-xs uppercase tracking-widest text-(--color-muted)">
        {label}
      </div>
      <div
        className={`mt-2 text-3xl font-bold ${
          accent ? "text-(--color-accent)" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
