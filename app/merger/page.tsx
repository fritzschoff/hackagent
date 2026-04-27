import { getSepoliaAddresses } from "@/lib/edge-config";
import {
  readMergerCount,
  readMergerHistory,
  type MergerLineage,
} from "@/lib/merger";

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
    <main className="mx-auto max-w-4xl p-8 space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          tradewise <span className="text-(--color-muted)">/ m&amp;a</span>
        </h1>
        <p className="text-sm text-(--color-muted)">
          On-chain agent M&amp;A. Two ERC-7857 INFTs combine into a single
          merged agent: source INFTs lock in custody, lineage records the
          constituent IDs + a 0G Storage Merkle root for the combined memory
          blob, and{" "}
          <code>effectiveFeedbackCount(mergedAgentId)</code> oracles the sum
          of constituent reputation. Agents are businesses with corporate
          actions.
        </p>
      </header>

      {mergerAddress === null ? (
        <section className="border border-(--color-border) rounded-lg p-6 text-sm text-(--color-muted)">
          AgentMerger not deployed.
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Stat label="contract" value={shortHex(mergerAddress)} />
            <Stat label="recorded mergers" value={count.toString()} accent />
            <Stat
              label="status"
              value={count > 0n ? "lineage live" : "ready (no merges yet)"}
            />
          </section>

          {history.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-xs uppercase tracking-widest text-(--color-muted)">
                lineage
              </h2>
              <div className="space-y-3">
                {history.map((m) => (
                  <LineageCard key={m.mergerIndex.toString()} m={m} />
                ))}
              </div>
            </section>
          ) : (
            <section className="border border-(--color-border) rounded-lg p-4 text-xs text-(--color-muted) space-y-2">
              <h2 className="uppercase tracking-widest">how to record a merge</h2>
              <ol className="list-decimal pl-5 space-y-1">
                <li>
                  Mint an ERC-7857 INFT for both source agents (Phase 3{" "}
                  <code>scripts/mint-inft.ts</code>).
                </li>
                <li>
                  Register the merged agent on{" "}
                  <code>IdentityRegistryV2</code> via{" "}
                  <code>registerByDeployer</code>.
                </li>
                <li>
                  Anchor the combined memory blob to 0G Storage; capture the
                  rootHash.
                </li>
                <li>
                  Hold both source INFTs in one wallet; call{" "}
                  <code>setApprovalForAll(mergerContract, true)</code> on the
                  INFT contract.
                </li>
                <li>
                  Call <code>recordMerge(mergedId, src1Id, src1Token, src2Id,
                  src2Token, rootHash)</code>.
                </li>
              </ol>
            </section>
          )}

          <div className="text-xs text-(--color-muted) space-x-3">
            <a
              href={`${SEPOLIA_ETHERSCAN}/address/${mergerAddress}`}
              target="_blank"
              rel="noreferrer"
              className="text-(--color-accent) underline"
            >
              AgentMerger ↗
            </a>
          </div>
        </>
      )}
    </main>
  );
}

function LineageCard({ m }: { m: MergerLineage }) {
  return (
    <div className="border border-(--color-border) rounded-lg p-4 text-xs font-mono space-y-1">
      <div className="flex gap-2 items-baseline">
        <span className="uppercase tracking-widest text-(--color-muted)">
          merger #{m.mergerIndex.toString()}
        </span>
        <span className="ml-auto text-(--color-muted)">
          block {m.mergedAt.toString()}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <span className="text-(--color-muted)">merged agentId</span>
        <span>{m.mergedAgentId.toString()}</span>
        <span className="text-(--color-muted)">source #1</span>
        <span>
          agentId {m.sourceAgentId1.toString()}, tokenId{" "}
          {m.sourceTokenId1.toString()}
        </span>
        <span className="text-(--color-muted)">source #2</span>
        <span>
          agentId {m.sourceAgentId2.toString()}, tokenId{" "}
          {m.sourceTokenId2.toString()}
        </span>
        <span className="text-(--color-muted)">memory root</span>
        <span className="break-all">{m.sealedMemoryRoot}</span>
        <span className="text-(--color-muted)">recorded by</span>
        <span>{shortHex(m.recordedBy)}</span>
      </div>
    </div>
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
    <div className="border border-(--color-border) rounded-lg p-3">
      <div className="text-xs uppercase tracking-widest text-(--color-muted)">
        {label}
      </div>
      <div
        className={`text-base font-mono ${
          accent ? "text-(--color-accent)" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
