import type { Address } from "viem";

export const SEPOLIA_PUBLIC_RESOLVER: Address =
  "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";

export const SEPOLIA_ENS_REGISTRY: Address =
  "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

export const PARENT_ENS = "agentlab.eth";
export const AGENT_SUBNAME = "tradewise";
export const AGENT_ENS = `${AGENT_SUBNAME}.${PARENT_ENS}`;

export const SEPOLIA_IDENTITY_REGISTRY: Address =
  "0x6aF06f682A7Ba7Db32587FDedF51B9190EF738fA";

export const SEPOLIA_REPUTATION_REGISTRY: Address =
  "0x477D6FeFCE87B627a7B2215ee62a4E21fc102BbA";

export const AGENT_ID_DEFAULT = 1;

export function ensip25Key(args: {
  identityRegistry: Address;
  agentId: number;
  chainId: number;
}): string {
  return `agent-registration[eip155:${args.chainId}:${args.identityRegistry}][${args.agentId}]`;
}

export const ENS_TEXT_KEYS = {
  agentCard: "agent-card",
  description: "description",
  url: "url",
  lastSeenAt: "last-seen-at",
  reputationSummary: "reputation-summary",
} as const;

export const RESOLVER_ABI = [
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
] as const;
