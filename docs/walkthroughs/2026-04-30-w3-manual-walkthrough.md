# W3 manual UI walkthrough — checklist

**Purpose:** verify W3 (ENSIP-19 primary names + KeeperHub orchestration) end-to-end after `feat/w3-primary-names-keeperhub` deploys to production.

**What this verifies:** reverse ENS names for all four wallets, the three new KeeperHub workflows, the avatar-sync + gateway-invalidate webhook triggers, and the gas-free guarantee from PR #13.

**Reference deployments (Sepolia):**

| Component | Value |
|---|---|
| AGENT_EOA | [`0x7a83678e330a0C565e6272498FFDF421621820A3`](https://sepolia.etherscan.io/address/0x7a83678e330a0C565e6272498FFDF421621820A3) |
| PRICEWATCH_DEPLOYER | [`0xBf5df5c89b1eCa32C1E8AC7ECdd93d44F86F2469`](https://sepolia.etherscan.io/address/0xBf5df5c89b1eCa32C1E8AC7ECdd93d44F86F2469) |
| VALIDATOR | [`0x01340D5A7A6995513C0C3EdF0367236e5b9C83F6`](https://sepolia.etherscan.io/address/0x01340D5A7A6995513C0C3EdF0367236e5b9C83F6) |
| Turnkey (KeeperHub) | [`0xB28cC07F397Af54c89b2Ff06b6c595F282856539`](https://sepolia.etherscan.io/address/0xB28cC07F397Af54c89b2Ff06b6c595F282856539) |
| KeeperHub `ENSPrimaryNameSetter` workflow | `x3x1yxn1i9fi6qs63v4lu` |
| KeeperHub `ENSAvatarSync` workflow | `iosfz5m65htyd18be78sp` |
| KeeperHub `GatewayCacheInvalidator` workflow | `3tzmhfpvsnom1bnkeieoz` |
| setName tx (Turnkey, Sepolia) | [`0xf070685260519a2f25344f9e732be074222f1987b0951e9e803bbd5cfba0d56e`](https://sepolia.etherscan.io/tx/0xf070685260519a2f25344f9e732be074222f1987b0951e9e803bbd5cfba0d56e) |
| W2 gateway base URL | `https://hackagent-nine.vercel.app/api/ens-gateway/{sender}/{data}.json` |

---

## Pre-flight

- [ ] **Branch `feat/w3-primary-names-keeperhub` is merged to main and Vercel production is live.** Verify commit `6e6c308` is present: `git log --oneline | grep 6e6c308`.
- [ ] **Vercel production deploy includes W3.** Check https://hackagent-nine.vercel.app/api/ens-gateway/0x4F956e6521A4B87b9f9b2D5ED191fB6134Bc8C17/0x.json — returns 400, not 404.
- [ ] **Three KeeperHub workflow IDs are set** in Edge Config or Vercel env: `KEEPERHUB_WORKFLOW_ID_PRIMARY_NAME`, `KEEPERHUB_WORKFLOW_ID_AVATAR_SYNC`, `KEEPERHUB_WORKFLOW_ID_GATEWAY_INVALIDATE`.

---

## §A — Etherscan reverse name check

Verify that each wallet's ENS primary name appears in the Etherscan page header above the address. Etherscan performs CCIP-Read resolution via the OffchainResolver — our gateway handles these.

- [ ] Visit https://sepolia.etherscan.io/address/0x7a83678e330a0C565e6272498FFDF421621820A3. The page header should show `agent-eoa.tradewise.agentlab.eth` above the address.
- [ ] Visit https://sepolia.etherscan.io/address/0xBf5df5c89b1eCa32C1E8AC7ECdd93d44F86F2469. The page header should show `pricewatch-deployer.agentlab.eth`.
- [ ] Visit https://sepolia.etherscan.io/address/0x01340D5A7A6995513C0C3EdF0367236e5b9C83F6. The page header should show `validator.agentlab.eth`.
- [ ] Visit https://sepolia.etherscan.io/address/0xB28cC07F397Af54c89b2Ff06b6c595F282856539. The page header should show `keeperhub.agentlab.eth`.

  **Note:** Etherscan caches ENS lookups. If the reverse record was set recently (within ~1h) the page may show a stale result. Hard-refresh (`Cmd+Shift+R`) or check via viem in §D.

---

## §B — MetaMask reverse name check

Connect each wallet to MetaMask (or any CCIP-Read-capable wallet) and verify the ENS name appears in the account dropdown where there was previously only an address.

- [ ] Import `AGENT_PK` into MetaMask. In the account switcher, the account name should resolve to `agent-eoa.tradewise.agentlab.eth`.
- [ ] Import `PRICEWATCH_PK`. Resolves to `pricewatch-deployer.agentlab.eth`.
- [ ] Import `VALIDATOR_PK`. Resolves to `validator.agentlab.eth`.
- [ ] The Turnkey wallet at `0xB28c…6539` does not have a locally-importable PK. Verify it via viem in §D instead.

  **Why this works:** MetaMask follows EIP-3668 (OffchainLookup) for reverse resolution. The W2 OffchainResolver at `0x4F95…8C17` handles the reverse lookup for any `*.agentlab.eth` label.

---

## §C — `/keeperhub` page — workflow IDs

Verify the three new W3 workflow IDs are visible and reachable from the app.

- [ ] Navigate to https://hackagent-nine.vercel.app/keeperhub.
- [ ] Confirm the following three workflow cards (or their IDs) appear on the page:
  - `ENSPrimaryNameSetter` — workflow ID `x3x1yxn1i9fi6qs63v4lu`
  - `ENSAvatarSync` — workflow ID `iosfz5m65htyd18be78sp`
  - `GatewayCacheInvalidator` — workflow ID `3tzmhfpvsnom1bnkeieoz`
- [ ] Click through to the KeeperHub UI for each workflow (link from the card or directly at `https://app.keeperhub.dev/workflows/<id>`). Each should show `active` status.
- [ ] The Heartbeat and ReputationCache workflows are **NOT** present as active auto-triggered workflows (they remain as webhook-only per PR #13 — no autonomous cron firing).

  Alternatively, verify via `vercel env ls`:
  ```
  KEEPERHUB_WORKFLOW_ID_PRIMARY_NAME    = x3x1yxn1i9fi6qs63v4lu
  KEEPERHUB_WORKFLOW_ID_AVATAR_SYNC     = iosfz5m65htyd18be78sp
  KEEPERHUB_WORKFLOW_ID_GATEWAY_INVALIDATE = 3tzmhfpvsnom1bnkeieoz
  ```

---

## §D — viem reverse + forward resolution cross-link

Run in a Node REPL or via `tsx`:

```ts
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

const client = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
  ccipRead: true,
});

// Reverse: all four wallets
console.log(await client.getEnsName({ address: "0x7a83678e330a0C565e6272498FFDF421621820A3" }));
// → "agent-eoa.tradewise.agentlab.eth"

console.log(await client.getEnsName({ address: "0xBf5df5c89b1eCa32C1E8AC7ECdd93d44F86F2469" }));
// → "pricewatch-deployer.agentlab.eth"

console.log(await client.getEnsName({ address: "0x01340D5A7A6995513C0C3EdF0367236e5b9C83F6" }));
// → "validator.agentlab.eth"

console.log(await client.getEnsName({ address: "0xB28cC07F397Af54c89b2Ff06b6c595F282856539" }));
// → "keeperhub.agentlab.eth"   (requires Vercel deploy of commit 6e6c308)

// Forward W2 cross-link: proves W3 didn't break W2
console.log(await client.getEnsAddress({ name: "tradewise.agentlab.eth" }));
// → "0x7a83678e330a0C565e6272498FFDF421621820A3"
```

Or run the automated test:

```bash
set -a; source .env.local; set +a
pnpm exec tsx scripts/test-primary-names-e2e.ts
```

Expected output: `ALL GREEN` (steps 1-4 must pass; step 5 may show `pending` if production hasn't redeployed yet).

- [ ] Steps 1-4 return correct labels.
- [ ] Step 5 either returns `keeperhub.agentlab.eth` (production deploy live) or prints `(skipped — pending production deploy of W3 fix commit 6e6c308)`.

---

## §E — Avatar sync trigger

Verify that a `transferWithProof` confirm fires the `ENSAvatarSync` workflow in KeeperHub.

- [ ] Trigger a `transferWithProof` on Sepolia. The easiest path is via the W1 walkthrough §C (`/inft` page → "Transfer INFT" action), or manually via:

  ```bash
  # With a pending transferWithProof commitment on Sepolia:
  curl -X POST https://hackagent-nine.vercel.app/api/inft/oracle/confirm-transfer \
    -H "Authorization: Bearer $INFT_ORACLE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"commitId": "<your_commit_id>"}'
  ```

- [ ] Within 30 seconds, visit the KeeperHub UI for workflow `iosfz5m65htyd18be78sp` (ENSAvatarSync). A new run should appear with status `completed`.

  **What this proves:** The `/api/inft/oracle/confirm-transfer` route (commit `8a96cf4`) fires `triggerKeeperHub` for both `ENSAvatarSync` and `GatewayCacheInvalidator` on every successful confirm. No manual intervention required.

- [ ] Also check workflow `3tzmhfpvsnom1bnkeieoz` (GatewayCacheInvalidator) — a new run should appear within the same 30s window.

---

## §F — Gas verification (PRICEWATCH_PK balance unchanged)

Validate that the W2 + W3 changes together produce zero gas burn from PRICEWATCH_PK for normal operations (W2 ENS resolution + W3 KeeperHub webhook triggers are all gas-free).

- [ ] Note `PRICEWATCH_PK` Sepolia ETH balance before proceeding:

  ```bash
  cast balance 0xBf5df5c89b1eCa32C1E8AC7ECdd93d44F86F2469 \
    --rpc-url https://ethereum-sepolia-rpc.publicnode.com -e
  ```

- [ ] Perform several operations:
  - Reload `/ens-debug` and resolve multiple keys.
  - Trigger a paid x402 quote via `/api/x402/quote`.
  - Browse `/keeperhub` and view workflow runs.

- [ ] Re-check balance after 5 minutes — **balance should be unchanged** (modulo any deliberate user-initiated transactions like `setup-primary-names.ts` re-runs).

  **Why:** PR #13 converted the KeeperHub Heartbeat + ReputationCache workflows from autonomous cron-triggered Web3 Write nodes to webhook-only triggers. The workflows no longer fire on a timer, so no Sepolia gas is burned per x402 quote. W3's avatar-sync + gateway-invalidate workflows also write Redis only — no on-chain calls from PRICEWATCH_PK.

---

## Sign-off

| Section | Result | Notes |
|---|---|---|
| §A Etherscan reverse names (4 wallets) | ☐ pass / ☐ fail | |
| §B MetaMask account names | ☐ pass / ☐ fail | |
| §C `/keeperhub` workflow IDs visible | ☐ pass / ☐ fail | |
| §D viem reverse + forward cross-link | ☐ pass / ☐ fail | |
| §E Avatar sync trigger (30s KeeperHub run) | ☐ pass / ☐ fail | |
| §F Gas verification (PRICEWATCH_PK balance) | ☐ pass / ☐ fail | |

**Verified by:** `____________________`
**Date:** `____________________`
**Vercel deployment URL:** `____________________`

If any section fails, check:
1. That commit `6e6c308` is in the production Vercel deploy (`git log --oneline | grep 6e6c308`).
2. Vercel function logs for the gateway route (`[ens-gateway]` prefix).
3. KeeperHub workflow run logs for `iosfz5m65htyd18be78sp` or `3tzmhfpvsnom1bnkeieoz`.
4. PR #15 comment thread for known issues.
