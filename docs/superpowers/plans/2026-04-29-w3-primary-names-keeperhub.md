# W3 — ENSIP-19 primary names + KeeperHub orchestration plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set ENSIP-19 multichain primary names for every wallet we own (agent EOA, pricewatch deployer, KeeperHub Turnkey, validator) on both Sepolia and Base Sepolia. Then restructure KeeperHub: add 4 new workflows (`ENSPrimaryNameSetter`, `ENSAvatarSync`, `GatewayCacheInvalidator`, `OnboardAgent`) and delete the 2 obsolete ones (`Heartbeat`, `ReputationCache`) now that W2's CCIP-Read gateway serves their data live.

**Architecture:** No new contracts. Uses Sepolia + Base Sepolia ReverseRegistrar contracts (canonical addresses from ENS docs). Forward `addr(name)` resolution is handled dynamically by the W2 gateway — we only need to write reverse records. KeeperHub workflow `ENSPrimaryNameSetter` is the workhorse: input `{wallet, label, chains[]}`, output a setName tx per chain, idempotent (re-run skips matching records). Other new workflows trigger off webhooks from our app's API routes (`ENSAvatarSync` on INFT mint/transfer, `GatewayCacheInvalidator` on chain events, `OnboardAgent` on a manual dashboard button).

**Tech Stack:** TypeScript scripts (one-shot per-wallet for keys we hold locally), KeeperHub MCP for the Turnkey-managed wallet, viem for chain reads/writes, ENSIP-19 ReverseRegistrar contracts on Sepolia + Base Sepolia.

**Spec:** [docs/superpowers/specs/2026-04-28-agent-identity-package-design.md](../specs/2026-04-28-agent-identity-package-design.md), W3 + KeeperHub orchestration sections.

**Branch:** `feat/w3-primary-names-keeperhub` (already created).

**Depends on:** W2 (merged) — `OnboardAgent` workflow and `ENSAvatarSync` cross-link into the W2 gateway and the W1 INFT contract. The new workflows replace the heartbeat + reputation-cache workflows that are stopped in PR #13 and queued for full deletion in this plan.

---

## File map

### New TypeScript
- Create: `scripts/setup-primary-names.ts` — one-shot per-wallet setName runner for keys we hold locally (`AGENT_PK`, `PRICEWATCH_PK`, `VALIDATOR_PK`).
- Create: `scripts/setup-keeperhub-workflows.ts` — provisions the 4 new workflows via the KeeperHub MCP `create_workflow` tool, deletes `Heartbeat` + `ReputationCache`, writes the new workflow IDs to Edge Config.
- Create: `scripts/test-primary-names-e2e.ts` — viem `getEnsName(address)` round-trip per chain.
- Create: `scripts/test-keeperhub-e2e.ts` — for each new workflow: valid input → completed status, idempotent re-trigger, invalid input → clean failure.
- Create: `scripts/event-firehose.ts` — small chain-event subscriber that POSTs to KeeperHub on `MemoryReencrypted` / `MemoryStaled` / `BidPlaced` / `BidAccepted` / `FeedbackAccepted`. Optional helper for `GatewayCacheInvalidator`.
- Create: `lib/keeperhub-workflows.ts` — typed builders for the 4 workflow shapes (Web3 Write nodes, webhook nodes). Used by the setup-keeperhub-workflows script.
- Create: `app/api/dev/onboard-agent/route.ts` — dashboard button trigger (calls `OnboardAgent` workflow on KeeperHub).
- Create: `app/api/dev/setup-primary-name/route.ts` — dashboard button trigger (calls `ENSPrimaryNameSetter` workflow for the Turnkey wallet).

### Modified TypeScript
- Modify: `app/keeperhub/page.tsx` — add the 4 new workflow cards, mark heartbeat + rep-cache as `deprecated`.
- Modify: `lib/edge-config.ts` — add typed accessors for new workflow IDs.

### Env / config
- No new env vars. New Edge Config keys: `keeperhubWorkflowIds.primaryName`, `keeperhubWorkflowIds.avatarSync`, `keeperhubWorkflowIds.gatewayInvalidate`, `keeperhubWorkflowIds.onboardAgent`.

---

## Milestones and "ALL GREEN" gates

| # | Phase | Gate |
|---|---|---|
| M1 | Primary names for locally-keyed wallets (`AGENT_PK`, `PRICEWATCH_PK`, `VALIDATOR_PK`) | `viem.getEnsName(address)` returns the correct label on Sepolia + Base Sepolia |
| M2 | KeeperHub workflow builders + `setup-keeperhub-workflows.ts` provisioning | New workflow IDs written to Edge Config; obsolete workflows deleted |
| M3 | Avatar sync + gateway invalidate webhooks | After a manual `MemoryReencrypted` event, KeeperHub run shows `completed` and W2 gateway cache for the affected key is gone from Redis |
| M4 | Primary name for Turnkey wallet via KeeperHub | After `ENSPrimaryNameSetter` workflow run, `getEnsName(turnkeyAddress)` returns `keeperhub.agentlab.eth` |
| M5 | OnboardAgent end-to-end | Manual dashboard click → 6-step orchestrated run logs all green |
| M6 | E2E tests | `scripts/test-primary-names-e2e.ts` + `scripts/test-keeperhub-e2e.ts` print `ALL GREEN` |
| M7 | PR + walkthrough | `docs/walkthroughs/2026-05-01-w3-manual-walkthrough.md` |

---

## M1 — Primary names for locally-keyed wallets

### Task 1: Confirm `agentlab.eth` subname ownership for each label

For each label like `agent-eoa.tradewise.agentlab.eth`, ENS subname registration requires the parent `tradewise.agentlab.eth` to have a resolver that supports `setSubnodeRecord`, OR the parent owner can call `setSubnodeOwner`. Two paths:

(a) **Use `ENS.setSubnodeOwner(parent, labelHash, owner)`** to register the subname with itself as owner. Then call `ReverseRegistrar.setName(label)` from the wallet.
(b) **Use a wildcard-aware path:** if W2's OffchainResolver also handles forward `addr` for any `*.agentlab.eth`, we don't need to register subnames at all — the gateway returns the wallet address dynamically.

W2's gateway DOES handle forward `addr` for `tradewise.agentlab.eth` and `pricewatch.agentlab.eth`. To extend to `agent-eoa.tradewise.agentlab.eth`, the gateway's `labelToAgent` function needs an entry for the deeper label. **Update the gateway in this plan first** so subnames are zero-config.

- [ ] **Step 1: Verify the W2 gateway handles `agent-eoa.tradewise.agentlab.eth`**

Read `lib/ens-gateway.ts:labelToAgent`. If it doesn't handle nested labels, extend:

```typescript
export async function labelToAgent(label: string)
  : Promise<{agentId: number | null; tokenId: number | null; addressOverride?: `0x${string}`} | null>
{
  const lower = label.toLowerCase();
  if (lower === "tradewise.agentlab.eth") return { agentId: 1, tokenId: 1 };
  if (lower === "pricewatch.agentlab.eth") return { agentId: 2, tokenId: null };

  // Direct wallet labels (W3 — for primary-name reverse resolution)
  const walletLabels: Record<string, `0x${string}`> = {
    "agent-eoa.tradewise.agentlab.eth": "0x7a83678e330a0C565e6272498FFDF421621820A3",
    "pricewatch-deployer.agentlab.eth": "0xBf5df5c89b1eCa32C1E8AC7ECdd93d44F86F2469",
    "validator.agentlab.eth": "0x0134...83F6", // VALIDATOR_PK address
    "keeperhub.agentlab.eth": "0xB28c...6539", // Turnkey address from KeeperHub get_wallet_integration
  };
  if (walletLabels[lower]) {
    return { agentId: null, tokenId: null, addressOverride: walletLabels[lower] };
  }

  return null;
}
```

And update `computeAddr` to honor `addressOverride`. Commit as part of this task.

- [ ] **Step 2: Smoke test the gateway for the new labels**

```bash
# After gateway update + redeploy:
node -e "
const { createPublicClient, http } = require('viem');
const { sepolia } = require('viem/chains');
const c = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });
c.getEnsAddress({ name: 'agent-eoa.tradewise.agentlab.eth' }).then(a => console.log('addr:', a));
"
```

Should print `0x7a83…20A3`.

- [ ] **Step 3: Commit gateway update**

```bash
git add lib/ens-gateway.ts
git commit -m "feat(w3): gateway handles nested wallet labels (agent-eoa, pricewatch-deployer, validator)"
```

### Task 2: Set reverse names on Sepolia for locally-keyed wallets

**Files:**
- Create: `scripts/setup-primary-names.ts`

- [ ] **Step 1: Write the script**

```typescript
/**
 * One-shot reverse-name setup for wallets we hold locally. Each wallet
 * pays its own gas (need ~0.001 ETH per setName call). Idempotent: skips
 * if reverse name already matches.
 *
 * Required env: AGENT_PK, PRICEWATCH_PK, VALIDATOR_PK, SEPOLIA_RPC_URL,
 * BASE_SEPOLIA_RPC_URL.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, baseSepolia } from "viem/chains";

const SEPOLIA_REVERSE_REGISTRAR =
  "0xCF75B92126B02C9811d8c632144288a3eb84afC8" as const;
const BASE_SEPOLIA_L2_REVERSE_REGISTRAR =
  // Canonical L2 reverse registrar per ENSIP-19 — confirm via
  // https://docs.ens.domains/learn/deployments before run
  "0x00000BeEF055f7934784D6d81b6BC86665630dbA" as const;

const REVERSE_REGISTRAR_ABI = [
  {
    type: "function",
    name: "setName",
    stateMutability: "nonpayable",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

type Plan = {
  pkEnv: string;
  label: string;
  chains: { chain: Chain; rpcEnv: string; registrar: Address }[];
};

const PLANS: Plan[] = [
  {
    pkEnv: "AGENT_PK",
    label: "agent-eoa.tradewise.agentlab.eth",
    chains: [
      { chain: sepolia, rpcEnv: "SEPOLIA_RPC_URL", registrar: SEPOLIA_REVERSE_REGISTRAR },
      { chain: baseSepolia, rpcEnv: "BASE_SEPOLIA_RPC_URL", registrar: BASE_SEPOLIA_L2_REVERSE_REGISTRAR },
    ],
  },
  {
    pkEnv: "PRICEWATCH_PK",
    label: "pricewatch-deployer.agentlab.eth",
    chains: [
      { chain: sepolia, rpcEnv: "SEPOLIA_RPC_URL", registrar: SEPOLIA_REVERSE_REGISTRAR },
      { chain: baseSepolia, rpcEnv: "BASE_SEPOLIA_RPC_URL", registrar: BASE_SEPOLIA_L2_REVERSE_REGISTRAR },
    ],
  },
  {
    pkEnv: "VALIDATOR_PK",
    label: "validator.agentlab.eth",
    chains: [
      { chain: sepolia, rpcEnv: "SEPOLIA_RPC_URL", registrar: SEPOLIA_REVERSE_REGISTRAR },
      { chain: baseSepolia, rpcEnv: "BASE_SEPOLIA_RPC_URL", registrar: BASE_SEPOLIA_L2_REVERSE_REGISTRAR },
    ],
  },
];

async function main() {
  for (const plan of PLANS) {
    const pkRaw = process.env[plan.pkEnv];
    if (!pkRaw) { console.log(`✗ ${plan.pkEnv} missing — skipping`); continue; }
    const pk = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as Hex;
    const account = privateKeyToAccount(pk);

    for (const c of plan.chains) {
      const rpc = process.env[c.rpcEnv];
      if (!rpc) { console.log(`✗ ${c.rpcEnv} missing — skipping ${plan.label} on ${c.chain.name}`); continue; }
      const pub = createPublicClient({ chain: c.chain, transport: http(rpc) });
      const wallet = createWalletClient({ account, chain: c.chain, transport: http(rpc) });

      // Idempotency: read current reverse name. If already matches, skip.
      try {
        const current = await pub.getEnsName({ address: account.address });
        if (current === plan.label) {
          console.log(`✓ ${account.address} on ${c.chain.name} already → ${plan.label}`);
          continue;
        }
      } catch {
        // No reverse record yet — proceed.
      }

      console.log(`→ ${account.address} setName("${plan.label}") on ${c.chain.name}...`);
      const txHash = await wallet.writeContract({
        address: c.registrar,
        abi: REVERSE_REGISTRAR_ABI,
        functionName: "setName",
        args: [plan.label],
      });
      const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
      console.log(`  tx ${txHash} (block ${receipt.blockNumber})`);
    }
  }
  console.log("\ndone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run**

```bash
set -a; source .env.local; set +a
pnpm exec tsx scripts/setup-primary-names.ts
```

- [ ] **Step 3: Verify on Sepolia**

```bash
node -e "
const { createPublicClient, http } = require('viem');
const { sepolia } = require('viem/chains');
const c = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });
c.getEnsName({ address: '0x7a83678e330a0C565e6272498FFDF421621820A3' }).then(n => console.log('agent ENS:', n));
"
```

Should print `agent-eoa.tradewise.agentlab.eth`.

- [ ] **Step 4: Commit**

```bash
git add scripts/setup-primary-names.ts
git commit -m "feat(w3): scripts/setup-primary-names — set reverse name per chain idempotently"
```

**🟢 M1 GATE:** `viem.getEnsName(AGENT_EOA)` and `getEnsName(PRICEWATCH_DEPLOYER)` return their labels on both chains.

---

## M2 — KeeperHub workflow provisioning

### Task 3: Inspect existing workflows + gather references

- [ ] **Step 1: List current workflows**

```bash
set -a; source .env.local; set +a
pnpm exec tsx scripts/keeperhub-mcp.ts tools | head -30
# Confirm tool list still has create_workflow, delete_workflow, list_workflows
```

- [ ] **Step 2: Read the existing `Swap` workflow definition** (the one to KEEP — used as reference for Web3 Write node shape):

```bash
pnpm exec tsx scripts/keeperhub-mcp.ts workflow $KEEPERHUB_WORKFLOW_ID_SWAP > /tmp/swap-workflow.json
```

The Web3 Write node config has fields `abi`, `network`, `actionType`, `abiFunction`, `signer` (PK env name), `contractAddress`, `functionArgs` (JSON-stringified array with `{{$now.timestamp}}` style templates). Use this shape.

### Task 4: Build typed workflow definitions

**Files:**
- Create: `lib/keeperhub-workflows.ts`

- [ ] **Step 1: Write builders for the 4 new workflow shapes**

For each workflow:
- `ENSPrimaryNameSetter`: trigger=Webhook, input `{wallet, label, chain}`, action=Web3 Write `setName(label)` on the matching ReverseRegistrar.
- `ENSAvatarSync`: trigger=Webhook, input `{ensName, tokenId, contract, chainId}`, action=Web3 Write `setText(node, "avatar", "eip155:.../erc721:.../<tokenId>")` on the PublicResolver.
- `GatewayCacheInvalidator`: trigger=Webhook, input `{event, agentId, tokenId, keys[]}`, action=Webhook POST to `${APP_URL}/api/ens-gateway/cache/invalidate` with `Authorization: Bearer ${INFT_ORACLE_API_KEY}`.
- `OnboardAgent`: trigger=Webhook, input `{agentName, agentDomain, agentEoa, agentWallet, sealedMemoryPlaintext}`. Six sequential nodes: (1) `Web3 Write IdentityRegistryV2-b.registerByDeployer(...)`, (2) Webhook POST `/api/inft/oracle/seal-blob`, (3) `Web3 Write AgentINFT.mint(...)`, (4) `Web3 Write ENS.setSubnodeOwner(...)`, (5) Trigger sub-workflow `ENSAvatarSync`, (6) Trigger sub-workflow `ENSPrimaryNameSetter`.

```typescript
// lib/keeperhub-workflows.ts
export type WorkflowSpec = {
  name: string;
  description: string;
  nodes: unknown[];
  edges: unknown[];
};

export function buildEnsPrimaryNameSetter(args: {
  appUrl: string;
  registrarAbi: string;
  sepoliaRegistrar: string;
  baseSepoliaRegistrar: string;
}): WorkflowSpec {
  // Returns the full nodes/edges JSON. Pattern matches /tmp/swap-workflow.json.
  // ... (full implementation)
}

export function buildEnsAvatarSync(args: { /* ... */ }): WorkflowSpec { /* ... */ }
export function buildGatewayCacheInvalidator(args: { appUrl: string }): WorkflowSpec { /* ... */ }
export function buildOnboardAgent(args: { /* ... */ }): WorkflowSpec { /* ... */ }
```

(Each builder is ~80 lines. Keep them in one file for ease of review.)

- [ ] **Step 2: Commit**

```bash
git add lib/keeperhub-workflows.ts
git commit -m "feat(w3): keeperhub-workflows — typed builders for 4 new workflow shapes"
```

### Task 5: Provisioning script

**Files:**
- Create: `scripts/setup-keeperhub-workflows.ts`

- [ ] **Step 1: Write the script**

The script:
1. Connects to KeeperHub MCP via shared init/rpc helpers (factor out of `scripts/keeperhub-mcp.ts`).
2. For each new workflow: calls `tools/call create_workflow` with the typed spec from `lib/keeperhub-workflows.ts`.
3. Captures the returned IDs.
4. Calls `tools/call delete_workflow` for `KEEPERHUB_WORKFLOW_ID_HEARTBEAT` and `KEEPERHUB_WORKFLOW_ID_REPUTATION_CACHE` (read from Edge Config).
5. Writes new IDs to Edge Config keys: `keeperhubWorkflowIds.primaryName`, `keeperhubWorkflowIds.avatarSync`, `keeperhubWorkflowIds.gatewayInvalidate`, `keeperhubWorkflowIds.onboardAgent`.
6. Removes obsolete keys.

- [ ] **Step 2: Dry-run mode flag**

The script accepts `--dry-run` to print the JSON it would send without invoking the MCP — useful for review.

- [ ] **Step 3: Run live**

```bash
set -a; source .env.local; set +a
pnpm exec tsx scripts/setup-keeperhub-workflows.ts
```

Output: 4 created IDs + 2 deleted IDs.

- [ ] **Step 4: Commit**

```bash
git add scripts/setup-keeperhub-workflows.ts
git commit -m "feat(w3): provision 4 new workflows + delete heartbeat + rep-cache"
```

**🟢 M2 GATE:** `pnpm exec tsx scripts/keeperhub-mcp.ts list_workflows | grep -E "ENSPrimaryName|ENSAvatarSync|GatewayCacheInvalidator|OnboardAgent"` shows all four. Heartbeat + ReputationCache are gone.

---

## M3 — Webhook integrations

### Task 6: Wire `ENSAvatarSync` trigger from oracle confirm-transfer

**Files:**
- Modify: `app/api/inft/oracle/confirm-transfer/route.ts`

- [ ] **Step 1: After successful confirm, fire the avatar-sync workflow**

```typescript
import { triggerKeeperHubByKind } from "@/lib/keeperhub";

// After commitPending:
await triggerKeeperHubByKind("avatar-sync", {
  ensName: "tradewise.agentlab.eth",
  tokenId: tokenId.toString(),
  contract: addrs.inftAddress,
  chainId: 11155111,
});
```

`triggerKeeperHubByKind` is a thin wrapper around `triggerKeeperHub` that reads the workflow ID from Edge Config by kind. Add to `lib/keeperhub.ts` if not already there.

- [ ] **Step 2: Commit**

```bash
git add app/api/inft/oracle/confirm-transfer/route.ts lib/keeperhub.ts
git commit -m "feat(w3): confirm-transfer triggers ENSAvatarSync workflow"
```

### Task 7: Wire `GatewayCacheInvalidator`

**Files:**
- Create: `scripts/event-firehose.ts`

The cleanest source: a lightweight chain-event subscriber that the Vercel app exposes via a route the user pings, OR a Vercel cron that polls every minute. For hackathon scope: a polling-style script (Vercel doesn't natively support long-running websocket subscribers).

- [ ] **Step 1: Write the firehose**

```typescript
/**
 * Poll Sepolia logs for relevant W1 + W3 events and POST to KeeperHub's
 * GatewayCacheInvalidator workflow. Run as an hourly Vercel cron OR a
 * manual script.
 *
 * Events watched:
 *   - AgentINFT.MemoryReencrypted(tokenId, newRoot, newUri)
 *   - AgentINFT.MemoryStaled(tokenId)
 *   - AgentBids.BidPlaced/BidAccepted/BidWithdrawn(tokenId, ...)
 *   - ReputationRegistry.FeedbackAccepted(agentId, ...)
 */
import { createPublicClient, http, parseAbiItem } from "viem";
import { sepolia } from "viem/chains";
import { triggerKeeperHubByKind } from "@/lib/keeperhub";
import { getRedis } from "@/lib/redis";
import { getSepoliaAddresses } from "@/lib/edge-config";

async function main() {
  const c = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL!) });
  const addrs = await getSepoliaAddresses();
  const r = getRedis();
  if (!r) throw new Error("redis missing");

  const lastSeen = Number((await r.get("firehose:last-block")) ?? 0);
  const head = await c.getBlockNumber();
  if (lastSeen >= Number(head)) { console.log("nothing new"); return; }

  const fromBlock = BigInt(Math.max(lastSeen + 1, Number(head) - 1000));

  const inftLogs = await c.getLogs({
    address: addrs.inftAddress as `0x${string}`,
    events: [
      parseAbiItem("event MemoryReencrypted(uint256 indexed tokenId, bytes32 newRoot, string newUri)"),
      parseAbiItem("event MemoryStaled(uint256 indexed tokenId)"),
    ],
    fromBlock,
    toBlock: head,
  });

  for (const log of inftLogs) {
    const tokenId = (log.args as { tokenId?: bigint }).tokenId?.toString() ?? "?";
    await triggerKeeperHubByKind("gateway-invalidate", {
      event: log.eventName,
      agentId: 1,
      tokenId,
      keys: [
        `inft:meta:${tokenId}:rotations`,
        // ENS gateway internal cache keys — match what computeRecord() caches
      ],
    });
  }
  // Same for AgentBids + ReputationRegistry events ...

  await r.set("firehose:last-block", head.toString());
  console.log(`processed ${inftLogs.length} INFT logs through block ${head}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add to vercel.json crons** (every 5 min)

```json
{
  "crons": [
    { "path": "/api/cron/event-firehose", "schedule": "*/5 * * * *" }
  ]
}
```

And expose `app/api/cron/event-firehose/route.ts` that calls into the firehose lib.

- [ ] **Step 3: Commit**

```bash
git add scripts/event-firehose.ts app/api/cron/event-firehose vercel.json
git commit -m "feat(w3): event-firehose cron + GatewayCacheInvalidator wiring"
```

**🟢 M3 GATE:** Manually trigger a transferWithProof on Sepolia (or wait for any chain activity), wait 5min for the cron, confirm the gateway cache key was deleted from Redis.

---

## M4 — Primary name for Turnkey wallet

### Task 8: Use `ENSPrimaryNameSetter` workflow for the KeeperHub wallet

- [ ] **Step 1: Read Turnkey wallet address**

```bash
pnpm exec tsx scripts/keeperhub-mcp.ts get_wallet_integration > /tmp/wallet.json
# extract turnkeyAddress
```

- [ ] **Step 2: Trigger the workflow**

```bash
curl -X POST -H "Authorization: Bearer $INFT_ORACLE_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"wallet\":\"$TURNKEY_ADDRESS\",\"label\":\"keeperhub.agentlab.eth\",\"chain\":\"sepolia\"}" \
  https://hackagent-nine.vercel.app/api/dev/setup-primary-name
```

Or via the dashboard button (built in next task).

- [ ] **Step 3: Verify**

```bash
node -e "
const { createPublicClient, http } = require('viem');
const { sepolia } = require('viem/chains');
const c = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });
c.getEnsName({ address: '$TURNKEY_ADDRESS' }).then(n => console.log('keeperhub ENS:', n));
"
```

Should print `keeperhub.agentlab.eth`.

- [ ] **Step 4: Run for Base Sepolia too**

Same workflow, `chain: 'base-sepolia'`.

**🟢 M4 GATE:** Turnkey wallet has reverse name on both chains.

### Task 9: Dashboard "Onboard new agent" button

**Files:**
- Create: `app/api/dev/onboard-agent/route.ts`
- Modify: `app/keeperhub/page.tsx` — add a button that POSTs to the route.

- [ ] **Step 1: Route**

```typescript
// app/api/dev/onboard-agent/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { triggerKeeperHubByKind } from "@/lib/keeperhub";

const Body = z.object({
  agentName: z.string(),
  agentDomain: z.string(),
  agentEoa: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  agentWallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  sealedMemoryPlaintext: z.record(z.unknown()),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const r = await triggerKeeperHubByKind("onboard-agent", parsed.data);
  return NextResponse.json({ workflowRunId: r?.workflowRunId ?? null });
}
```

- [ ] **Step 2: Page button**

A modal on `/keeperhub` that collects the form fields and POSTs. Show the workflow run progress via `get_execution_logs` polling.

- [ ] **Step 3: Commit**

```bash
git add app/api/dev/onboard-agent/route.ts app/keeperhub/page.tsx
git commit -m "feat(w3): /api/dev/onboard-agent + dashboard button"
```

**🟢 M5 GATE:** Click the button with a fake `pricewatch-test` agent, watch all 6 steps complete in KeeperHub UI, see the new agent on Sepolia + ENS reverse name set + INFT minted + memory blob anchored to 0G.

---

## M6 — E2E tests

### Task 10: `scripts/test-primary-names-e2e.ts`

- [ ] **Step 1: Write 4-step test**

1. `viem.getEnsName(AGENT_EOA, sepolia)` returns `agent-eoa.tradewise.agentlab.eth`.
2. Same on Base Sepolia.
3. `viem.getEnsAddress("tradewise.agentlab.eth")` returns AGENT_EOA (forward via W2 gateway).
4. `viem.getEnsAvatar("tradewise.agentlab.eth")` returns the `eip155:.../erc721:...` URI (cross-link with W1).

Final line: `ALL GREEN`.

### Task 11: `scripts/test-keeperhub-e2e.ts`

- [ ] **Step 1: For each new workflow:**

  - `kh.execute_workflow` with a valid input → status `completed`, expected on-chain effect.
  - Re-trigger same input → idempotent (no duplicate tx).
  - Trigger with intentionally bad input → workflow `failed` cleanly with non-empty `error.message`.

  Final line: `ALL GREEN`.

- [ ] **Step 2: Commit both**

```bash
git add scripts/test-primary-names-e2e.ts scripts/test-keeperhub-e2e.ts
git commit -m "test(w3): e2e for primary names + keeperhub workflow shapes"
```

**🟢 M6 GATE:** Both e2e scripts print `ALL GREEN`.

---

## M7 — PR + walkthrough

### Task 12: PR

```bash
git push -u origin feat/w3-primary-names-keeperhub
gh pr create --title "W3: ENSIP-19 primary names + KeeperHub orchestration (closes #11/W3)" \
  --body "<...full body with addresses + new workflow IDs from Edge Config>"
```

### Task 13: Walkthrough doc

`docs/walkthroughs/2026-05-01-w3-manual-walkthrough.md` mirroring W1/W2 format. Sections:
- §A — Etherscan check: `0x7a83…20A3` shows `agent-eoa.tradewise.agentlab.eth`.
- §B — MetaMask: connect a wallet, see ENS names where there were addresses.
- §C — `/keeperhub` page: 4 new workflow cards visible, heartbeat + rep-cache cards either gone or marked deprecated.
- §D — Click "Onboard agent" button on `/keeperhub`, fill form, watch the orchestrated 6-step run, end state shows new agent live with all ENS + INFT + memory + reverse name.
- §E — Confirm: no Sepolia gas burn from PRICEWATCH_PK in the past 24h aside from explicit user actions (heartbeat is GONE).

**🟢 M7 GATE: W3 SHIPPED. ALL THREE WORKSTREAMS COMPLETE.**

---

## What's NOT in this plan

- W2-β (storage proofs) — out of scope.
- Namechain migration (issue #10 plan C) — post-hackathon.
- Selling subnames as NFTs in AgentBids (issue #10 side dish) — out of scope.
- ENS NameWrapper / fuse-locked subnames — out of scope.
