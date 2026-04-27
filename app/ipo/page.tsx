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
import SiteNav from "@/components/site-nav";

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
    <main className="mx-auto max-w-5xl px-6 md:px-10 pb-24">
      <SiteNav active="ipo" />
      <header className="pt-6 pb-10 border-b-2 border-(--color-fg) reveal reveal-1">
        <p className="tag mb-2">erc-20 revenue share · base sepolia</p>
        <h1 className="display text-[clamp(2.25rem,6vw,4rem)] leading-[0.95] tracking-tight">
          tradewise{" "}
          <span className="display-italic font-light text-(--color-muted)">
            / ipo
          </span>
        </h1>
        <p className="mt-3 text-sm text-(--color-muted) max-w-2xl">
          Tokenized revenue-share. Each <span className="text-(--color-accent)">TRADE</span>{" "}
          token entitles the holder to its pro-rata cut of every x402 USDC
          settlement to the agent. The agent is now publicly tradeable.
        </p>
      </header>

      {ipo === null ? (
        <section className="card-flat mt-10 text-sm text-(--color-muted)">
          IPO contracts not yet deployed or Edge Config missing
          <code className="ml-1">addresses_base_sepolia</code>. Run{" "}
          <code>forge script script/DeployAgentIPO.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast</code>{" "}
          and update Edge Config.
        </section>
      ) : (
        <div className="mt-10 space-y-12 reveal reveal-2">
          <div className="stat-grid">
            <Cell
              label="total supply"
              value={formatShares(ipo.totalSupply)}
              unit="TRADE"
            />
            <Cell
              label="for sale"
              value={formatShares(ipo.saleAvailable)}
              unit="TRADE"
              accent
            />
            <Cell
              label="price / share"
              value={formatUsdc(ipo.pricePerShareUsdc)}
            />
            <Cell
              label="dividends paid"
              value={formatUsdc(ipo.splitterTotalReleased)}
              amber
            />
          </div>

          <section>
            <div className="flex items-baseline gap-5 mb-5">
              <span className="section-marker">§01</span>
              <div>
                <h2 className="display text-2xl">buy &amp; claim</h2>
                <p className="tag mt-1">live primary issuance + dividends</p>
              </div>
            </div>
            <IpoControls
              shares={ipo.shares}
              splitter={ipo.splitter}
              sale={ipo.sale}
              usdc={ipo.usdc}
              pricePerShareUsdc={ipo.pricePerShareUsdc.toString()}
            />
          </section>

          <section>
            <div className="flex items-baseline gap-5 mb-5">
              <span className="section-marker">§02</span>
              <div>
                <h2 className="display text-2xl">splitter receipts</h2>
                <p className="tag mt-1">cumulative since deployment</p>
              </div>
            </div>
            <div className="card-flat space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm font-mono">
                <div>
                  <p className="tag">received</p>
                  <p className="display text-xl mt-1">
                    {formatUsdc(ipo.splitterTotalReceived)}
                  </p>
                </div>
                <div>
                  <p className="tag">paid out</p>
                  <p className="display text-xl mt-1">
                    {formatUsdc(ipo.splitterTotalReleased)}
                  </p>
                </div>
                <div>
                  <p className="tag">awaiting claim</p>
                  <p className="display text-xl mt-1 text-(--color-amber)">
                    {formatUsdc(
                      ipo.splitterTotalReceived - ipo.splitterTotalReleased,
                    )}
                  </p>
                </div>
              </div>
              <p className="text-xs text-(--color-muted) max-w-2xl leading-relaxed pt-3 border-t border-(--color-rule)">
                Once the agent&apos;s x402 <code>payTo</code> is redirected from
                the EOA to the splitter (env{" "}
                <code>X402_PAYOUT_OVERRIDE</code>), every paid quote here adds
                dividends. The math:{" "}
                <em className="display-italic">
                  totalReceived × balanceOf / totalSupply
                </em>{" "}
                is claimable on demand.
              </p>
            </div>
          </section>

          {history.length > 0 ? (
            <section>
              <div className="flex items-baseline gap-5 mb-5">
                <span className="section-marker">§03</span>
                <div>
                  <h2 className="display text-2xl">recent activity</h2>
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
                          e.kind === "purchase"
                            ? "text-(--color-accent)"
                            : "text-(--color-amber)"
                        }
                      >
                        [{e.kind}]
                      </span>
                      <span className="text-(--color-muted)">
                        {e.kind === "purchase"
                          ? `${shortAddr(e.buyer)} bought ${formatShares(e.sharesAmount)} for ${formatUsdc(e.usdcPaid)}`
                          : `${shortAddr(e.holder)} claimed ${formatUsdc(e.amount)}`}
                      </span>
                      <a
                        href={`${BASE_SEPOLIA_BASESCAN}/tx/${e.txHash}`}
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
            </section>
          ) : null}

          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <a
              href={`${BASE_SEPOLIA_BASESCAN}/address/${ipo.shares}`}
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              AgentShares →
            </a>
            <a
              href={`${BASE_SEPOLIA_BASESCAN}/address/${ipo.splitter}`}
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              RevenueSplitter →
            </a>
            <a
              href={`${BASE_SEPOLIA_BASESCAN}/address/${ipo.sale}`}
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              SharesSale →
            </a>
          </div>
        </div>
      )}
    </main>
  );
}

function Cell({
  label,
  value,
  unit,
  accent,
  amber,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
  amber?: boolean;
}) {
  return (
    <div className="stat-cell">
      <div className="stat-label">{label}</div>
      <div
        className={`stat-value ${
          accent
            ? "stat-value-accent"
            : amber
              ? "stat-value-amber"
              : ""
        }`}
      >
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
