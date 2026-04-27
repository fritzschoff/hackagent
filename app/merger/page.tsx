import { getSepoliaAddresses } from "@/lib/edge-config";
import {
  readMergerCount,
  readMergerHistory,
  type MergerLineage,
} from "@/lib/merger";
import SiteNav from "@/components/site-nav";

export const revalidate = 60;

const SEPOLIA_ETHERSCAN = "https://sepolia.etherscan.io";

function shortHex(hex: string): string {
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

export default async function MergerPage() {
  const addresses = await getSepoliaAddresses();
  const mergerAddress = addresses.agentMergerAddress ?? null;

  const [count, history] = mergerAddress
    ? await Promise.all([
        readMergerCount({ mergerAddress }),
        readMergerHistory({ mergerAddress, limit: 20 }),
      ])
    : [0n, [] as MergerLineage[]];

  return (
    <main className="mx-auto max-w-5xl px-6 md:px-10 pb-24">
      <SiteNav active="merger" />
      <header className="pt-6 pb-10 border-b-2 border-(--color-fg) reveal reveal-1">
        <p className="tag mb-2">corporate actions · sepolia</p>
        <h1 className="display text-[clamp(2.25rem,6vw,4rem)] leading-[0.95] tracking-tight">
          tradewise{" "}
          <span className="display-italic font-light text-(--color-muted)">
            / m&amp;a
          </span>
        </h1>
        <p className="mt-3 text-sm text-(--color-muted) max-w-2xl">
          On-chain agent M&amp;A. Two ERC-7857 INFTs combine into a single
          merged agent: source INFTs lock in custody, lineage records the
          constituent IDs + a 0G Storage Merkle root for the combined memory
          blob, and <code>effectiveFeedbackCount(mergedAgentId)</code> oracles
          the sum of constituent reputation. Agents are businesses with
          corporate actions.
        </p>
      </header>

      {mergerAddress === null ? (
        <section className="card-flat mt-10 text-sm text-(--color-muted)">
          AgentMerger not deployed.
        </section>
      ) : (
        <div className="mt-10 space-y-12 reveal reveal-2">
          <div className="stat-grid">
            <Cell label="contract" value={shortHex(mergerAddress)} mono />
            <Cell
              label="recorded mergers"
              value={count.toString()}
              accent
            />
            <Cell
              label="status"
              value={count > 0n ? "lineage live" : "ready"}
              mono
              amber={count === 0n}
            />
          </div>

          {history.length > 0 ? (
            <section>
              <div className="flex items-baseline gap-5 mb-5">
                <span className="section-marker">§01</span>
                <div>
                  <h2 className="display text-2xl">lineage</h2>
                </div>
              </div>
              <div className="space-y-4">
                {history.map((m) => (
                  <LineageCard key={m.mergerIndex.toString()} m={m} />
                ))}
              </div>
            </section>
          ) : (
            <section>
              <div className="flex items-baseline gap-5 mb-5">
                <span className="section-marker">§01</span>
                <div>
                  <h2 className="display text-2xl">how to record a merge</h2>
                </div>
              </div>
              <div className="card-flat">
                <ol className="space-y-2 text-sm text-(--color-muted)">
                  <li className="flex gap-3">
                    <span className="display-italic text-(--color-amber) text-base">i.</span>
                    <span>
                      Mint an ERC-7857 INFT for both source agents (Phase 3{" "}
                      <code className="text-(--color-fg)">scripts/mint-inft.ts</code>).
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="display-italic text-(--color-amber) text-base">ii.</span>
                    <span>
                      Register the merged agent on{" "}
                      <code className="text-(--color-fg)">IdentityRegistryV2</code> via{" "}
                      <code className="text-(--color-fg)">registerByDeployer</code>.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="display-italic text-(--color-amber) text-base">iii.</span>
                    <span>
                      Anchor the combined memory blob to 0G Storage; capture the rootHash.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="display-italic text-(--color-amber) text-base">iv.</span>
                    <span>
                      Hold both source INFTs in one wallet; call{" "}
                      <code className="text-(--color-fg)">setApprovalForAll(mergerContract, true)</code>{" "}
                      on the INFT contract.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="display-italic text-(--color-accent) text-base">v.</span>
                    <span>
                      Call{" "}
                      <code className="text-(--color-fg)">
                        recordMerge(mergedId, src1Id, src1Token, src2Id, src2Token, rootHash)
                      </code>.
                    </span>
                  </li>
                </ol>
              </div>
            </section>
          )}

          <div className="text-xs">
            <a
              href={`${SEPOLIA_ETHERSCAN}/address/${mergerAddress}`}
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              AgentMerger →
            </a>
          </div>
        </div>
      )}
    </main>
  );
}

function LineageCard({ m }: { m: MergerLineage }) {
  return (
    <div className="card font-mono">
      <div className="flex gap-2 items-baseline mb-3">
        <span className="display text-xl">
          merger <span className="display-italic text-(--color-muted)">№{m.mergerIndex.toString()}</span>
        </span>
        <span className="ml-auto tag">
          block {m.mergedAt.toString()}
        </span>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-y-2 text-xs">
        <dt className="tag">merged agentId</dt>
        <dd>#{m.mergedAgentId.toString()}</dd>
        <dt className="tag">source #1</dt>
        <dd>
          agentId #{m.sourceAgentId1.toString()} · tokenId{" "}
          {m.sourceTokenId1.toString()}
        </dd>
        <dt className="tag">source #2</dt>
        <dd>
          agentId #{m.sourceAgentId2.toString()} · tokenId{" "}
          {m.sourceTokenId2.toString()}
        </dd>
        <dt className="tag">memory root</dt>
        <dd className="break-all text-(--color-accent)">{m.sealedMemoryRoot}</dd>
        <dt className="tag">recorded by</dt>
        <dd>{shortHex(m.recordedBy)}</dd>
      </dl>
    </div>
  );
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
  } ${
    accent ? "stat-value-accent" : amber ? "stat-value-amber" : ""
  }`;
  return (
    <div className="stat-cell">
      <div className="stat-label">{label}</div>
      <div className={valueClass}>{value}</div>
    </div>
  );
}
