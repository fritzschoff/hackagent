import { get } from "@vercel/edge-config";
import { zeroAddress } from "viem";

export type AddressMap = {
  identityRegistry: `0x${string}`;
  reputationRegistry: `0x${string}`;
  validationRegistry: `0x${string}`;
  agentEOA: `0x${string}`;
  agentId: number;
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
    const v = await get<AddressMap>("addresses.sepolia");
    return v ?? STUB;
  } catch {
    return STUB;
  }
}

export async function getKeeperHubWorkflowId(): Promise<string | null> {
  if (process.env.KEEPERHUB_WORKFLOW_ID_SWAP) {
    return process.env.KEEPERHUB_WORKFLOW_ID_SWAP;
  }
  if (!process.env.EDGE_CONFIG) return null;
  try {
    const v = await get<string>("keeperhub.workflow.swap");
    return v ?? null;
  } catch {
    return null;
  }
}
