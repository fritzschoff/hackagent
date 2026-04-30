import { sepoliaPublicClient } from "@/lib/wallets";

const ENS_READ_TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, label: string): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) =>
      setTimeout(() => {
        console.error(`[ens-records] ${label} timed out after ${ENS_READ_TIMEOUT_MS}ms`);
        resolve(null);
      }, ENS_READ_TIMEOUT_MS),
    ),
  ]);
}

export async function readEnsText(name: string, key: string): Promise<string | null> {
  return withTimeout(
    (async () => {
      try {
        const value = await sepoliaPublicClient().getEnsText({ name, key });
        return value;
      } catch (err) {
        console.error(`[ens-records] getEnsText ${name} ${key} failed:`, err);
        return null;
      }
    })(),
    `getEnsText ${name} ${key}`,
  );
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
