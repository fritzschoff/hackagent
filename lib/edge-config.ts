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
  slaBondAddress?: `0x${string}`;
  agentMergerAddress?: `0x${string}`;
  complianceManifestAddress?: `0x${string}`;
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

export type KeeperHubKind =
  | "swap"
  | "heartbeat"
  | "reputation-cache"
  | "compliance-attest"
  | "primary-name"
  | "avatar-sync"
  | "gateway-invalidate";

const ENV_BY_KIND: Record<KeeperHubKind, string> = {
  swap: "KEEPERHUB_WORKFLOW_ID_SWAP",
  heartbeat: "KEEPERHUB_WORKFLOW_ID_HEARTBEAT",
  "reputation-cache": "KEEPERHUB_WORKFLOW_ID_REPUTATION_CACHE",
  "compliance-attest": "KEEPERHUB_WORKFLOW_ID_COMPLIANCE_ATTEST",
  "primary-name": "KEEPERHUB_WORKFLOW_ID_PRIMARY_NAME",
  "avatar-sync": "KEEPERHUB_WORKFLOW_ID_AVATAR_SYNC",
  "gateway-invalidate": "KEEPERHUB_WORKFLOW_ID_GATEWAY_INVALIDATE",
};

const EDGE_KEY_BY_KIND: Record<KeeperHubKind, string> = {
  swap: "keeperhub_workflow_swap",
  heartbeat: "keeperhub_workflow_heartbeat",
  "reputation-cache": "keeperhub_workflow_reputation_cache",
  "compliance-attest": "keeperhub_workflow_compliance_attest",
  "primary-name": "keeperhub_workflow_primary_name",
  "avatar-sync": "keeperhub_workflow_avatar_sync",
  "gateway-invalidate": "keeperhub_workflow_gateway_invalidate",
};

export async function getKeeperHubWorkflowIdByKind(
  kind: KeeperHubKind,
): Promise<string | null> {
  const fromEnv = process.env[ENV_BY_KIND[kind]];
  if (fromEnv) return fromEnv;
  if (!process.env.EDGE_CONFIG) return null;
  try {
    const v = await get<string>(EDGE_KEY_BY_KIND[kind]);
    return v ?? null;
  } catch {
    return null;
  }
}
