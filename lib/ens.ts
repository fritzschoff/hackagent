import { encodeFunctionData, namehash, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { sepoliaPublicClient, sepoliaWalletClient, tryLoadAccount } from "@/lib/wallets";
import { getRedis } from "@/lib/redis";
import {
  AGENT_ENS,
  AGENT_ID_DEFAULT,
  AGENT_SUBNAME,
  ENS_TEXT_KEYS,
  PARENT_ENS,
  RESOLVER_ABI,
  SEPOLIA_IDENTITY_REGISTRY,
  SEPOLIA_PUBLIC_RESOLVER,
  ensip25Key,
} from "@/lib/ens-constants";

export { AGENT_ENS, AGENT_SUBNAME, PARENT_ENS };

export type ResolvedEns = {
  name: string;
  address: Address | null;
  agentCardUrl: string | null;
  registrationRecord: string | null;
  description: string | null;
  url: string | null;
  lastSeenAt: string | null;
  reputationSummary: string | null;
  ensip25Key: string;
};

const CACHE_KEY = `ens:${AGENT_ENS}`;
const CACHE_TTL_SEC = 300;
const HEARTBEAT_INTERVAL_MS = 6 * 60 * 60 * 1000;

const REGISTRATION_KEY = ensip25Key({
  identityRegistry: SEPOLIA_IDENTITY_REGISTRY,
  agentId: AGENT_ID_DEFAULT,
  chainId: sepolia.id,
});

async function readEnsTextSafe(name: string, key: string): Promise<string | null> {
  try {
    const client = sepoliaPublicClient();
    const value = await client.getEnsText({ name, key });
    return value ?? null;
  } catch (err) {
    console.error(
      `[ens] getEnsText name=${name} key=${key} failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function readEnsAddressSafe(name: string): Promise<Address | null> {
  try {
    const client = sepoliaPublicClient();
    const addr = await client.getEnsAddress({ name });
    return addr ?? null;
  } catch (err) {
    console.error(
      `[ens] getEnsAddress name=${name} failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function resolveAgentEns(opts?: {
  bypassCache?: boolean;
}): Promise<ResolvedEns> {
  const redis = getRedis();
  if (!opts?.bypassCache && redis) {
    const cached = await redis.get(CACHE_KEY).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as ResolvedEns;
      } catch {
        // fall through to fresh resolve
      }
    }
  }

  const [
    address,
    agentCardUrl,
    registration,
    description,
    url,
    lastSeen,
    reputationSummary,
  ] = await Promise.all([
    readEnsAddressSafe(AGENT_ENS),
    readEnsTextSafe(AGENT_ENS, ENS_TEXT_KEYS.agentCard),
    readEnsTextSafe(AGENT_ENS, REGISTRATION_KEY),
    readEnsTextSafe(AGENT_ENS, ENS_TEXT_KEYS.description),
    readEnsTextSafe(AGENT_ENS, ENS_TEXT_KEYS.url),
    readEnsTextSafe(AGENT_ENS, ENS_TEXT_KEYS.lastSeenAt),
    readEnsTextSafe(AGENT_ENS, ENS_TEXT_KEYS.reputationSummary),
  ]);

  const resolved: ResolvedEns = {
    name: AGENT_ENS,
    address,
    agentCardUrl,
    registrationRecord: registration,
    description,
    url,
    lastSeenAt: lastSeen,
    reputationSummary,
    ensip25Key: REGISTRATION_KEY,
  };

  if (redis) {
    await redis
      .set(CACHE_KEY, JSON.stringify(resolved), "EX", CACHE_TTL_SEC)
      .catch(() => undefined);
  }

  return resolved;
}

export async function setEnsTextRecord(args: {
  key: string;
  value: string;
}): Promise<{ txHash: Hex } | null> {
  const account = tryLoadAccount("agent");
  if (!account) return null;

  const node = namehash(AGENT_ENS);
  const data = encodeFunctionData({
    abi: RESOLVER_ABI,
    functionName: "setText",
    args: [node, args.key, args.value],
  });

  const wallet = sepoliaWalletClient("agent");
  try {
    const txHash = await wallet.sendTransaction({
      to: SEPOLIA_PUBLIC_RESOLVER,
      data,
    });
    return { txHash };
  } catch (err) {
    console.error(
      `[ens] setText key=${args.key} failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function refreshHeartbeat(): Promise<{
  status: "skipped" | "updated" | "failed";
  txHash?: Hex;
}> {
  const current = await readEnsTextSafe(AGENT_ENS, ENS_TEXT_KEYS.lastSeenAt);
  if (current) {
    const prev = Date.parse(current);
    if (Number.isFinite(prev) && Date.now() - prev < HEARTBEAT_INTERVAL_MS) {
      return { status: "skipped" };
    }
  }

  const result = await setEnsTextRecord({
    key: ENS_TEXT_KEYS.lastSeenAt,
    value: new Date().toISOString(),
  });

  if (!result) return { status: "failed" };

  const redis = getRedis();
  if (redis) await redis.del(CACHE_KEY).catch(() => undefined);

  return { status: "updated", txHash: result.txHash };
}
