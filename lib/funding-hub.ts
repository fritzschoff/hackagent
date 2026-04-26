import { privateKeyToAccount } from "viem/accounts";
import { tryLoadAccount } from "@/lib/wallets";

export function getFundingHubAddress(): `0x${string}` | null {
  const raw = process.env.FUNDING_HUB_PK;
  if (raw) {
    const pk = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
    return privateKeyToAccount(pk).address;
  }
  return tryLoadAccount("agent")?.address ?? null;
}
