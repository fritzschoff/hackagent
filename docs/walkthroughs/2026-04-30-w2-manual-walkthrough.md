# W2 manual UI walkthrough — checklist

**Purpose:** verify the W2 CCIP-Read ENS gateway end-to-end after `feat/w2-ens-gateway` deploys to a Vercel preview (or production after merge).

**What this verifies:** every record served by the gateway, every cross-link with W1, the `/ens-debug` page, and that external clients (etherscan, MetaMask, wagmi/viem) all resolve `*.agentlab.eth` records through the offchain pipeline without intervention.

**Reference deployments (Sepolia):**

| Component | Address |
|---|---|
| OffchainResolver | [`0x4F95…8C17`](https://sepolia.etherscan.io/address/0x4F956e6521A4B87b9f9b2D5ED191fB6134Bc8C17) |
| Gateway signer (off-chain) | `0xe358F777daF973E64d0F9b2e73bc34e4C7F65c9b` |
| Gateway base URL | `https://hackagent-nine.vercel.app/api/ens-gateway/{sender}/{data}.json` |

ENS resolver records (all flipped to OffchainResolver in M5):
- `agentlab.eth` (parent)
- `tradewise.agentlab.eth`
- `pricewatch.agentlab.eth`

---

## Pre-flight

- [ ] **Vercel preview / production deploy is live.** Hit `https://hackagent-nine.vercel.app/api/ens-gateway/0x4F956e6521A4B87b9f9b2D5ED191fB6134Bc8C17/0x.json` — should return 400 (invalid data hex), NOT 404. A 404 means W2 isn't deployed yet.
- [ ] **`INFT_GATEWAY_PK` is set in Vercel Production env.** Verify via `vercel env ls | grep GATEWAY`.
- [ ] **MetaMask / any wagmi-based wallet** ready (any wallet that supports CCIP-Read — virtually all modern wallets).

---

## §A — `/ens-debug` page roundtrip (the demo gold)

This is the section judges will love.

- [ ] Visit `/ens-debug` on the live deploy.
- [ ] Form prefills `name = tradewise.agentlab.eth`, `key = last-seen-at`. Click **resolve**.
- [ ] Within ≤ 2s, the JSON box renders something like:

  ```json
  {
    "name": "tradewise.agentlab.eth",
    "key": "last-seen-at",
    "value": "2026-04-29T13:20:00.000Z",
    "latencyMs": 1430
  }
  ```

  - `value` is a recent ISO timestamp (last paid x402 quote populated it via the KeeperHub heartbeat-pulse from PR #13).
  - `latencyMs` is the round-trip time end-to-end through CCIP-Read: revert → gateway POST → ABI decode → ecrecover.

- [ ] Change `key` to `memory-rotations`. Resolve. Should return `"0"` initially, `"N"` after N successful `transferWithProof` calls.
- [ ] Change `key` to `inft-tradeable`. Resolve. Returns `"1"` (since `AgentINFT.memoryReencrypted(1) == true` post-mint).
- [ ] Change `key` to `outstanding-bids`. Resolve. Returns the current bidder count from `AgentBids.biddersCount(1)`.
- [ ] Change `key` to `reputation-summary`. Resolve. Returns `feedback=N` where N matches `ReputationRegistry.feedbackCount(1)` on-chain.
- [ ] Change `name` to `pricewatch.agentlab.eth`, `key = last-seen-at`. Resolve. Returns its own value (or empty string if pricewatch hasn't fired recently).

---

## §B — Wildcard via ENSIP-10

Validates the `*.agentlab.eth` wildcard story.

- [ ] In `/ens-debug`, enter `name = agent-eoa.tradewise.agentlab.eth`, `key = addr`. Click resolve.
- [ ] Returns a `value` of `"0x0000…0000"` (zero address — labelToAgent doesn't have this nested entry yet; W3 extends it). The KEY POINT: it does NOT 404 or error — the gateway *handled* a name that was never registered as a subname. That's ENSIP-10 wildcard working.
- [ ] Sepolia etherscan also handles wildcard: visit https://sepolia.etherscan.io/enslookup-search?search=agent-eoa.tradewise.agentlab.eth. The "Resolver" row shows `0x4F95…8C17` (our OffchainResolver, inherited via wildcard from the parent `agentlab.eth`).

---

## §C — External clients (the wagmi/viem path)

Validates that the gateway is invisible to standard tooling. If this works, every dApp on the planet that uses ENS resolves your records without integration.

- [ ] In a Node REPL or browser console with viem:

  ```ts
  import { createPublicClient, http } from "viem";
  import { sepolia } from "viem/chains";

  const c = createPublicClient({
    chain: sepolia,
    transport: http("https://ethereum-sepolia-rpc.publicnode.com"),
    ccipRead: true,
  });

  const v = await c.getEnsText({
    name: "tradewise.agentlab.eth",
    key: "last-seen-at",
  });
  console.log(v);
  ```

  Returns the same ISO string as `/ens-debug`. No special config — viem followed the OffchainLookup transparently.

- [ ] **Etherscan**: visit https://sepolia.etherscan.io/enslookup-search?search=tradewise.agentlab.eth. The text records section should show our live values (Etherscan does CCIP-Read on the read tab).

- [ ] **MetaMask**: paste `tradewise.agentlab.eth` in the "Send" recipient field. MetaMask should resolve it to the agent's address (`0x7a83…20A3`) — that's the gateway's `addr(name)` response.

---

## §D — `/inft` page cross-link

Validates W1 ↔ W2 integration. The /inft page reads INFT memory state TWICE — once via direct chain read, once via the W2 ENS gateway.

- [ ] Visit `/inft`. Existing INFT card renders (W1 surface).
- [ ] Below the bid table, find the `§02 live telemetry / via ENS gateway` section.
- [ ] Confirm:
  - `rotations` cell shows the same value as the on-chain card above (Redis-backed, `inft:meta:1:rotations`).
  - `inft-tradeable` cell shows `"1"` (matches `memoryReencrypted` from on-chain).
  - `last-seen-at` cell shows a recent timestamp.
  - `reputation-summary` cell shows `feedback=N`.
  - `outstanding-bids` cell shows the current bid count.

- [ ] Trigger a `transferWithProof` (e.g. via the manual W1 walkthrough §C). After it lands, refresh `/inft`. Both the on-chain `rotations` and the via-ENS `rotations` cell should increment to 1. **Same value, two different reads** — proves the cross-link is live.

---

## §E — Gas verification

Validates that ENS reads are zero-gas.

- [ ] Note `PRICEWATCH_PK` Sepolia ETH balance before browsing.

  ```bash
  cast balance 0xBf5df5c89b1eCa32C1E8AC7ECdd93d44F86F2469 \
    --rpc-url https://ethereum-sepolia-rpc.publicnode.com -e
  ```

- [ ] Reload `/inft` 10 times, click around, browse to `/ens-debug` and resolve different keys.
- [ ] Re-check balance — **should be unchanged** (modulo any deliberate user actions). The W2 gateway never sends txs from PRICEWATCH_PK; all writes happen via KeeperHub webhook pulses (PR #13) which write Redis only.

- [ ] Compare to **pre-W2 behavior**: prior to PR #13, every paid quote burned ~14k gas. Now: zero per quote. W2 doesn't add any new on-chain writes either.

---

## §F — Tamper resistance (proof verification works)

Validates that the trusted-gateway story is actually trusted ON-CHAIN, not just at the API.

- [ ] In a Node REPL, hand-construct a `resolveWithProof(response, extraData)` `eth_call` against the OffchainResolver.
- [ ] Tamper one byte of the signature in `response`. The call should revert with custom error `InvalidSigner`.
- [ ] Restore the signature, change the `expires` field to a past timestamp. Call should revert with `ExpiredResponse`.
- [ ] (Optional) Pretend to be the gateway: sign the message with a different key, submit. Reverts `InvalidSigner` (only the configured `expectedGatewaySigner` is trusted).

These are the same checks `scripts/test-ens-gateway-e2e.ts` makes — they're worth knowing exist for the demo Q&A.

---

## §G — Manual cleanup

- [ ] Move `/tmp/inft-gateway-key.txt` to your password manager. The gateway PK is a real signing key — same handling as the INFT oracle PK.

---

## Sign-off

| Section | Result | Notes |
|---|---|---|
| §A `/ens-debug` roundtrip | ☐ pass / ☐ fail | |
| §B wildcard via ENSIP-10 | ☐ pass / ☐ fail | |
| §C external clients | ☐ pass / ☐ fail | |
| §D `/inft` cross-link | ☐ pass / ☐ fail | |
| §E gas verification | ☐ pass / ☐ fail | |
| §F tamper resistance | ☐ pass / ☐ fail | |

**Verified by:** `____________________`
**Date:** `____________________`
**Vercel deployment URL:** `____________________`

If any section fails, comment on PR #16 with the failed step + Vercel function logs (oracle/gateway routes log `[ens-gateway]` prefix).
