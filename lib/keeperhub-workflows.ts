/**
 * Typed builders for W3 KeeperHub workflow specs.
 *
 * Each builder returns a WorkflowSpec whose nodes/edges match the shape
 * accepted by KeeperHub's create_workflow and update_workflow MCP tools
 * (verified against the existing Heartbeat and Reputation-cache workflows).
 *
 * Integration ID i2ywfgrbbmtpr0hf1xh80 is the "test" Turnkey-managed wallet
 * integration (address 0xB28cCC07F397Af54c89b2Ff06b6c595F282856539).
 * The `signer` field must match the integration name ("test").
 */

export type WorkflowSpec = {
  name: string;
  description: string;
  nodes: unknown[];
  edges: unknown[];
};

// ─── shared constants ────────────────────────────────────────────────────────

const INTEGRATION_ID = "i2ywfgrbbmtpr0hf1xh80";
const SIGNER = "test";
const SEPOLIA_CHAIN_ID = "11155111";
const BASE_SEPOLIA_CHAIN_ID = "84532";

const REVERSE_REGISTRAR_ABI = JSON.stringify([
  {
    type: "function",
    name: "setName",
    stateMutability: "nonpayable",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
]);

const PUBLIC_RESOLVER_SETTEXT_ABI = JSON.stringify([
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
]);

// ─── ENSPrimaryNameSetter ─────────────────────────────────────────────────────

/**
 * Webhook-triggered workflow: receives {wallet, label, chain} and calls
 * ReverseRegistrar.setName(label) on the matching chain.
 *
 * NOTE: The broadcaster is determined by the KeeperHub integration (Turnkey
 * wallet, currently "test" / 0xB28cCC07F397Af54c89b2Ff06b6c595F282856539).
 * ENSPrimaryNameSetter is therefore most useful for the Turnkey-managed wallet
 * (W3 M4 use case). For EOA wallets that hold their own private keys the
 * scripts/setup-primary-names.ts one-shot runner is the right tool.
 *
 * Two parallel write nodes cover Sepolia and Base Sepolia. The `chain` input
 * on the trigger can be inspected by the operator, but KeeperHub does not
 * support conditional branching on trigger inputs, so both chains receive the
 * setName call on every run. This is idempotent (re-running an already-set
 * name is a no-op at the ENS contract level) and acceptable for W3 M4.
 */
export function buildEnsPrimaryNameSetter(args: {
  appUrl: string;
  reverseRegistrarSepolia: `0x${string}`;
  reverseRegistrarBaseSepolia: `0x${string}`;
}): WorkflowSpec {
  const nodes = [
    {
      id: "trigger-webhook",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {
        type: "trigger",
        label: "Webhook Trigger",
        status: "idle",
        config: {
          triggerType: "Webhook",
          input: {
            wallet: "{{$trigger.wallet}}",
            label: "{{$trigger.label}}",
            chain: "{{$trigger.chain}}",
          },
        },
      },
    },
    {
      id: "write-setname-sepolia",
      type: "action",
      position: { x: 400, y: -80 },
      data: {
        type: "action",
        label: "Web3 Write setName (Sepolia)",
        status: "idle",
        config: {
          actionType: "web3/write-contract",
          contractAddress: args.reverseRegistrarSepolia,
          abi: REVERSE_REGISTRAR_ABI,
          useManualAbi: "true",
          abiFunction: "setName",
          functionArgs: JSON.stringify([
            "{{@trigger-webhook:Webhook Trigger.data.label}}",
          ]),
          signer: SIGNER,
          integrationId: INTEGRATION_ID,
          network: SEPOLIA_CHAIN_ID,
          usePrivateMempool: false,
        },
      },
    },
    {
      id: "write-setname-base-sepolia",
      type: "action",
      position: { x: 400, y: 80 },
      data: {
        type: "action",
        label: "Web3 Write setName (Base Sepolia)",
        status: "idle",
        config: {
          actionType: "web3/write-contract",
          contractAddress: args.reverseRegistrarBaseSepolia,
          abi: REVERSE_REGISTRAR_ABI,
          useManualAbi: "true",
          abiFunction: "setName",
          functionArgs: JSON.stringify([
            "{{@trigger-webhook:Webhook Trigger.data.label}}",
          ]),
          signer: SIGNER,
          integrationId: INTEGRATION_ID,
          network: BASE_SEPOLIA_CHAIN_ID,
          usePrivateMempool: false,
        },
      },
    },
    {
      id: "webhook-notify",
      type: "action",
      position: { x: 800, y: 0 },
      data: {
        type: "action",
        label: "Webhook POST (notify app)",
        status: "idle",
        config: {
          actionType: "webhook/send-webhook",
          webhookUrl: `${args.appUrl}/api/webhooks/keeperhub`,
          webhookMethod: "POST",
          webhookHeaders: JSON.stringify({
            "Content-Type": "application/json",
          }),
          webhookPayload: JSON.stringify({
            kind: "primary-name",
            workflowRunId: "{{$run.id}}",
            txHash:
              "{{@write-setname-sepolia:Web3 Write setName (Sepolia).txHash}}",
            label:
              "{{@trigger-webhook:Webhook Trigger.data.label}}",
            wallet:
              "{{@trigger-webhook:Webhook Trigger.data.wallet}}",
          }),
        },
      },
    },
  ];

  const edges = [
    {
      id: "e1",
      type: "animated",
      source: "trigger-webhook",
      target: "write-setname-sepolia",
    },
    {
      id: "e2",
      type: "animated",
      source: "trigger-webhook",
      target: "write-setname-base-sepolia",
    },
    {
      id: "e3",
      type: "animated",
      source: "write-setname-sepolia",
      target: "webhook-notify",
    },
  ];

  return {
    name: "ENSPrimaryNameSetter",
    description:
      "Webhook-triggered. Input: {wallet, label, chain}. Calls ReverseRegistrar.setName(label) on Sepolia + Base Sepolia via the Turnkey-managed wallet integration. Idempotent. Used in W3 M4 to set primary name for keeperhub.agentlab.eth.",
    nodes,
    edges,
  };
}

// ─── ENSAvatarSync ────────────────────────────────────────────────────────────

/**
 * Webhook-triggered workflow: receives {ensName, tokenId, contract, chainId}
 * and calls PublicResolver.setText(node, "avatar", "eip155:11155111/erc721:<contract>/<tokenId>")
 * on the Sepolia PublicResolver.
 *
 * The ENS node is the agentlab.eth namehash, computed from viem.namehash.
 * The avatar value follows the EIP-155 URI format used by ENS off-chain
 * resolvers (EIP-4361 / EIP-3770).
 */
export function buildEnsAvatarSync(args: {
  appUrl: string;
  publicResolverSepolia: `0x${string}`;
  agentlabEthNamehash: `0x${string}`;
  inftAddress: `0x${string}`;
}): WorkflowSpec {
  // Avatar URI template: the tokenId comes from trigger input at runtime.
  // KeeperHub substitutes {{@trigger-webhook:Webhook Trigger.data.tokenId}}.
  const avatarValue = `eip155:${SEPOLIA_CHAIN_ID}/erc721:${args.inftAddress}/{{@trigger-webhook:Webhook Trigger.data.tokenId}}`;

  const nodes = [
    {
      id: "trigger-webhook",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {
        type: "trigger",
        label: "Webhook Trigger",
        status: "idle",
        config: {
          triggerType: "Webhook",
          input: {
            ensName: "{{$trigger.ensName}}",
            tokenId: "{{$trigger.tokenId}}",
            contract: "{{$trigger.contract}}",
            chainId: "{{$trigger.chainId}}",
          },
        },
      },
    },
    {
      id: "write-settext-avatar",
      type: "action",
      position: { x: 400, y: 0 },
      data: {
        type: "action",
        label: "Web3 Write setText avatar",
        status: "idle",
        config: {
          actionType: "web3/write-contract",
          contractAddress: args.publicResolverSepolia,
          abi: PUBLIC_RESOLVER_SETTEXT_ABI,
          useManualAbi: "true",
          abiFunction: "setText",
          functionArgs: JSON.stringify([
            args.agentlabEthNamehash,
            "avatar",
            avatarValue,
          ]),
          signer: SIGNER,
          integrationId: INTEGRATION_ID,
          network: SEPOLIA_CHAIN_ID,
          usePrivateMempool: false,
        },
      },
    },
    {
      id: "webhook-notify",
      type: "action",
      position: { x: 800, y: 0 },
      data: {
        type: "action",
        label: "Webhook POST (notify app)",
        status: "idle",
        config: {
          actionType: "webhook/send-webhook",
          webhookUrl: `${args.appUrl}/api/webhooks/keeperhub`,
          webhookMethod: "POST",
          webhookHeaders: JSON.stringify({
            "Content-Type": "application/json",
          }),
          webhookPayload: JSON.stringify({
            kind: "avatar-sync",
            workflowRunId: "{{$run.id}}",
            txHash:
              "{{@write-settext-avatar:Web3 Write setText avatar.txHash}}",
            ensName:
              "{{@trigger-webhook:Webhook Trigger.data.ensName}}",
            tokenId:
              "{{@trigger-webhook:Webhook Trigger.data.tokenId}}",
          }),
        },
      },
    },
  ];

  const edges = [
    {
      id: "e1",
      type: "animated",
      source: "trigger-webhook",
      target: "write-settext-avatar",
    },
    {
      id: "e2",
      type: "animated",
      source: "write-settext-avatar",
      target: "webhook-notify",
    },
  ];

  return {
    name: "ENSAvatarSync",
    description:
      "Webhook-triggered. Input: {ensName, tokenId, contract, chainId}. Calls PublicResolver.setText(agentlab.eth node, 'avatar', 'eip155:11155111/erc721:<inft>/<tokenId>') on Sepolia. Triggered on INFT mint/transfer events. Broadcaster: PRICEWATCH_PK via Turnkey integration.",
    nodes,
    edges,
  };
}

// ─── GatewayCacheInvalidator ──────────────────────────────────────────────────

/**
 * Webhook-triggered workflow: receives {event, agentId, tokenId, keys[]}
 * and POSTs to /api/ens-gateway/cache/invalidate with bearer auth.
 *
 * No on-chain writes. Pure webhook-to-webhook relay, zero gas.
 */
export function buildGatewayCacheInvalidator(args: {
  appUrl: string;
  webhookSecret: string;
}): WorkflowSpec {
  const nodes = [
    {
      id: "trigger-webhook",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {
        type: "trigger",
        label: "Webhook Trigger",
        status: "idle",
        config: {
          triggerType: "Webhook",
          input: {
            event: "{{$trigger.event}}",
            agentId: "{{$trigger.agentId}}",
            tokenId: "{{$trigger.tokenId}}",
            keys: "{{$trigger.keys}}",
          },
        },
      },
    },
    {
      id: "webhook-invalidate",
      type: "action",
      position: { x: 400, y: 0 },
      data: {
        type: "action",
        label: "Webhook POST (cache invalidate)",
        status: "idle",
        config: {
          actionType: "webhook/send-webhook",
          webhookUrl: `${args.appUrl}/api/ens-gateway/cache/invalidate`,
          webhookMethod: "POST",
          webhookHeaders: JSON.stringify({
            Authorization: `Bearer ${args.webhookSecret}`,
            "Content-Type": "application/json",
          }),
          webhookPayload: JSON.stringify({
            event:
              "{{@trigger-webhook:Webhook Trigger.data.event}}",
            agentId:
              "{{@trigger-webhook:Webhook Trigger.data.agentId}}",
            tokenId:
              "{{@trigger-webhook:Webhook Trigger.data.tokenId}}",
            keys: "{{@trigger-webhook:Webhook Trigger.data.keys}}",
            workflowRunId: "{{$run.id}}",
          }),
        },
      },
    },
  ];

  const edges = [
    {
      id: "e1",
      type: "animated",
      source: "trigger-webhook",
      target: "webhook-invalidate",
    },
  ];

  return {
    name: "GatewayCacheInvalidator",
    description:
      "Webhook-triggered. Input: {event, agentId, tokenId, keys[]}. POSTs to /api/ens-gateway/cache/invalidate with bearer auth to purge stale CCIP-Read gateway cache entries after on-chain events (MemoryReencrypted, MemoryStaled, BidPlaced, etc.). Zero gas.",
    nodes,
    edges,
  };
}
