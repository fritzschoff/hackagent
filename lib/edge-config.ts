import { get } from "@vercel/edge-config";
import { zeroAddress } from "viem";

export type AddressMap = {
  identityRegistry: `0x${string}`;
  reputationRegistry: `0x${string}`;
  validationRegistry: `0x${string}`;
  agentEOA: `0x${string}`;
  agentId: number;
  pricewatchEOA?: `0x${string}`;
  pricewatchAgentId?: number;
  identityRegistryV2?: `0x${string}`;
  inftAddress?: `0x${string}`;
  inftAgentId?: number;
  inftTokenId?: number;
  agentBidsAddress?: `0x${string}`;
  sepoliaUsdcAddress?: `0x${string}`;
  reputationCreditAddress?: `0x${string}`;
};

export type BaseSepoliaAddressMap = {
  agentShares?: `0x${string}`;
  revenueSplitter?: `0x${string}`;
  sharesSale?: `0x${string}`;
  pricePerShareUsdc?: number;
  usdc?: `0x${string}`;
};

const STUB: AddressMap = {
  identityRegistry: zeroAddress,
  reputationRegistry: zeroAddress,
  validationRegistry: zeroAddress,
  agentEOA: zeroAddress,
  agentId: 0,
};

export async function getSepoliaAddresses(): Promise<AddressMap> {
  if (!process.env.EDGE_CONFIG) return STUB;
  try {
    const v = await get<AddressMap>("addresses_sepolia");
    return v ?? STUB;
  } catch {
    return STUB;
  }
}

export async function getBaseSepoliaAddresses(): Promise<BaseSepoliaAddressMap> {
  if (!process.env.EDGE_CONFIG) return {};
  try {
    const v = await get<BaseSepoliaAddressMap>("addresses_base_sepolia");
    return v ?? {};
  } catch {
    return {};
  }
}

export async function getKeeperHubWorkflowId(): Promise<string | null> {
  if (process.env.KEEPERHUB_WORKFLOW_ID_SWAP) {
    return process.env.KEEPERHUB_WORKFLOW_ID_SWAP;
  }
  if (!process.env.EDGE_CONFIG) return null;
  try {
    const v = await get<string>("keeperhub_workflow_swap");
    return v ?? null;
  } catch {
    return null;
  }
}
