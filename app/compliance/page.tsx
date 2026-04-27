import { getSepoliaAddresses } from "@/lib/edge-config";
import {
  readCompliance,
  readComplianceHistory,
  buildManifestRoot,
  TRADEWISE_MANIFEST,
  formatUsdc,
  type ComplianceEvent,
  type LicenseTier,
} from "@/lib/compliance";
import ComplianceControls from "./compliance-controls";
import SiteNav from "@/components/site-nav";

export const revalidate = 60;

const SEPOLIA_ETHERSCAN = "https://sepolia.etherscan.io";

const LICENSE_LABEL: Record<LicenseTier, string> = {
  "public-api": "public api",
  "paid-api": "paid api",
  "licensed-dataset": "licensed dataset",
  "first-party": "first-party",
  "web-scrape": "web scrape",
};

const LICENSE_TONE: Record<LicenseTier, string> = {
  "public-api": "text-(--color-accent)",
  "paid-api": "text-(--color-fg)",
  "licensed-dataset": "text-(--color-accent)",
  "first-party": "text-(--color-accent)",
  "web-scrape": "text-(--color-amber)",
};

function shortAddr(addr: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortHex(hex: string): string {
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

export default async function CompliancePage() {
  const addresses = await getSepoliaAddresses();
  const registry = addresses.complianceManifestAddress ?? null;
  const usdc = addresses.sepoliaUsdcAddress ?? null;
  const agentId = BigInt(addresses.agentId);

  const expectedRoot = buildManifestRoot(TRADEWISE_MANIFEST);

  const view =
    registry && agentId > 0n
      ? await readCompliance({ registry, agentId })
      : null;

  const history =
    registry && agentId > 0n
      ? await readComplianceHistory({ registry, agentId, limit: 10 })
      : ([] as ComplianceEvent[]);

  const rootMatches =
    view !== null && view.manifestRoot.toLowerCase() === expectedRoot.toLowerCase();

  return (
    <main className="mx-auto max-w-5xl px-6 md:px-10 pb-24">
      <SiteNav active="compliance" />
      <header className="pt-6 pb-10 border-b-2 border-(--color-fg) reveal reveal-1">
        <p className="tag mb-2">issue #6 · sepolia · agent kyc</p>
        <h1 className="display text-[clamp(2.25rem,6vw,4rem)] leading-[0.95] tracking-tight">
          tradewise{" "}
          <span className="display-italic font-light text-(--color-muted)">
            / compliance
          </span>
        </h1>
        <p className="mt-3 text-sm text-(--color-muted) max-w-2xl">
          KYC for AI agents. The agent commits a signed declaration of every
          external data source it touches — URL, ToS hash, license tier — to
          the <code>ComplianceManifest</code> registry. The full doc lives on
          0G Storage; only the keccak256 root is anchored on chain. Anyone
          can read the doc and judge for themselves; anyone can post a USDC
          counter-bond + evidence to challenge.
        </p>
      </header>

      {view === null || registry === null ? (
        <section className="card-flat mt-10 text-sm text-(--color-muted)">
          Compliance registry not yet deployed or Edge Config missing
          <code className="ml-1">complianceManifestAddress</code>.
        </section>
      ) : (
        <div className="mt-10 space-y-12 reveal reveal-2">
          <div className="stat-grid">
            <Cell label="agent" value={`#${agentId}`} mono />
            <Cell label="status" value={view.status} mono accent={view.status === "committed"} amber={view.status === "challenged" || view.status === "slashed"} />
            <Cell label="bond" value={formatUsdc(view.bond)} accent />
            <Cell
              label="root match"
              value={rootMatches ? "verified" : "drift"}
              mono
              accent={rootMatches}
              amber={!rootMatches}
            />
          </div>

          <section>
            <div className="flex items-baseline gap-5 mb-5">
              <span className="section-marker">§01</span>
              <div>
                <h2 className="display text-2xl">declared sources</h2>
                <p className="tag mt-1">
                  {TRADEWISE_MANIFEST.sources.length} entries · keccak root{" "}
                  <span className={rootMatches ? "text-(--color-accent)" : "text-(--color-amber)"}>
                    {shortHex(view.manifestRoot)}
                  </span>
                </p>
              </div>
            </div>
            <div className="space-y-3">
              {TRADEWISE_MANIFEST.sources.map((s, i) => (
                <article key={s.url} className="card font-mono">
                  <header className="flex items-baseline gap-3 mb-2">
                    <span className="section-marker text-base">
                      0{i + 1}.
                    </span>
                    <h3 className="display text-lg">{s.name}</h3>
                    <span
                      className={`ml-auto pill text-[0.7rem] ${LICENSE_TONE[s.license]}`}
                    >
                      {LICENSE_LABEL[s.license]}
                    </span>
                  </header>
                  <dl className="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-y-1 text-xs">
                    <dt className="tag">url</dt>
                    <dd className="break-all">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="link"
                      >
                        {s.url}
                      </a>
                    </dd>
                    <dt className="tag">tos hash</dt>
                    <dd className="text-(--color-muted) break-all">
                      {s.tosHash}
                    </dd>
                    {s.notes ? (
                      <>
                        <dt className="tag">notes</dt>
                        <dd className="text-(--color-muted) leading-relaxed">
                          {s.notes}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                </article>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-baseline gap-5 mb-5">
              <span className="section-marker">§02</span>
              <div>
                <h2 className="display text-2xl">policies</h2>
                <p className="tag mt-1">free-form commitments</p>
              </div>
            </div>
            <div className="card-flat">
              <ol className="space-y-2 text-sm">
                {TRADEWISE_MANIFEST.policies.map((p, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="display-italic text-(--color-amber) text-base shrink-0 w-7">
                      {romanize(i + 1)}.
                    </span>
                    <span className="text-(--color-muted) leading-relaxed">
                      {p}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section>
            <div className="flex items-baseline gap-5 mb-5">
              <span className="section-marker">§03</span>
              <div>
                <h2 className="display text-2xl">on-chain pointers</h2>
              </div>
            </div>
            <div className="card-flat">
              <dl className="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-y-2 text-xs font-mono">
                <dt className="tag">registry</dt>
                <dd>
                  <a
                    href={`${SEPOLIA_ETHERSCAN}/address/${registry}`}
                    target="_blank"
                    rel="noreferrer"
                    className="link"
                  >
                    {shortAddr(registry)}
                  </a>
                </dd>
                <dt className="tag">agent</dt>
                <dd>
                  <a
                    href={`${SEPOLIA_ETHERSCAN}/address/${view.agent}`}
                    target="_blank"
                    rel="noreferrer"
                    className="link"
                  >
                    {shortAddr(view.agent)}
                  </a>
                </dd>
                <dt className="tag">manifest root</dt>
                <dd className="break-all text-(--color-accent)">
                  {view.manifestRoot}
                </dd>
                <dt className="tag">manifest uri</dt>
                <dd className="break-all">{view.manifestUri}</dd>
                {view.status === "challenged" ? (
                  <>
                    <dt className="tag">challenger</dt>
                    <dd>
                      <a
                        href={`${SEPOLIA_ETHERSCAN}/address/${view.challenger}`}
                        target="_blank"
                        rel="noreferrer"
                        className="link"
                      >
                        {shortAddr(view.challenger)}
                      </a>
                    </dd>
                    <dt className="tag">evidence</dt>
                    <dd className="break-all text-(--color-amber)">
                      {view.evidenceUri}
                    </dd>
                    <dt className="tag">challenger bond</dt>
                    <dd>{formatUsdc(view.challengerBond)}</dd>
                  </>
                ) : null}
              </dl>
            </div>
          </section>

          <section>
            <div className="flex items-baseline gap-5 mb-5">
              <span className="section-marker">§04</span>
              <div>
                <h2 className="display text-2xl">actions</h2>
                <p className="tag mt-1">
                  {view.status === "committed"
                    ? "challenge or top-up bond"
                    : view.status === "challenged"
                      ? "awaiting validator resolution"
                      : "no actions available"}
                </p>
              </div>
            </div>
            {usdc ? (
              <ComplianceControls
                registry={registry}
                usdc={usdc}
                agentId={agentId.toString()}
                agentBond={view.bond.toString()}
                challengerBond={view.challengerBond.toString()}
                status={view.status}
              />
            ) : (
              <div className="card-flat text-xs text-(--color-muted)">
                USDC address missing in Edge Config — cannot bond.
              </div>
            )}
          </section>

          {history.length > 0 ? (
            <section>
              <div className="flex items-baseline gap-5 mb-5">
                <span className="section-marker">§05</span>
                <div>
                  <h2 className="display text-2xl">history</h2>
                </div>
              </div>
              <div className="card-flat p-0">
                <ul>
                  {history.map((e) => (
                    <li
                      key={e.txHash}
                      className="flex items-baseline gap-3 px-5 py-3 border-b border-(--color-rule) last:border-0 font-mono text-xs"
                    >
                      <span
                        className={
                          e.kind === "slashed"
                            ? "text-(--color-amber)"
                            : e.kind === "challenged"
                              ? "text-(--color-amber)"
                              : "text-(--color-accent)"
                        }
                      >
                        [{e.kind}]
                      </span>
                      <span className="text-(--color-muted) flex-1">
                        {e.kind === "committed"
                          ? `${shortAddr(e.agent)} root ${shortHex(e.manifestRoot)}`
                          : e.kind === "updated"
                            ? `root ${shortHex(e.manifestRoot)}`
                            : e.kind === "challenged"
                              ? `${shortAddr(e.challenger)} bonded ${formatUsdc(e.challengerBond)}`
                              : `slashed ${formatUsdc(e.challengerReward + e.validatorReward)}`}
                      </span>
                      <a
                        href={`${SEPOLIA_ETHERSCAN}/tx/${e.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="link"
                      >
                        tx →
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}

function romanize(n: number): string {
  return ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][n - 1] ?? `${n}`;
}

function Cell({
  label,
  value,
  accent,
  amber,
  mono,
}: {
  label: string;
  value: string;
  accent?: boolean;
  amber?: boolean;
  mono?: boolean;
}) {
  const valueClass = `${
    mono ? "stat-value-mono" : "stat-value"
  } ${accent ? "stat-value-accent" : amber ? "stat-value-amber" : ""}`;
  return (
    <div className="stat-cell">
      <div className="stat-label">{label}</div>
      <div className={valueClass}>{value}</div>
    </div>
  );
}
