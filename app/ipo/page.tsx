import {
  getSepoliaAddresses,
  getBaseSepoliaAddresses,
} from "@/lib/edge-config";
import {
  readIpo,
  readIpoHistory,
  formatUsdc,
  formatShares,
} from "@/lib/ipo";
import IpoControls from "./ipo-controls";

export const revalidate = 30;

const BASE_SEPOLIA_BASESCAN = "https://sepolia.basescan.org";

function shortAddr(addr: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default async function IpoPage() {
  const [, baseAddrs] = await Promise.all([
    getSepoliaAddresses(),
    getBaseSepoliaAddresses(),
  ]);

  const shares = baseAddrs.agentShares;
  const splitter = baseAddrs.revenueSplitter;
  const sale = baseAddrs.sharesSale;
  const usdc = baseAddrs.usdc;

  const ipo =
    shares && splitter && sale && usdc
      ? await readIpo({ shares, splitter, sale, usdc })
      : null;

  const history =
    splitter && sale ? await readIpoHistory({ splitter, sale, limit: 10 }) : [];

  return (
    <main className="mx-auto max-w-4xl p-8 space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          tradewise <span className="text-(--color-muted)">/ ipo</span>
        </h1>
        <p className="text-sm text-(--color-muted)">
          Tokenized revenue-share. Each TRADE token entitles the holder to its
          pro-rata cut of every x402 USDC settlement to the agent. The agent
          is now publicly tradeable. Base Sepolia.
        </p>
      </header>

      {ipo === null ? (
        <section className="border border-(--color-border) rounded-lg p-6 text-sm text-(--color-muted)">
          IPO contracts not yet deployed or Edge Config missing
          <code className="ml-1">addresses_base_sepolia</code>. Run{" "}
          <code>forge script script/DeployAgentIPO.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast</code>{" "}
          and update Edge Config.
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat
              label="total supply"
              value={`${formatShares(ipo.totalSupply)} TRADE`}
            />
            <Stat
              label="for sale"
              value={`${formatShares(ipo.saleAvailable)} TRADE`}
              accent
            />
            <Stat
              label="price"
              value={`${formatUsdc(ipo.pricePerShareUsdc)} / share`}
            />
            <Stat
              label="dividends paid"
              value={formatUsdc(ipo.splitterTotalReleased)}
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-widest text-(--color-muted)">
              buy + claim
            </h2>
            <IpoControls
              shares={ipo.shares}
              splitter={ipo.splitter}
              sale={ipo.sale}
              usdc={ipo.usdc}
              pricePerShareUsdc={ipo.pricePerShareUsdc.toString()}
            />
          </section>

          <section className="border border-(--color-border) rounded-lg p-4 text-xs space-y-2">
            <h2 className="uppercase tracking-widest text-(--color-muted)">
              cumulative splitter receipts
            </h2>
            <div className="font-mono">
              {formatUsdc(ipo.splitterTotalReceived)} received ·{" "}
              {formatUsdc(ipo.splitterTotalReleased)} paid out ·{" "}
              {formatUsdc(
                ipo.splitterTotalReceived - ipo.splitterTotalReleased,
              )}{" "}
              currently sitting in the splitter awaiting claim
            </div>
            <p className="text-(--color-muted)">
              Once the agent&apos;s x402 <code>payTo</code> is redirected from
              the EOA to the splitter (env <code>X402_PAYOUT_OVERRIDE</code>),
              every paid quote here adds dividends. The math: each
              holder&apos;s share of{" "}
              <code>totalReceived × balanceOf / totalSupply</code> is claimable
              on demand.
            </p>
          </section>

          {history.length > 0 ? (
            <section className="border border-(--color-border) rounded-lg p-4 space-y-2">
              <h2 className="text-xs uppercase tracking-widest text-(--color-muted)">
                recent activity
              </h2>
              <ul className="text-xs font-mono space-y-1">
                {history.map((e) => (
                  <li
                    key={e.txHash}
                    className="flex gap-2 items-center text-(--color-muted)"
                  >
                    <span className="text-(--color-accent)">[{e.kind}]</span>
                    <span>
                      {e.kind === "purchase"
                        ? `${shortAddr(e.buyer)} bought ${formatShares(e.sharesAmount)} for ${formatUsdc(e.usdcPaid)}`
                        : `${shortAddr(e.holder)} claimed ${formatUsdc(e.amount)}`}
                    </span>
                    <a
                      href={`${BASE_SEPOLIA_BASESCAN}/tx/${e.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto text-(--color-accent) underline"
                    >
                      tx ↗
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="text-xs text-(--color-muted) space-x-3">
            <a
              href={`${BASE_SEPOLIA_BASESCAN}/address/${ipo.shares}`}
              target="_blank"
              rel="noreferrer"
              className="text-(--color-accent) underline"
            >
              AgentShares ↗
            </a>
            <a
              href={`${BASE_SEPOLIA_BASESCAN}/address/${ipo.splitter}`}
              target="_blank"
              rel="noreferrer"
              className="text-(--color-accent) underline"
            >
              RevenueSplitter ↗
            </a>
            <a
              href={`${BASE_SEPOLIA_BASESCAN}/address/${ipo.sale}`}
              target="_blank"
              rel="noreferrer"
              className="text-(--color-accent) underline"
            >
              SharesSale ↗
            </a>
          </div>
        </>
      )}
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
