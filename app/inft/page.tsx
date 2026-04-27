import { getSepoliaAddresses } from "@/lib/edge-config";
import { readInft } from "@/lib/inft";
import { AGENT_ENS } from "@/lib/ens";
import { readStandingBids, readBidHistory, formatUsdc } from "@/lib/bids";
import BidControls from "./bid-controls";

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

  const [standingBids, bidHistory] = bidsAddress
    ? await Promise.all([
        readStandingBids({ bidsAddress, tokenId }),
        readBidHistory({ bidsAddress, tokenId, limit: 10 }),
      ])
    : [[], []];

  return (
    <main className="mx-auto max-w-4xl p-8 space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          {AGENT_ENS}{" "}
          <span className="text-(--color-muted)">/ inft</span>
        </h1>
        <p className="text-sm text-(--color-muted)">
          ERC-7857 INFT — the agent itself, transferable. ERC-8004 reputation
          stays attached to <code>agentId</code>; payout wallet is cleared on
          transfer per EIP-8004 §4.4 anti-laundering.
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
        <section className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="token id" value={`#${inft.tokenId}`} />
            <Stat label="agent id" value={`#${inft.agentId}`} />
            <Stat
              label="owner"
              value={shortAddr(inft.owner)}
              href={`${SEPOLIA_ETHERSCAN}/address/${inft.owner}`}
            />
            <Stat
              label="payout"
              value={
                inft.walletCleared
                  ? "cleared"
                  : shortAddr(inft.agentWallet ?? "")
              }
              accent={!inft.walletCleared}
              danger={inft.walletCleared}
            />
          </div>

          <div className="border border-(--color-border) rounded-lg p-4 space-y-3">
            <h2 className="text-xs uppercase tracking-widest text-(--color-muted)">
              encrypted memory (0G Storage)
            </h2>
            <dl className="grid grid-cols-1 gap-2 text-xs font-mono">
              <Row label="merkle root" value={inft.encryptedMemoryRoot} />
              <Row label="og:// uri" value={inft.encryptedMemoryUri} />
              <Row label="tokenURI" value={inft.tokenUri} />
            </dl>
          </div>

          {inft.walletCleared ? (
            <div className="border border-(--color-accent) rounded-lg p-4 text-xs space-y-2">
              <p className="font-semibold text-(--color-accent)">
                payout wallet cleared
              </p>
              <p className="text-(--color-muted)">
                The agent transferred to a new owner. The next x402 settlement
                will revert until the new owner submits an EIP-712-signed{" "}
                <code>setAgentWallet(agentId, newWallet, deadline, sig)</code>{" "}
                to <code>{shortAddr(registryV2)}</code>. ERC-8004 §4.4
                anti-laundering — reputation persists, payouts re-bind.
              </p>
            </div>
          ) : null}

          {bidsAddress && usdcAddress && inftAddress ? (
            <BidControls
              tokenId={tokenId.toString()}
              bidsAddress={bidsAddress}
              inftAddress={inftAddress}
              usdcAddress={usdcAddress}
              inftOwner={inft.owner}
              standingBids={standingBids.map((b) => ({
                bidder: b.bidder,
                amount: b.amount.toString(),
              }))}
            />
          ) : (
            <div className="border border-(--color-border) rounded-lg p-4 text-xs text-(--color-muted)">
              bidding pool not deployed yet — see deployment instructions above
            </div>
          )}

          {bidHistory.length > 0 ? (
            <div className="border border-(--color-border) rounded-lg p-4 space-y-2">
              <h2 className="text-xs uppercase tracking-widest text-(--color-muted)">
                bid history
              </h2>
              <ul className="text-xs font-mono space-y-1">
                {bidHistory.map((e) => (
                  <li
                    key={e.txHash}
                    className="flex gap-2 items-center text-(--color-muted)"
                  >
                    <span
                      className={
                        e.kind === "accepted"
                          ? "text-(--color-accent)"
                          : e.kind === "withdrawn"
                            ? ""
                            : "text-(--color-accent)"
                      }
                    >
                      [{e.kind}]
                    </span>
                    <span>
                      {e.kind === "accepted"
                        ? `${shortAddr(e.bidder)} ← ${shortAddr(e.seller)}`
                        : shortAddr(e.bidder)}
                    </span>
                    <span>{formatUsdc(e.amount)}</span>
                    <a
                      href={`${SEPOLIA_ETHERSCAN}/tx/${e.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto text-(--color-accent) underline"
                    >
                      tx ↗
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="text-xs text-(--color-muted) space-x-3">
            <a
              href={`${SEPOLIA_ETHERSCAN}/address/${inftAddress}`}
              target="_blank"
              rel="noreferrer"
              className="text-(--color-accent) underline"
            >
              INFT contract ↗
            </a>
            <a
              href={`${SEPOLIA_ETHERSCAN}/address/${registryV2}`}
              target="_blank"
              rel="noreferrer"
              className="text-(--color-accent) underline"
            >
              IdentityRegistryV2 ↗
            </a>
            {bidsAddress ? (
              <a
                href={`${SEPOLIA_ETHERSCAN}/address/${bidsAddress}`}
                target="_blank"
                rel="noreferrer"
                className="text-(--color-accent) underline"
              >
                AgentBids ↗
              </a>
            ) : null}
          </div>
        </section>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  accent,
  danger,
  href,
}: {
  label: string;
  value: string;
  accent?: boolean;
  danger?: boolean;
  href?: string;
}) {
  const className = `text-base font-mono ${
    accent
      ? "text-(--color-accent)"
      : danger
        ? "text-red-500"
        : ""
  }`;
  return (
    <div className="border border-(--color-border) rounded-lg p-3">
      <div className="text-xs uppercase tracking-widest text-(--color-muted)">
        {label}
      </div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={`${className} underline`}
        >
          {value}
        </a>
      ) : (
        <div className={className}>{value}</div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="text-(--color-muted) w-24 shrink-0">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  );
}
