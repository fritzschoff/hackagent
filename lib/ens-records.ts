import { sepoliaPublicClient } from "@/lib/wallets";

export async function readEnsText(name: string, key: string): Promise<string | null> {
  try {
    const value = await sepoliaPublicClient().getEnsText({
      name,
      key,
    });
    return value;
  } catch (err) {
    console.error(`[ens-records] getEnsText ${name} ${key} failed:`, err);
    return null;
  }
}

export async function readAgentTelemetry(label: string) {
  const [lastSeenAt, rotations, inftTradeable, outstandingBids, reputationSummary] =
    await Promise.all([
      readEnsText(label, "last-seen-at"),
      readEnsText(label, "memory-rotations"),
      readEnsText(label, "inft-tradeable"),
      readEnsText(label, "outstanding-bids"),
      readEnsText(label, "reputation-summary"),
    ]);
  return { lastSeenAt, rotations, inftTradeable, outstandingBids, reputationSummary };
}
