import { getSepoliaAddresses } from "@/lib/edge-config";
import { readCreditPool, readCreditHistory, formatUsdc } from "@/lib/credit";
import CreditControls from "./credit-controls";
import SiteNav from "@/components/site-nav";

export const revalidate = 30;

const SEPOLIA_ETHERSCAN = "https://sepolia.etherscan.io";

function shortAddr(addr: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default async function CreditPage() {
  const addresses = await getSepoliaAddresses();
  const credit = addresses.reputationCreditAddress ?? null;
  const usdc = addresses.sepoliaUsdcAddress ?? null;
  const reputationRegistry = addresses.reputationRegistry;
  const agentId = BigInt(addresses.agentId);
  const agentAddress = addresses.agentEOA;

  const view =
    credit && usdc && agentId > 0n
      ? await readCreditPool({
          creditAddress: credit,
          agentId,
          reputationRegistry,
          usdcAddress: usdc,
        })
      : null;

  const history = credit
    ? await readCreditHistory({
        creditAddress: credit,
        agentId,
        limit: 10,
      })
    : [];

  return (
    <main className="mx-auto max-w-5xl px-6 md:px-10 pb-24">
      <SiteNav active="credit" />
      <header className="pt-6 pb-10 border-b-2 border-(--color-fg) reveal reveal-1">
        <p className="tag mb-2">defi primitive · sepolia</p>
        <h1 className="display text-[clamp(2.25rem,6vw,4rem)] leading-[0.95] tracking-tight">
          tradewise{" "}
          <span className="display-italic font-light text-(--color-muted)">
            / credit
          </span>
        </h1>
        <p className="mt-3 text-sm text-(--color-muted) max-w-2xl">
          Uncollateralized USDC borrowing against ERC-8004 reputation. Credit
          limit scales with feedback count; liquidation triggers when
          reputation drops 20% or more from borrow time. Lenders take losses
          via NAV-per-share writedown.
        </p>
      </header>

      {view === null ? (
        <section className="card-flat mt-10 text-sm text-(--color-muted)">
          Credit pool not yet deployed or Edge Config missing
          <code className="ml-1">reputationCreditAddress</code>.
        </section>
      ) : (
        <div className="mt-10 space-y-12 reveal reveal-2">
          <div className="stat-grid">
            <Cell label="pool TVL" value={formatUsdc(view.totalAssets)} accent />
            <Cell label="outstanding" value={formatUsdc(view.totalLent)} />
            <Cell label="free" value={formatUsdc(view.freeLiquidity)} />
            <Cell
              label="agent feedback"
              value={String(view.agentCurrentFeedback)}
            />
          </div>

          <section>
            <div className="flex items-baseline gap-5 mb-5">
              <span className="section-marker">§01</span>
              <div>
                <h2 className="display text-2xl">
                  tradewise credit profile
                </h2>
                <p className="tag mt-1">agentId #{addresses.agentId}</p>
              </div>
            </div>
            <div className="card-flat space-y-3">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-3">
                <Row
                  label="credit limit"
                  value={formatUsdc(view.agentCreditLimit)}
                />
                <Row
                  label="loan principal"
                  value={
                    view.agentLoan
                      ? formatUsdc(view.agentLoan.principal)
                      : "(none)"
                  }
                />
                <Row
                  label="borrowed at feedback"
                  value={
                    view.agentLoan
                      ? String(view.agentLoan.borrowedAtFeedback)
                      : "—"
                  }
                />
                <Row
                  label="status"
                  value={
                    view.agentLoan?.defaulted
                      ? "defaulted"
                      : view.isLiquidatable
                        ? "liquidatable"
                        : view.agentLoan
                          ? "active"
                          : "no loan"
                  }
                  amber={view.isLiquidatable || view.agentLoan?.defaulted}
                />
              </dl>
              <p className="text-xs text-(--color-muted) max-w-2xl leading-relaxed pt-3 border-t border-(--color-rule)">
                Limit formula: <code>min(feedbackCount × $5, pool / 10)</code>.
                Liquidation triggers when current feedback &lt; 80% of
                borrow-time feedback. Defaults are absorbed by lenders pro-rata
                via NAV-per-share writedown — the agent retains the borrowed
                USDC, reputation is the recourse.
              </p>
            </div>
          </section>

          <section>
            <div className="flex items-baseline gap-5 mb-5">
              <span className="section-marker">§02</span>
              <div>
                <h2 className="display text-2xl">actions</h2>
                <p className="tag mt-1">deposit · borrow · repay · liquidate</p>
              </div>
            </div>
            <CreditControls
              creditAddress={credit!}
              usdcAddress={usdc!}
              agentId={agentId.toString()}
              agentAddress={agentAddress}
              isLiquidatable={view.isLiquidatable}
              hasOpenLoan={view.agentLoan !== null && !view.agentLoan.defaulted}
            />
          </section>

          {history.length > 0 ? (
            <section>
              <div className="flex items-baseline gap-5 mb-5">
                <span className="section-marker">§03</span>
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
                          e.kind === "liquidated"
                            ? "text-(--color-amber)"
                            : "text-(--color-accent)"
                        }
                      >
                        [{e.kind}]
                      </span>
                      <span className="text-(--color-muted)">
                        {e.kind === "borrowed"
                          ? `${shortAddr(e.agentAddress)} drew ${formatUsdc(e.amount)}`
                          : e.kind === "repaid"
                            ? `${shortAddr(e.payer)} paid ${formatUsdc(e.amount)}`
                            : `default ${formatUsdc(e.outstanding)} (rep ${e.borrowedAtFeedback}→${e.currentFeedback})`}
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
            </section>
          ) : null}

          <div className="text-xs">
            <a
              href={`${SEPOLIA_ETHERSCAN}/address/${credit}`}
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              ReputationCredit →
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
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="stat-cell">
      <div className="stat-label">{label}</div>
      <div
        className={`stat-value ${accent ? "stat-value-accent" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function Row({ label, value, amber }: { label: string; value: string; amber?: boolean }) {
  return (
    <div className="flex gap-4 items-baseline">
      <dt className="tag w-44 shrink-0">{label}</dt>
      <dd className={`font-mono text-sm ${amber ? "text-(--color-amber)" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
