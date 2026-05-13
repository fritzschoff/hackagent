/**
 * Typed builders for W3 KeeperHub workflow specs.
 *
 * Each builder returns a WorkflowSpec whose nodes/edges match the shape
 * accepted by KeeperHub's create_workflow and update_workflow MCP tools
 * (verified against the existing Heartbeat and Reputation-cache workflows).
 *
 * Integration ID i2ywfgrbbmtpr0hf1xh80 is the "test" Turnkey-managed wallet
 * integration (address 0xB28cC07F397Af54c89b2Ff06b6c595F282856539).
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
 * wallet, currently "test" / 0xB28cC07F397Af54c89b2Ff06b6c595F282856539).
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
      "Webhook-triggered. Input: {event, agentId, tokenId, keys[]}. POSTs to /api/ens-gateway/cache/invalidate with bearer auth to purge stale CCIP-Read gateway cache entries after on-chain events (MemoryReencrypted, MemoryStaled, etc.). Zero gas.",
    nodes,
    edges,
  };
}

// ─── TreasuryKillSwitch ───────────────────────────────────────────────────────

const TREASURY_HEARTBEAT_STALE_ABI = JSON.stringify([
  {
    type: "function",
    name: "heartbeatStale",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
]);

const TREASURY_EMERGENCY_EXIT_ABI = JSON.stringify([
  {
    type: "function",
    name: "emergencyExit",
    stateMutability: "nonpayable",
    inputs: [{ name: "reason", type: "string" }],
    outputs: [],
  },
]);

/**
 * Schedule-triggered dead-man's switch for TradingTreasury (M1).
 *
 * Every hour: read heartbeatStale(); if true, call emergencyExit() to close
 * the open position, pull collateral back, and forward all USDC to the
 * splitter so shareholders can claim. emergencyExit reverts unless the
 * heartbeat is stale, so even a misconfigured Condition node would be
 * gas-only worst case — but the Condition wraps the call anyway so we don't
 * spam revert txs.
 *
 * This workflow is what makes "even if the operator vanishes, shareholders
 * get their capital back" a verifiable claim rather than a marketing line.
 *
 * The Turnkey-signed write does NOT need to be the treasury owner —
 * emergencyExit() is permissionless once heartbeat is stale, so any wallet
 * with Base Sepolia ETH works.
 */
export function buildTreasuryKillSwitch(args: {
  appUrl: string;
  tradingTreasury: `0x${string}`;
}): WorkflowSpec {
  const nodes = [
    {
      id: "trigger-schedule",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {
        type: "trigger",
        label: "Hourly Schedule",
        status: "idle",
        config: {
          triggerType: "Schedule",
          scheduleCron: "0 * * * *",
          scheduleTimezone: "UTC",
        },
      },
    },
    {
      id: "read-stale",
      type: "action",
      position: { x: 320, y: 0 },
      data: {
        type: "action",
        label: "Read heartbeatStale",
        status: "idle",
        config: {
          actionType: "web3/read-contract",
          contractAddress: args.tradingTreasury,
          abi: TREASURY_HEARTBEAT_STALE_ABI,
          useManualAbi: "true",
          abiFunction: "heartbeatStale",
          functionArgs: "[]",
          network: BASE_SEPOLIA_CHAIN_ID,
        },
      },
    },
    {
      id: "cond-stale",
      type: "action",
      position: { x: 640, y: 0 },
      data: {
        type: "action",
        label: "Stale?",
        status: "idle",
        config: {
          actionType: "Condition",
          condition: "{{@read-stale:Read heartbeatStale.result}} === true",
        },
      },
    },
    {
      id: "write-emergency-exit",
      type: "action",
      position: { x: 960, y: -80 },
      data: {
        type: "action",
        label: "Call emergencyExit",
        status: "idle",
        config: {
          actionType: "web3/write-contract",
          contractAddress: args.tradingTreasury,
          abi: TREASURY_EMERGENCY_EXIT_ABI,
          useManualAbi: "true",
          abiFunction: "emergencyExit",
          functionArgs: JSON.stringify(["keeperhub dead-mans-switch"]),
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
      position: { x: 1280, y: -80 },
      data: {
        type: "action",
        label: "Notify app",
        status: "idle",
        config: {
          actionType: "webhook/send-webhook",
          webhookUrl: `${args.appUrl}/api/webhooks/keeperhub`,
          webhookMethod: "POST",
          webhookHeaders: JSON.stringify({
            "Content-Type": "application/json",
          }),
          webhookPayload: JSON.stringify({
            kind: "kill-switch",
            txHash:
              "{{@write-emergency-exit:Call emergencyExit.transactionHash}}",
            summary: "tripped — capital flowing to splitter",
          }),
        },
      },
    },
  ];

  const edges = [
    {
      id: "e1",
      type: "animated",
      source: "trigger-schedule",
      target: "read-stale",
    },
    {
      id: "e2",
      type: "animated",
      source: "read-stale",
      target: "cond-stale",
    },
    {
      id: "e3",
      type: "animated",
      source: "cond-stale",
      sourceHandle: "true",
      target: "write-emergency-exit",
    },
    {
      id: "e4",
      type: "animated",
      source: "write-emergency-exit",
      target: "webhook-notify",
    },
  ];

  return {
    name: "TreasuryKillSwitch",
    description:
      "Schedule-triggered (hourly). Reads TradingTreasury.heartbeatStale(); if true, calls emergencyExit() via the Turnkey integration to close the open position, pull collateral, and forward all USDC to the RevenueSplitter so shareholders can claim. Load-bearing safety primitive: makes 'capital comes home if the operator vanishes' a verifiable property of the deployment.",
    nodes,
    edges,
  };
}

// ─── TreasuryFundingPoll ──────────────────────────────────────────────────────

const EXCHANGE_FUNDING_RATE_ABI = JSON.stringify([
  {
    type: "function",
    name: "fundingRatePerSecond",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "int256" }],
  },
]);

/**
 * Schedule-triggered (every 5 minutes) funding-rate poll.
 *
 * Reads MockPerpExchange.fundingRatePerSecond() on Base Sepolia and pushes
 * the snapshot to /api/keeperhub/funding-poll, which stashes it in Redis
 * for the off-chain agent + dashboard to consume. Decouples timing-critical
 * trading decisions from the agent's own cron so we can iterate on the
 * decision policy without redeploying the agent.
 *
 * In M2 the read source is swapped out for the real Hyperliquid funding
 * endpoint via HTTP Request, but the workflow shape stays identical.
 */
export function buildTreasuryFundingPoll(args: {
  appUrl: string;
  exchange: `0x${string}`;
  webhookSecret: string;
}): WorkflowSpec {
  const nodes = [
    {
      id: "trigger-schedule",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {
        type: "trigger",
        label: "5min Schedule",
        status: "idle",
        config: {
          triggerType: "Schedule",
          scheduleCron: "*/5 * * * *",
          scheduleTimezone: "UTC",
        },
      },
    },
    {
      id: "read-rate",
      type: "action",
      position: { x: 320, y: 0 },
      data: {
        type: "action",
        label: "Read fundingRatePerSecond",
        status: "idle",
        config: {
          actionType: "web3/read-contract",
          contractAddress: args.exchange,
          abi: EXCHANGE_FUNDING_RATE_ABI,
          useManualAbi: "true",
          abiFunction: "fundingRatePerSecond",
          functionArgs: "[]",
          network: BASE_SEPOLIA_CHAIN_ID,
        },
      },
    },
    {
      id: "webhook-snapshot",
      type: "action",
      position: { x: 640, y: 0 },
      data: {
        type: "action",
        label: "POST snapshot",
        status: "idle",
        config: {
          actionType: "webhook/send-webhook",
          webhookUrl: `${args.appUrl}/api/keeperhub/funding-poll`,
          webhookMethod: "POST",
          webhookHeaders: JSON.stringify({
            Authorization: `Bearer ${args.webhookSecret}`,
            "Content-Type": "application/json",
          }),
          webhookPayload: JSON.stringify({
            exchange: args.exchange,
            fundingRatePerSecond:
              "{{@read-rate:Read fundingRatePerSecond.result}}",
            triggeredAt:
              "{{@trigger-schedule:5min Schedule.data.triggeredAt}}",
          }),
        },
      },
    },
  ];

  const edges = [
    {
      id: "e1",
      type: "animated",
      source: "trigger-schedule",
      target: "read-rate",
    },
    {
      id: "e2",
      type: "animated",
      source: "read-rate",
      target: "webhook-snapshot",
    },
  ];

  return {
    name: "TreasuryFundingPoll",
    description:
      "Schedule-triggered (every 5 minutes). Reads MockPerpExchange.fundingRatePerSecond() on Base Sepolia and POSTs the snapshot to /api/keeperhub/funding-poll with bearer auth. The endpoint stashes the rate in Redis for the off-chain agent + dashboard to consume — KeeperHub becomes the bridge between on-chain truth and off-chain decisions. M2 swaps the source from MockPerpExchange to the live Hyperliquid REST endpoint without changing the workflow shape.",
    nodes,
    edges,
  };
}

// ─── TreasuryDividendDistribute ───────────────────────────────────────────────

/**
 * Weekly schedule (Sundays at 00:00 UTC) that triggers a dividend cycle.
 *
 * Calls /api/keeperhub/distribute-dividend with bearer auth. The endpoint
 * reads the treasury's free USDC balance, subtracts the operating reserve,
 * and calls distributeRevenue() from AGENT_PK so the splitter receives the
 * weekly cut for shareholders to claim. The endpoint is the right home
 * for the policy (reserve, min-amount) rather than the workflow node so
 * we can iterate on it without re-pushing the workflow.
 *
 * No on-chain write here; the actual settle happens off-chain in our
 * route, which is the only side that has the agent EOA's private key.
 */
export function buildTreasuryDividendDistribute(args: {
  appUrl: string;
  webhookSecret: string;
}): WorkflowSpec {
  const nodes = [
    {
      id: "trigger-schedule",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {
        type: "trigger",
        label: "Weekly Schedule",
        status: "idle",
        config: {
          triggerType: "Schedule",
          scheduleCron: "0 0 * * 0",
          scheduleTimezone: "UTC",
        },
      },
    },
    {
      id: "webhook-distribute",
      type: "action",
      position: { x: 320, y: 0 },
      data: {
        type: "action",
        label: "POST distribute-dividend",
        status: "idle",
        config: {
          actionType: "webhook/send-webhook",
          webhookUrl: `${args.appUrl}/api/keeperhub/distribute-dividend`,
          webhookMethod: "POST",
          webhookHeaders: JSON.stringify({
            Authorization: `Bearer ${args.webhookSecret}`,
            "Content-Type": "application/json",
          }),
          webhookPayload: JSON.stringify({
            triggeredAt:
              "{{@trigger-schedule:Weekly Schedule.data.triggeredAt}}",
          }),
        },
      },
    },
  ];

  const edges = [
    {
      id: "e1",
      type: "animated",
      source: "trigger-schedule",
      target: "webhook-distribute",
    },
  ];

  return {
    name: "TreasuryDividendDistribute",
    description:
      "Schedule-triggered (weekly, Sundays 00:00 UTC). POSTs to /api/keeperhub/distribute-dividend with bearer auth. The endpoint reads the treasury's free USDC balance and forwards the excess over the operating reserve to the RevenueSplitter via TradingTreasury.distributeRevenue(), so shareholders see a weekly tick of claimable revenue without anyone having to babysit the contract.",
    nodes,
    edges,
  };
}

// ─── generic scheduled GET trigger ────────────────────────────────────────────

/**
 * Schedule → webhook GET wrapper used to migrate cron-driven endpoints
 * off Vercel cron and onto KeeperHub. The webhook hits an internal
 * /api/cron/* endpoint with `Authorization: Bearer ${cronSecret}` — the
 * same header Vercel cron itself sets — so the endpoint's existing
 * `verifyCronAuth` accepts the call without any code change.
 *
 * Putting these on KH gives us KeeperHub's schedule and observability
 * surface for the trading loop, matching the agent's "KH is
 * load-bearing" pitch. The endpoint itself stays exactly where it is.
 */
export function buildScheduledCronTrigger(args: {
  name: string;
  description: string;
  cron: string; // e.g. "*/30 * * * *"
  appUrl: string;
  routePath: string; // e.g. "/api/cron/treasury-heartbeat"
  cronSecret: string;
}): WorkflowSpec {
  const nodes = [
    {
      id: "trigger-schedule",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {
        type: "trigger",
        label: "Schedule",
        status: "idle",
        config: {
          triggerType: "Schedule",
          scheduleCron: args.cron,
          scheduleTimezone: "UTC",
        },
      },
    },
    {
      id: "webhook-call",
      type: "action",
      position: { x: 320, y: 0 },
      data: {
        type: "action",
        label: "Hit cron endpoint",
        status: "idle",
        config: {
          actionType: "webhook/send-webhook",
          webhookUrl: `${args.appUrl}${args.routePath}`,
          webhookMethod: "GET",
          webhookHeaders: JSON.stringify({
            Authorization: `Bearer ${args.cronSecret}`,
          }),
          // GET with no body — KH still requires the field to exist.
          webhookPayload: "",
        },
      },
    },
  ];

  const edges = [
    {
      id: "e1",
      type: "animated",
      source: "trigger-schedule",
      target: "webhook-call",
    },
  ];

  return {
    name: args.name,
    description: args.description,
    nodes,
    edges,
  };
}
