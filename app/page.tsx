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
import SiteNav from "@/components/site-nav";
import PaginatedList from "@/components/paginated-list";

// Force dynamic — page calls resolveAgentEns() which now reads through the
// W2 CCIP-Read gateway. Static generation can't complete in 60s. Render
// every request, with the existing 30s ENS Redis cache absorbing duplicates.
export const dynamic = "force-dynamic";
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
    getRecentJobs(200),
    getEarningsCents(),
    getCronStatuses(),
    readRecentFeedback(10),
    readRecentValidations(10),
    getSepoliaAddresses(),
    getRecentKeeperhubRuns(200),
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
    <main className="mx-auto max-w-6xl px-6 md:px-10 pb-24">
      <SiteNav active="dashboard" />

      {/* MASTHEAD */}
      <header className="pt-10 pb-12 border-b-2 border-(--color-fg)">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-2 reveal reveal-1">
            <p className="tag">issue 01 · sepolia · base sepolia · 0g galileo</p>
            <h1 className="display text-[clamp(2.75rem,8vw,5.5rem)] leading-[0.92] tracking-tight">
              tradewise
              <span className="display-italic font-light text-(--color-muted)">
                .agentlab.eth
              </span>
            </h1>
            <p className="text-sm max-w-xl text-(--color-muted)">
              an autonomous on-chain agent quoting Uniswap swaps for x402
              USDC. publicly tradeable, reputation-collateralized, sla-bonded.
            </p>
          </div>
          <div className="hidden md:flex flex-col items-end gap-3 text-xs reveal reveal-2">
            <span
              className={live ? "pill pill-live" : "pill pill-idle"}
              title={live ? "earning, validating, anchored" : "warming up"}
            >
              <span className="dot dot-pulse" /> {live ? "live" : "idle"}
            </span>
            <span
              className={ensResolved ? "pill pill-live" : "pill pill-idle"}
            >
              ens {ensResolved ? "✓" : "·"}{" "}
              {heartbeatAge ? `· beat ${heartbeatAge}` : ""}
            </span>
          </div>
        </div>

        <nav className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs reveal reveal-3">
          <a className="link link-amber" href="/docs">
            new here? read the docs →
          </a>
          <a className="link" href={ENS_APP} target="_blank" rel="noreferrer">
            ens profile →
          </a>
          <a
            className="link"
            href={`${SEPOLIA_ETHERSCAN}/address/${addresses.identityRegistry}`}
            target="_blank"
            rel="noreferrer"
          >
            erc-8004 registry →
          </a>
          <a
            className="link"
            href={`${BASE_SEPOLIA_BASESCAN}/address/${AGENT_EOA}`}
            target="_blank"
            rel="noreferrer"
          >
            agent wallet →
          </a>
          <a className="link" href="/.well-known/agent-card.json">
            agent-card.json →
          </a>
        </nav>
      </header>

      {/* PRINCIPAL STATS */}
      <Section number="01" title="principal stats" className="reveal reveal-4">
        <div className="stat-grid">
          <Cell
            label="earnings"
            value={`${(earningsCents / 100).toFixed(2)}`}
            unit="USDC"
            accent
          />
          <Cell label="quotes served" value={String(jobs.length)} />
          <Cell label="feedback" value={String(feedback.length)} />
          <Cell label="distinct clients" value={String(distinctClients)} />
          <Cell label="kh runs" value={String(khRuns.length)} />
          <Cell
            label="status"
            value={live ? "earning" : "idle"}
            mono
            amber={!live}
          />
        </div>
      </Section>

      {/* PRICEWATCH UPSTREAM */}
      <Section
        number="02"
        title="upstream agent"
        sub="pricewatch.agentlab.eth · two-hop x402 economy"
        className="reveal reveal-5"
      >
        <div className="card-flat">
          <p className="text-xs text-(--color-muted) max-w-2xl mb-5 leading-relaxed">
            tradewise pays this sidecar agent <code>$0.02</code> per quote in
            x402 USDC for token metadata. each call is a two-hop chain visible
            on-chain: <em className="display-italic">client → tradewise →
              pricewatch</em>.
          </p>
          <div className="stat-grid">
            <Cell
              label="pw earnings"
              value={`${(pricewatchEarningsCents / 100).toFixed(2)}`}
              unit="USDC"
              accent
            />
            <Cell label="pw calls" value={String(pricewatchCalls.length)} />
            <Cell
              label="pw status"
              value={pricewatchActive ? "active" : "idle"}
              mono
              amber={!pricewatchActive}
            />
            <Cell
              label="pw agentId"
              value={
                addresses.pricewatchAgentId
                  ? `#${addresses.pricewatchAgentId}`
                  : "—"
              }
              mono
            />
          </div>
          {pricewatchCalls.length > 0 ? (
            <ul className="mt-5 space-y-1 text-xs">
              {pricewatchCalls.slice(0, 5).map((c) => (
                <li
                  key={c.paymentTx}
                  className="flex items-baseline gap-3 text-(--color-muted)"
                >
                  <span className="text-(--color-fg)">{c.symbol ?? "?"}</span>
                  <a
                    href={`${BASE_SEPOLIA_BASESCAN}/tx/${c.paymentTx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="link ml-auto"
                  >
                    {c.paymentTx.slice(0, 10)}… →
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Section>

      {/* CRON HEARTBEAT */}
      <Section number="03" title="cron heartbeat" className="reveal reveal-6">
        <div className="card-flat p-0 overflow-hidden">
          {crons.length === 0 ? (
            <p className="p-5 text-sm text-(--color-muted)">
              no cron ticks recorded yet — deploy with{" "}
              <code className="text-(--color-accent)">vercel --prod</code> to
              activate the scheduler
            </p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left tag border-b border-(--color-rule)">
                  <th className="px-5 py-3">route</th>
                  <th className="px-5 py-3">last tick</th>
                  <th className="px-5 py-3 w-24">status</th>
                </tr>
              </thead>
              <tbody>
                {crons.map((c) => (
                  <tr
                    key={c.route}
                    className="border-b border-(--color-rule) text-sm last:border-0"
                  >
                    <td className="px-5 py-3 font-mono text-xs">{c.route}</td>
                    <td className="px-5 py-3 text-(--color-muted) text-xs">
                      {c.lastTickAgoSec === null
                        ? "never"
                        : `${c.lastTickAgoSec}s ago`}
                    </td>
                    <td className="px-5 py-3">
                      {c.lastStatus === "ok" ? (
                        <span className="pill pill-live">
                          <span className="dot" /> ok
                        </span>
                      ) : c.lastStatus === "fail" ? (
                        <span className="pill pill-warn">
                          <span className="dot" /> fail
                        </span>
                      ) : (
                        <span className="pill pill-idle">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Section>

      {/* REPUTATION */}
      <Section
        number="04"
        title="reputation"
        sub="ERC-8004 ReputationRegistry · sepolia"
      >
        <div className="card-flat p-0 overflow-hidden">
          {feedback.length === 0 ? (
            <p className="p-5 text-sm text-(--color-muted)">
              no feedback events yet
            </p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left tag border-b border-(--color-rule)">
                  <th className="px-5 py-3">client</th>
                  <th className="px-5 py-3">tag</th>
                  <th className="px-5 py-3 text-right w-20">score</th>
                  <th className="px-5 py-3 w-32">tx</th>
                </tr>
              </thead>
              <tbody>
                {feedback.map((f) => (
                  <tr
                    key={f.txHash}
                    className="border-b border-(--color-rule) last:border-0 text-sm"
                  >
                    <td className="px-5 py-3 font-mono text-xs">
                      {f.client.slice(0, 6)}…{f.client.slice(-4)}
                    </td>
                    <td className="px-5 py-3 text-(--color-muted) text-xs">
                      {f.tag}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="display text-base text-(--color-accent)">
                        {f.score}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <a
                        href={`${SEPOLIA_ETHERSCAN}/tx/${f.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="link font-mono text-xs"
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
      </Section>

      {/* VALIDATIONS */}
      <Section
        number="05"
        title="validations"
        sub="ERC-8004 ValidationRegistry · sepolia"
      >
        <div className="card-flat p-0">
          {validations.length === 0 ? (
            <p className="p-5 text-sm text-(--color-muted)">
              no validation responses yet
            </p>
          ) : (
            <ul>
              {validations.map((v) => (
                <li
                  key={v.txHash}
                  className="flex items-baseline gap-3 px-5 py-3 border-b border-(--color-rule) last:border-0 font-mono text-xs"
                >
                  <span className="text-(--color-muted)">job</span>
                  <span>{v.jobId.slice(0, 10)}…</span>
                  <span className="text-(--color-muted)">by</span>
                  <span>{v.validator.slice(0, 6)}…</span>
                  <a
                    href={`${SEPOLIA_ETHERSCAN}/tx/${v.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="link ml-auto"
                  >
                    score {v.score} →
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {/* KEEPERHUB RUNS */}
      <Section
        number="06"
        title="keeperhub workflow runs"
        sub="base sepolia"
      >
        <div className="card-flat p-0">
          <PaginatedList
            emptyMessage="no workflow runs yet"
            rows={khRuns.map((r) => ({
              key: `${r.workflowRunId}-${r.ts}`,
              node: (
                <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 items-baseline font-mono text-xs">
                  <span className="tag">{r.kind}</span>
                  <div className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-0.5 break-all">
                    <span className="text-(--color-muted)">job</span>
                    <span>{r.jobId}</span>
                    <span className="text-(--color-muted)">run</span>
                    <span>{r.workflowRunId}</span>
                    {r.summary ? (
                      <>
                        <span className="text-(--color-muted)">summary</span>
                        <span className="text-(--color-muted)">{r.summary}</span>
                      </>
                    ) : null}
                  </div>
                  {r.txHash ? (
                    <a
                      href={`${r.kind === "swap" ? BASE_SEPOLIA_BASESCAN : SEPOLIA_ETHERSCAN}/tx/${r.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="link break-all md:text-right"
                    >
                      {r.txHash} →
                    </a>
                  ) : (
                    <span className="text-(--color-muted) md:text-right">
                      no tx
                    </span>
                  )}
                </div>
              ),
            }))}
          />
        </div>
      </Section>

      {/* RECENT JOBS */}
      <Section number="07" title="recent jobs">
        <div className="card-flat p-0">
          <PaginatedList
            emptyMessage="no paid jobs yet — once cron is live, simulated clients post every 2-5 minutes"
            rows={jobs.map((j) => ({
              key: j.id,
              node: (
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 items-baseline">
                  <div className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-0.5 font-mono text-xs break-all">
                    <span className="text-(--color-muted)">job</span>
                    <span>{j.id}</span>
                    <span className="text-(--color-muted)">tokenIn</span>
                    <span>{j.intent.tokenIn}</span>
                    <span className="text-(--color-muted)">tokenOut</span>
                    <span>{j.intent.tokenOut}</span>
                  </div>
                  {j.paymentTx ? (
                    <a
                      href={`${BASE_SEPOLIA_BASESCAN}/tx/${j.paymentTx}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs link break-all md:text-right"
                    >
                      {j.paymentTx} →
                    </a>
                  ) : (
                    <span className="text-(--color-muted) font-mono text-xs md:text-right">
                      no tx
                    </span>
                  )}
                  <span className="display-italic text-(--color-accent) text-base md:text-right">
                    +0.10 USDC
                  </span>
                </div>
              ),
            }))}
          />
        </div>
      </Section>

    </main>
  );
}

function Section({
  number,
  title,
  sub,
  children,
  className,
}: {
  number: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mt-14 ${className ?? ""}`}>
      <div className="flex items-baseline gap-5 mb-5">
        <span className="section-marker">§{number}</span>
        <div className="flex-1">
          <h2 className="display text-2xl">{title}</h2>
          {sub ? <p className="tag mt-1">{sub}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function Cell({
  label,
  value,
  unit,
  accent,
  amber,
  mono,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
  amber?: boolean;
  mono?: boolean;
}) {
  const valueClass = `${
    mono ? "stat-value-mono" : "stat-value"
  } ${
    accent ? "stat-value-accent" : amber ? "stat-value-amber" : ""
  }`;
  return (
    <div className="stat-cell">
      <div className="stat-label">{label}</div>
      <div className={valueClass}>
        {value}
        {unit ? (
          <span className="ml-1.5 text-xs text-(--color-muted) font-mono">
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
}
