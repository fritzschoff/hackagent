import { getSepoliaAddresses } from "@/lib/edge-config";
import { readInft } from "@/lib/inft";
import { AGENT_ENS } from "@/lib/ens";
import { readStandingBids, readBidHistory, formatUsdc } from "@/lib/bids";
import { readAgentTelemetry } from "@/lib/ens-records";
import BidControls from "./bid-controls";
import SiteNav from "@/components/site-nav";
import MemoryStaleBadge from "@/components/memory-stale-badge";

export const revalidate = 30;

const SEPOLIA_ETHERSCAN = "https://sepolia.etherscan.io";

function shortAddr(addr: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default async function InftPage() {
  const addresses = await getSepoliaAddresses();
  const inftAddress = addresses.inftAddress ?? null;
  const registryV2 = addresses.identityRegistryV2 ?? null;
  const bidsAddress = addresses.agentBidsAddress ?? null;
  const usdcAddress = addresses.sepoliaUsdcAddress ?? null;
  const tokenId = addresses.inftTokenId
    ? BigInt(addresses.inftTokenId)
    : 1n;

  const inft =
    inftAddress && registryV2
      ? await readInft({
          tokenId,
          inftAddress,
          registryV2Address: registryV2,
        })
      : null;

  const [bidsResult, ensTelemetry] = await Promise.all([
    bidsAddress
      ? Promise.all([
          readStandingBids({ bidsAddress, tokenId }),
          readBidHistory({ bidsAddress, tokenId, limit: 10 }),
        ])
      : null,
    readAgentTelemetry("tradewise.agentlab.eth"),
  ]);

  const standingBids = bidsResult ? bidsResult[0] : [];
  const bidHistory = bidsResult ? bidsResult[1] : [];

  return (
    <main className="mx-auto max-w-5xl px-6 md:px-10 pb-24">
      <SiteNav active="inft" />
      <header className="pt-6 pb-10 border-b-2 border-(--color-fg) reveal reveal-1">
        <p className="tag mb-2">erc-7857 inft · sepolia</p>
        <h1 className="display text-[clamp(2.25rem,6vw,4rem)] leading-[0.95] tracking-tight">
          {AGENT_ENS}{" "}
          <span className="display-italic font-light text-(--color-muted)">
            / inft
          </span>
        </h1>
        <p className="mt-3 text-sm text-(--color-muted) max-w-2xl">
          The agent itself, transferable. ERC-8004 reputation stays attached
          to <code>agentId</code>; payout wallet is cleared on transfer per
          EIP-8004 §4.4 anti-laundering.
        </p>
      </header>

      {inft === null ? (
        <section className="border border-(--color-border) rounded-lg p-6 space-y-3">
          <p className="text-sm text-(--color-muted)">
            INFT not deployed yet. To activate this view:
          </p>
          <ol className="text-xs font-mono space-y-1 text-(--color-muted) list-decimal pl-5">
            <li>
              <code>cd contracts && forge script script/DeployINFT.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast</code>
            </li>
            <li>
              <code>pnpm tsx scripts/sync-abis.ts</code>
            </li>
            <li>
              <code>pnpm tsx scripts/write-edge-config.ts sepolia</code> (auto-loads
              from <code>contracts/deployments/sepolia-inft.json</code>)
            </li>
            <li>
              <code>INFT_ADDRESS=&lt;addr&gt; INFT_AGENT_ID=1 pnpm tsx scripts/mint-inft.ts</code>
            </li>
            <li>
              <code>pnpm tsx scripts/write-edge-config.ts sepolia --inft-tokenid=1</code>
            </li>
          </ol>
        </section>
      ) : (
        <section className="mt-10 space-y-12 reveal reveal-2">
          {/* ── Identity cells ── */}
          <div className="stat-grid">
            <Cell label="token id" value={`#${inft.tokenId}`} mono />
            <Cell label="agent id" value={`#${inft.agentId}`} mono />
            <Cell
              label="owner"
              value={shortAddr(inft.owner)}
              mono
              href={`${SEPOLIA_ETHERSCAN}/address/${inft.owner}`}
            />
            <Cell
              label="payout wallet"
              value={
                inft.walletCleared
                  ? "cleared"
                  : shortAddr(inft.agentWallet ?? "")
              }
              mono
              accent={!inft.walletCleared}
              danger={inft.walletCleared}
            />
            <Cell
              label="key rotations"
              value={inft.rotations.toString()}
              mono
            />
          </div>

          {/* ── Stale memory badge ── */}
          <MemoryStaleBadge memoryReencrypted={inft.memoryReencrypted} />

          {/* ── Wallet cleared warning ── */}
          {inft.walletCleared ? (
            <div className="card-flat border-(--color-amber)! p-5 space-y-2">
              <p className="display-italic text-(--color-amber) text-lg">
                payout wallet cleared
              </p>
              <p className="text-xs text-(--color-muted) max-w-2xl leading-relaxed">
                The agent transferred to a new owner. The next x402 settlement
                will revert until the new owner submits an EIP-712-signed{" "}
                <code>setAgentWallet(agentId, newWallet, deadline, sig)</code>{" "}
                to <code>{shortAddr(registryV2)}</code>. ERC-8004 §4.4
                anti-laundering — reputation persists, payouts re-bind.
              </p>
            </div>
          ) : null}

          {/* ── Encrypted memory ── */}
          <div>
            <div className="flex items-baseline gap-5 mb-5">
              <span className="section-marker">§01</span>
              <div>
                <h2 className="display text-2xl">encrypted memory</h2>
                <p className="tag mt-1">0G Storage · turbo testnet</p>
              </div>
            </div>
            <div className="card-flat">
              <dl className="grid grid-cols-1 gap-3 text-xs font-mono">
                <Row label="merkle root" value={inft.encryptedMemoryRoot} />
                <Row label="og:// uri" value={inft.encryptedMemoryUri} />
                <Row label="tokenURI" value={inft.tokenUri} />
                <Row
                  label="memory fresh"
                  value={inft.memoryReencrypted ? "yes" : "stale"}
                />
                <Row
                  label="verifier"
                  value={inft.verifierAddress ? inft.verifierAddress : "not set"}
                />
                <Row
                  label="oracle"
                  value={inft.oracleAddress ? inft.oracleAddress : "not set"}
                />
              </dl>
            </div>
          </div>

          {/* ── ENS gateway telemetry ── */}
          <div>
            <div className="flex items-baseline gap-5 mb-5">
              <span className="section-marker">§02</span>
              <div>
                <h2 className="display text-2xl">live telemetry</h2>
                <p className="tag mt-1">via ENS gateway · W2 CCIP-Read</p>
              </div>
            </div>
            <div className="card-flat">
              <dl className="grid grid-cols-1 gap-3 text-xs font-mono">
                <Row label="rotations" value={ensTelemetry.rotations ?? "—"} />
                <Row label="inft-tradeable" value={ensTelemetry.inftTradeable ?? "—"} />
                <Row label="last-seen-at" value={ensTelemetry.lastSeenAt ?? "—"} />
                <Row label="reputation-summary" value={ensTelemetry.reputationSummary ?? "—"} />
                <Row label="outstanding-bids" value={ensTelemetry.outstandingBids ?? "—"} />
              </dl>
              <p className="mt-3 text-[11px] text-(--color-muted)">
                Records resolved from <code>tradewise.agentlab.eth</code> via the W2 offchain
                resolver (EIP-3668). Values show &quot;—&quot; until the OffchainResolver is deployed
                and <code>agentlab.eth</code>&apos;s resolver slot is flipped (M5).
              </p>
            </div>
          </div>

          {/* ── Bidding ── */}
          <div>
            <div className="flex items-baseline gap-5 mb-5">
              <span className="section-marker">§03</span>
              <div>
                <h2 className="display text-2xl">bidding</h2>
                <p className="tag mt-1">
                  opensea-style standing offers · sepolia USDC
                </p>
              </div>
            </div>

            {standingBids.length > 0 ? (
              <div className="card-flat p-0 mb-4">
                <div className="px-5 py-3 border-b border-(--color-rule) flex items-baseline gap-3">
                  <span className="tag">standing offers</span>
                  <span className="text-xs text-(--color-muted)">
                    {standingBids.length}{" "}
                    active · highest{" "}
                    <span className="text-(--color-accent) display-italic text-base">
                      {formatUsdc(standingBids[0]!.amount)}
                    </span>
                  </span>
                </div>
                <ul>
                  {standingBids.map((b, i) => (
                    <li
                      key={b.bidder}
                      className="flex items-baseline gap-4 px-5 py-3 border-b border-(--color-rule) last:border-0 font-mono text-xs"
                    >
                      <span className="tag w-6 shrink-0">#{i + 1}</span>
                      <a
                        href={`${SEPOLIA_ETHERSCAN}/address/${b.bidder}`}
                        target="_blank"
                        rel="noreferrer"
                        className="link"
                      >
                        {shortAddr(b.bidder)}
                      </a>
                      <span className="ml-auto display-italic text-lg text-(--color-accent)">
                        {formatUsdc(b.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="card-flat mb-4 text-xs text-(--color-muted)">
                no standing offers yet — be the first to bid
              </div>
            )}

            {bidsAddress && usdcAddress && inftAddress ? (
              <BidControls
                tokenId={tokenId.toString()}
                bidsAddress={bidsAddress}
                inftAddress={inftAddress}
                usdcAddress={usdcAddress}
                inftOwner={inft.owner}
                oracleAddress={inft.oracleAddress}
                standingBids={standingBids.map((b) => ({
                  bidder: b.bidder,
                  amount: b.amount.toString(),
                }))}
              />
            ) : (
              <div className="card-flat text-xs text-(--color-muted)">
                bidding pool not deployed yet — see deployment instructions above
              </div>
            )}
          </div>

          {/* ── Bid history ── */}
          {bidHistory.length > 0 ? (
            <div>
              <div className="flex items-baseline gap-5 mb-5">
                <span className="section-marker">§04</span>
                <div>
                  <h2 className="display text-2xl">bid history</h2>
                  <p className="tag mt-1">on-chain audit trail</p>
                </div>
              </div>
              <div className="card-flat p-0">
                <ul>
                  {bidHistory.map((e) => (
                    <li
                      key={e.txHash}
                      className="flex items-baseline gap-3 px-5 py-3 border-b border-(--color-rule) last:border-0 font-mono text-xs"
                    >
                      <span
                        className={
                          e.kind === "accepted"
                            ? "text-(--color-accent)"
                            : e.kind === "withdrawn"
                              ? "text-(--color-amber)"
                              : "text-(--color-accent)"
                        }
                      >
                        [{e.kind}]
                      </span>
                      <span className="text-(--color-muted)">
                        {e.kind === "accepted"
                          ? `${shortAddr(e.bidder)} ← ${shortAddr(e.seller)}`
                          : shortAddr(e.bidder)}
                      </span>
                      <span className="display-italic text-base text-(--color-fg)">
                        {formatUsdc(e.amount)}
                      </span>
                      <a
                        href={`${SEPOLIA_ETHERSCAN}/tx/${e.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto link"
                      >
                        tx →
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {/* ── Contract links ── */}
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <a
              href={`${SEPOLIA_ETHERSCAN}/address/${inftAddress}`}
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              INFT contract →
            </a>
            <a
              href={`${SEPOLIA_ETHERSCAN}/address/${registryV2}`}
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              IdentityRegistryV2 →
            </a>
            {inft.verifierAddress ? (
              <a
                href={`${SEPOLIA_ETHERSCAN}/address/${inft.verifierAddress}`}
                target="_blank"
                rel="noreferrer"
                className="link"
              >
                Verifier →
              </a>
            ) : null}
            {bidsAddress ? (
              <a
                href={`${SEPOLIA_ETHERSCAN}/address/${bidsAddress}`}
                target="_blank"
                rel="noreferrer"
                className="link"
              >
                AgentBids →
              </a>
            ) : null}
          </div>
        </section>
      )}
    </main>
  );
}

function Cell({
  label,
  value,
  accent,
  amber,
  danger,
  mono,
  href,
}: {
  label: string;
  value: string;
  accent?: boolean;
  amber?: boolean;
  danger?: boolean;
  mono?: boolean;
  href?: string;
}) {
  const valueClass = `${
    mono ? "stat-value-mono" : "stat-value"
  } ${
    accent
      ? "stat-value-accent"
      : amber
        ? "stat-value-amber"
        : danger
          ? "text-(--color-amber)"
          : ""
  }`;
  return (
    <div className="stat-cell">
      <div className="stat-label">{label}</div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={`${valueClass} link`}
        >
          {value}
        </a>
      ) : (
        <div className={valueClass}>{value}</div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 items-baseline">
      <dt className="tag w-32 shrink-0">{label}</dt>
      <dd className="break-all text-(--color-fg)">{value}</dd>
    </div>
  );
}
