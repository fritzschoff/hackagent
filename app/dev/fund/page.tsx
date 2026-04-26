import { notFound } from "next/navigation";
import { getFundingHubAddress } from "@/lib/funding-hub";
import { CopyAddress } from "./copy-button";

export const dynamic = "force-dynamic";

function isWalletFundEnabled() {
  const v = process.env.NEXT_PUBLIC_ENABLE_WALLET_FUND;
  if (v === "false" || v === "0") return false;
  if (v === "true" || v === "1") return true;
  return process.env.NODE_ENV === "development";
}

export default function DevFundPage() {
  if (!isWalletFundEnabled()) {
    notFound();
  }
  const address = getFundingHubAddress();
  if (!address) {
    return (
      <main className="mx-auto max-w-3xl p-8 space-y-3">
        <h1 className="text-2xl font-bold">Funding hub</h1>
        <p className="text-sm text-(--color-muted)">
          Set FUNDING_HUB_PK (optional dedicated hub) or AGENT_PK in the
          environment so the sink address can be shown.
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl p-8 space-y-6">
      <h1 className="text-2xl font-bold">Funding hub</h1>
      <p className="text-(--color-muted) text-sm leading-relaxed">
        Send testnet funds here, then move what you need to each role wallet
        (or script it). Same address across chains you use (Sepolia,
        Base Sepolia, 0G, etc.): use this EVM address as the recipient
        on each.
      </p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border border-(--color-border) bg-(--color-surface)">
        <code className="text-sm sm:text-base font-mono break-all flex-1">
          {address}
        </code>
        <CopyAddress address={address} />
      </div>
    </main>
  );
}
