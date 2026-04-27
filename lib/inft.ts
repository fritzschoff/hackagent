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

export async function readInft(args: {
  tokenId: bigint;
  inftAddress: Address;
  registryV2Address: Address;
}): Promise<InftView | null> {
  const client = sepoliaPublicClient();
  try {
    const [owner, root, uri, agentId, tokenUri] = await Promise.all([
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
    ]);

    let agentWallet: Address | null = null;
    if (agentId > 0n) {
      const a = (await client.readContract({
        address: args.registryV2Address,
        abi: REG_ABI,
        functionName: "getAgent",
        args: [agentId],
      })) as { agentWallet: Address };
      agentWallet =
        a.agentWallet === "0x0000000000000000000000000000000000000000"
          ? null
          : a.agentWallet;
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
