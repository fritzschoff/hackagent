import { getSepoliaAddresses } from "@/lib/edge-config";
import { readCreditPool, readCreditHistory, formatUsdc } from "@/lib/credit";
import CreditControls from "./credit-controls";

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
    <main className="mx-auto max-w-4xl p-8 space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          tradewise <span className="text-(--color-muted)">/ credit</span>
        </h1>
        <p className="text-sm text-(--color-muted)">
          Uncollateralized USDC borrowing against ERC-8004 reputation. The
          first DeFi primitive built on EIP-8004 — credit limit scales with
          feedback count, liquidation triggers when reputation drops 20% or
          more from borrow time.
        </p>
      </header>

      {view === null ? (
        <section className="border border-(--color-border) rounded-lg p-6 text-sm text-(--color-muted)">
          Credit pool not yet deployed or Edge Config missing
          <code className="ml-1">reputationCreditAddress</code>.
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="pool TVL" value={formatUsdc(view.totalAssets)} accent />
            <Stat label="outstanding" value={formatUsdc(view.totalLent)} />
            <Stat label="free" value={formatUsdc(view.freeLiquidity)} />
            <Stat
              label="agent feedback"
              value={String(view.agentCurrentFeedback)}
            />
          </section>

          <section className="border border-(--color-border) rounded-lg p-4 space-y-2">
            <h2 className="text-xs uppercase tracking-widest text-(--color-muted)">
              tradewise (agentId {addresses.agentId}) credit profile
            </h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-1 text-xs font-mono">
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
              />
            </dl>
            <p className="text-xs text-(--color-muted)">
              Limit formula: <code>min(feedbackCount × $5, pool / 10)</code>.
              Liquidation triggers when current feedback &lt; 80% of borrow-
              time feedback. Defaults are absorbed by lenders pro-rata via
              NAV-per-share writedown — the agent retains the borrowed USDC,
              reputation is the recourse.
            </p>
          </section>

          <CreditControls
            creditAddress={credit!}
            usdcAddress={usdc!}
            agentId={agentId.toString()}
            agentAddress={agentAddress}
            isLiquidatable={view.isLiquidatable}
            hasOpenLoan={view.agentLoan !== null && !view.agentLoan.defaulted}
          />

          {history.length > 0 ? (
            <section className="border border-(--color-border) rounded-lg p-4 space-y-2">
              <h2 className="text-xs uppercase tracking-widest text-(--color-muted)">
                history
              </h2>
              <ul className="text-xs font-mono space-y-1">
                {history.map((e) => (
                  <li
                    key={e.txHash}
                    className="flex gap-2 items-center text-(--color-muted)"
                  >
                    <span
                      className={
                        e.kind === "liquidated"
                          ? "text-red-500"
                          : "text-(--color-accent)"
                      }
                    >
                      [{e.kind}]
                    </span>
                    <span>
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
              href={`${SEPOLIA_ETHERSCAN}/address/${credit}`}
              target="_blank"
              rel="noreferrer"
              className="text-(--color-accent) underline"
            >
              ReputationCredit ↗
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
        className={`text-base font-mono ${accent ? "text-(--color-accent)" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="text-(--color-muted) w-44 shrink-0">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
