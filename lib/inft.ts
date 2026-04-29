import { type Address, type Hex } from "viem";
import { sepoliaPublicClient, sepoliaWalletClient } from "@/lib/wallets";
import type { WalletId } from "@/lib/wallets";
import { getSepoliaAddresses } from "@/lib/edge-config";
import AgentINFTAbi from "@/lib/abis/AgentINFT.json";
import IdentityRegistryV2Abi from "@/lib/abis/IdentityRegistryV2.json";

const ABI = AgentINFTAbi as readonly unknown[];
const REG_ABI = IdentityRegistryV2Abi as readonly unknown[];

export type InftView = {
  tokenId: bigint;
  agentId: bigint;
  owner: Address;
  encryptedMemoryRoot: Hex;
  encryptedMemoryUri: string;
  tokenUri: string;
  agentWallet: Address | null;
  walletCleared: boolean;
  /** True once the oracle has re-encrypted memory for the current owner. */
  memoryReencrypted: boolean;
  /** Number of oracle key rotations (from Redis via /api/inft/oracle/meta). */
  rotations: number;
  /** On-chain VERIFIER() address; null if not yet deployed. */
  verifierAddress: Address | null;
  /** On-chain ORACLE() address; null if not yet deployed. */
  oracleAddress: Address | null;
};

export async function getInftAddresses(): Promise<{
  inft: Address | null;
  identityRegistryV2: Address | null;
}> {
  const v = (await getSepoliaAddresses()) as {
    inftAddress?: Address;
    identityRegistryV2?: Address;
  };
  return {
    inft: v.inftAddress ?? null,
    identityRegistryV2: v.identityRegistryV2 ?? null,
  };
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

function nullIfZero(addr: Address): Address | null {
  return addr.toLowerCase() === ZERO_ADDR ? null : addr;
}

export async function readInft(args: {
  tokenId: bigint;
  inftAddress: Address;
  registryV2Address: Address;
  /** Base URL for internal API calls; defaults to http://localhost:3000 */
  baseUrl?: string;
}): Promise<InftView | null> {
  const client = sepoliaPublicClient();
  try {
    const [owner, root, uri, agentId, tokenUri, memoryReencrypted, verifierRaw, oracleRaw] =
      await Promise.all([
        client.readContract({
          address: args.inftAddress,
          abi: ABI,
          functionName: "ownerOf",
          args: [args.tokenId],
        }) as Promise<Address>,
        client.readContract({
          address: args.inftAddress,
          abi: ABI,
          functionName: "encryptedMemoryRoot",
          args: [args.tokenId],
        }) as Promise<Hex>,
        client.readContract({
          address: args.inftAddress,
          abi: ABI,
          functionName: "encryptedMemoryUri",
          args: [args.tokenId],
        }) as Promise<string>,
        client.readContract({
          address: args.inftAddress,
          abi: ABI,
          functionName: "agentIdOfToken",
          args: [args.tokenId],
        }) as Promise<bigint>,
        client.readContract({
          address: args.inftAddress,
          abi: ABI,
          functionName: "tokenURI",
          args: [args.tokenId],
        }) as Promise<string>,
        client.readContract({
          address: args.inftAddress,
          abi: ABI,
          functionName: "memoryReencrypted",
          args: [args.tokenId],
        }) as Promise<boolean>,
        client.readContract({
          address: args.inftAddress,
          abi: ABI,
          functionName: "VERIFIER",
          args: [],
        }) as Promise<Address>,
        client.readContract({
          address: args.inftAddress,
          abi: ABI,
          functionName: "ORACLE",
          args: [],
        }) as Promise<Address>,
      ]);

    let agentWallet: Address | null = null;
    if (agentId > 0n) {
      const a = (await client.readContract({
        address: args.registryV2Address,
        abi: REG_ABI,
        functionName: "getAgent",
        args: [agentId],
      })) as { agentWallet: Address };
      agentWallet = nullIfZero(a.agentWallet);
    }

    // Fetch rotation counter from the meta route (graceful fallback to 0)
    let rotationCount = 0;
    try {
      const base =
        args.baseUrl ??
        (process.env.NEXT_PUBLIC_BASE_URL
          ? process.env.NEXT_PUBLIC_BASE_URL
          : process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : "http://localhost:3000");
      const metaRes = await fetch(
        `${base}/api/inft/oracle/meta?tokenId=${args.tokenId.toString()}`,
        { next: { revalidate: 30 } },
      );
      if (metaRes.ok) {
        const metaJson = (await metaRes.json()) as { rotations?: number };
        rotationCount = metaJson.rotations ?? 0;
      }
    } catch {
      // Non-fatal — leave at 0
    }

    return {
      tokenId: args.tokenId,
      agentId,
      owner,
      encryptedMemoryRoot: root,
      encryptedMemoryUri: uri,
      tokenUri,
      agentWallet,
      walletCleared: agentWallet === null,
      memoryReencrypted,
      rotations: rotationCount,
      verifierAddress: nullIfZero(verifierRaw),
      oracleAddress: nullIfZero(oracleRaw),
    };
  } catch (err) {
    console.error(
      `[inft] readInft tokenId=${args.tokenId} failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function mintInft(args: {
  inftAddress: Address;
  to: Address;
  agentId: bigint;
  encryptedMemoryRoot: Hex;
  encryptedMemoryUri: string;
  walletId?: WalletId;
}): Promise<{ txHash: Hex } | null> {
  const wallet = sepoliaWalletClient(args.walletId ?? "agent");
  try {
    const txHash = await wallet.writeContract({
      address: args.inftAddress,
      abi: ABI,
      functionName: "mint",
      args: [
        args.to,
        args.agentId,
        args.encryptedMemoryRoot,
        args.encryptedMemoryUri,
      ],
    });
    return { txHash };
  } catch (err) {
    console.error(
      "[inft] mintInft failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Orchestrator: calls /api/inft/transfer/prepare to get a proof,
 * then returns that proof for the caller to use in BIDS.acceptBid(...).
 *
 * The caller is responsible for the wallet tx (`BIDS.acceptBid(tokenId, bidder, proof)`).
 * After the tx mines, call `transferWithProofViaBidsConfirm`.
 */
export async function transferWithProofViaBids(
  tokenId: bigint,
  bidder: Address,
  sellerSig: {
    signature: Hex;
    expiresAt: number;
    nonce: Hex;
  },
  baseUrl?: string,
): Promise<{ proof: Hex; [key: string]: unknown }> {
  const base =
    baseUrl ??
    (process.env.NEXT_PUBLIC_BASE_URL
      ? process.env.NEXT_PUBLIC_BASE_URL
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

  const res = await fetch(`${base}/api/inft/transfer/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenId: tokenId.toString(),
      bidder,
      sellerSig,
    }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
    };
    throw new Error(err.error ?? `prepare-transfer failed: ${res.status}`);
  }

  return res.json() as Promise<{ proof: Hex; [key: string]: unknown }>;
}

/**
 * Confirm step: called after BIDS.acceptBid tx mines.
 * Triggers oracle key rotation and re-encryption.
 */
export async function transferWithProofViaBidsConfirm(
  tokenId: bigint,
  txHash: Hex,
  sellerNonce: Hex,
  baseUrl?: string,
): Promise<void> {
  const base =
    baseUrl ??
    (process.env.NEXT_PUBLIC_BASE_URL
      ? process.env.NEXT_PUBLIC_BASE_URL
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

  const res = await fetch(`${base}/api/inft/transfer/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenId: tokenId.toString(),
      txHash,
      sellerNonce,
    }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
    };
    throw new Error(
      err.error ?? `confirm-transfer failed: ${res.status}`,
    );
  }
}
