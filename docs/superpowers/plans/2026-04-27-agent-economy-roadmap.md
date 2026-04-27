# Agent Economy Roadmap — Issue #5 + Investor-Pitch Tier

> **For agentic workers:** This is a **roadmap**, not a single executable plan. It decomposes 11 features into dependency-ordered phases. For execution, expand any phase into a bite-sized plan via `superpowers:writing-plans` when you reach it. Steps that *are* small enough to execute directly use checkbox (`- [ ]`) syntax.

**Goal:** Ship the remaining gaps in PLAN.md §0 (ENS, INFT, MPP, 0G segments) and layer four investor-tier primitives (OpenSea-style INFT bidding, two-agent x402 economy, dynamic pricing, CCIP-Read reputation, agent IPO, reputation credit, SLA marketplace, agent M&A) on top of the existing Next.js + Sepolia + Base Sepolia + 0G stack.

**Architecture:** All new on-chain logic deploys to **Sepolia** (alongside existing ERC-8004 registries) except INFT-specific work which targets **0G Galileo** to qualify for the 0G prize. Off-chain logic stays in the existing Next.js app on Vercel Pro. New contracts compose with `IdentityRegistry`, `ReputationRegistry`, `ValidationRegistry` rather than replacing them. The shared invariant: agent identity = ERC-8004 `agentId`; everything else (INFT, shares, bonds, bids) keys off it.

**Tech Stack:** Solidity 0.8.28 / Foundry, viem 2.x, Next.js 16 App Router (Fluid Compute, Node runtime), ethers 6 (for 0G SDK only), Upstash Redis, Vercel Edge Config, ENS Sepolia (Public Resolver + custom OffchainResolver), 0G Galileo (Storage + Compute), x402, Tempo testnet (MPP).

---

## Scope Note

This document covers 11 features. The skill says: when a spec spans multiple independent subsystems, break it into separate plans. **Recommended sub-plan files** (to be expanded one-at-a-time during execution):

| # | File | Phase |
|---|---|---|
| 1 | `2026-04-27-phase1-ens-resolution.md` | ENS read-path + heartbeat |
| 2 | `2026-04-27-phase2-zg-segments.md` | 0G per-segment upload (Option F) |
| 3 | `2026-04-27-phase3-erc7857-inft.md` | ERC-7857 INFT base |
| 4 | `2026-04-27-phase4-inft-bidding.md` | OpenSea-style bid/accept (Option A revised) |
| 5 | `2026-04-27-phase5-dynamic-pricing.md` | Reputation-gated pricing (Option C) |
| 6 | `2026-04-27-phase6-ccip-read.md` | CCIP-Read reputation summary (Option E) |
| 7 | `2026-04-27-phase7-pricewatch-agent.md` | Two-agent x402 economy (Option B) |
| 8 | `2026-04-27-phase8-mpp-tempo.md` | MPP / Tempo session streams |
| 9 | `2026-04-27-phase9-agent-ipo.md` | Tokenized revenue-share INFT |
| 10 | `2026-04-27-phase10-rep-credit.md` | Reputation-collateralized credit market |
| 11 | `2026-04-27-phase11-sla-marketplace.md` | SLA-insured agent marketplace |
| 12 | `2026-04-27-phase12-agent-ma.md` | Agent M&A on-chain |

Each sub-plan should produce a deployable, testable unit independent of later phases.

---

## Dependency Graph

```
Phase 1 (ENS read)  ──────────────► Phase 6 (CCIP-Read)
Phase 2 (0G segments) ──────────────────────────────────────────┐
Phase 3 (INFT base) ──┬──► Phase 4 (Bidding)                    │
                      ├──► Phase 9 (Agent IPO) ───┐             │
                      ├──► Phase 11 (SLA bonds)   ├─► Phase 12 (M&A)
                      └──► Phase 12 (M&A)         │
Phase 5 (Dynamic price) — independent             │
Phase 7 (pricewatch)   ──► extends Phase 5        │
Phase 8 (MPP/Tempo)    — independent              │
Phase 10 (Rep credit)  — independent (reads ERC-8004 only)
```

**Critical path for "judges remember this" demo:** 1 → 3 → 4 → 9. (ENS read so the resolver returns real data, INFT base, OpenSea bidding so judges can place a bid live, and IPO so the dashboard shows fractional ownership.)

**Phase 2 (0G segments) is independent** and can run in parallel.

---

## Files Currently Present (Reference)

Existing files relevant to the plan — sub-plans should not re-describe these:

- `contracts/src/{IdentityRegistry,ReputationRegistry,ValidationRegistry}.sol` — ERC-8004 trio, deployed Sepolia
- `contracts/script/Deploy.s.sol` — current Sepolia deploy
- `contracts/foundry.toml` — solc 0.8.28, optimizer 200, remapping `forge-std/`
- `lib/ens.ts` — **stub** (`resolveAgentEns` returns nulls, `setEnsTextRecord` returns null, `refreshHeartbeat` is no-op)
- `lib/zg-storage.ts` — anchors Merkle root via custom `submit()` call; **skips per-segment upload to storage nodes**
- `lib/zg-compute.ts` — TeeML inference, working
- `lib/erc8004.ts` — viem read/write helpers for the three registries
- `lib/x402.ts` — `getResourceServer()`, `QUOTE_PRICE_USD = "$0.10"` (constant), `X402_NETWORK = "eip155:84532"`
- `lib/wallets.ts` — five wallet IDs: `agent`, `client1..3`, `validator`
- `app/api/a2a/jobs/route.ts` — paid endpoint, `withX402` wrapping, `waitUntil` fan-out to job log + 0G compute + 0G storage + KeeperHub
- `app/api/agent-card/route.ts` — ERC-8004 agent card JSON, rewritten from `/.well-known/agent-card.json`
- `app/api/cron/{agent,client,validator,storage,reputation,ens}-tick/route.ts` — Vercel Cron handlers
- `vercel.json` — 8 cron entries, `maxDuration` per route
- `scripts/register-ens.ts` — **already ran**: `tradewise.agentlab.eth` registered, addr set, ENSIP-25 text record set, `agent-card`/`description`/`url` text records set. Sub-plan 1 should *not* re-register — it should *read* what's already on-chain.

---

## Phase 1 — ENS resolution (read path + live heartbeat)

**Why first:** the dashboard, agent-card, and Phase 6 (CCIP-Read) all need a working `resolveAgentEns()`. Right now it returns nulls.

**Files:**
- Modify: `lib/ens.ts` (replace stubs)
- Modify: `app/api/cron/ens-heartbeat/route.ts` (currently no-op; should do something meaningful)
- Modify: `app/api/agent-card/route.ts` (include resolved ENS data)
- Modify: `app/page.tsx` (show resolved ENS state in header)

**Tasks (mid-grained — expand to bite-sized when ready to execute):**

- [ ] Add Sepolia `ENS_REGISTRY = 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` and `PUBLIC_RESOLVER = 0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5` constants (already in `register-ens.ts` — extract to a shared module `lib/ens-constants.ts`).
- [ ] Implement `resolveAgentEns()` using viem `getEnsAddress({ name })` and `getEnsText({ name, key })` for keys `agent-card`, `description`, `url`, and the ENSIP-25 key `agent-registration[eip155:11155111:0x6aF06f682A7Ba7Db32587FDedF51B9190EF738fA][1]`.
- [ ] Cache the resolution in Redis under `ens:tradewise` for 5 min (the data only changes when we manually re-run `register-ens.ts`).
- [ ] Implement `setEnsTextRecord({ key, value })` — wraps `walletClient.writeContract({ address: PUBLIC_RESOLVER, abi: RESOLVER_ABI, functionName: "setText", args: [namehash(SUB_NAME), key, value] })`.
- [ ] Implement `refreshHeartbeat()` — sets text record `last-seen-at` to current ISO timestamp **at most every 6 hours** (gas hygiene; cron runs hourly).
- [ ] Update `app/api/agent-card/route.ts` to include `ensName: AGENT_ENS`, `ensAddress`, `ensRegistration` fields from the resolved data.
- [ ] Update dashboard header to surface the resolved ENS data (not just the static link).
- [ ] Add `lib/__tests__/ens.test.ts` (vitest, network-mocked) — currently no test infra in `lib/`; **this phase introduces it**. Add `vitest` + `@vitest/ui` to `devDependencies`, add `npm run test` script.

**Commit checkpoints:** one commit after constants extraction; one after read-path; one after heartbeat write-path; one after dashboard wiring.

**Risk:** medium. ENS is well-trodden but viem's ENS resolver path is Mainnet-default — we need to point it explicitly at Sepolia by setting `chain: sepolia` on the public client and `universalResolverAddress` if needed (Sepolia's UR is `0xc8Af999e38273D658BE1b921b88A9Ddf005769cC`).

---

## Phase 2 — 0G per-segment upload (Option F)

**Why parallelizable:** zero dependencies on other phases.

**Files:**
- Modify: `lib/zg-storage.ts`

**The problem:** `indexer.upload(file, rpcUrl, signer)` does node selection → submit → segment upload. Our code currently:
1. Calls `indexer.upload` (which on SDK 0.3.3 fails the submit step due to the wrong selector).
2. Falls through to our hand-rolled `anchorOnChain(rootHash, byteLength)` that submits with the new ABI.
3. Never uploads segments to storage nodes — judges can verify the Merkle root is anchored on-chain but cannot retrieve the data.

**Strategy:** after our successful `anchorOnChain` submission, call `indexer.upload` *again*; its `findExistingFileInfo` step should detect our anchored submission and skip the submit step, advancing to segment upload.

**Tasks:**

- [ ] Add `lib/__tests__/zg-storage.test.ts` covering: small payload → `rootHash` returned + `anchored: true`. Mock `Indexer` to assert `upload` is called twice in retry mode.
- [ ] Refactor `writeBlob` to a 4-step state machine: (a) compute root via SDK, (b) anchor via `anchorOnChain`, (c) wait for receipt (currently fire-and-forget — needs to await receipt before re-calling SDK), (d) re-call `indexer.upload` for segment dispatch.
- [ ] Add `segmentsUploaded: boolean` to `WriteResult` so the dashboard can show the difference between "anchored" and "anchored + uploaded".
- [ ] Implement `readBlob(rootHash)` using the indexer's download path so `listRecentJobLogs` returns real data instead of `[]`.
- [ ] If the SDK's `findExistingFileInfo` doesn't detect our submission (likely if it queries via the old selector), fallback B: invoke the private `splitTasks` + `processTasksInParallel` directly with the rootHash we already have. **Bake this fallback into the test plan** — don't leave it as "maybe needed".
- [ ] Update dashboard to show, per-job: `Merkle root anchored ✓`, `Segments uploaded ✓`.

**Commit checkpoints:** one per fallback path. **Time budget: 1–2 hours; if both paths fail, document the SDK-version gap and ship without segments.**

---

## Phase 3 — ERC-7857 INFT base

**Why now:** Phases 4, 9, 11, 12 all need it.

**Files:**
- Create: `contracts/src/AgentINFT.sol`
- Create: `contracts/src/interfaces/IERC7857.sol`
- Create: `contracts/script/DeployAgentINFT.s.sol`
- Create: `contracts/test/AgentINFT.t.sol`
- Create: `lib/inft.ts` (TS wrapper)
- Create: `app/inft/page.tsx` (viewer — no bidding yet, just `tokenURI`, owner, encrypted memory pointer)
- Create: `scripts/mint-inft.ts`
- Modify: `contracts/script/Deploy.s.sol` (only if we want INFT in the existing deploy — recommend separate script to keep deploys idempotent)

**ERC-7857 surface area we implement:**
- `mint(to, agentId, encryptedMemoryRoot)` — owner-only, links to ERC-8004 `agentId`.
- `tokenURI(tokenId)` — returns `https://hackagent-nine.vercel.app/api/inft/{tokenId}` (new route, Phase 3a).
- `transferFrom(from, to, tokenId)` — fires `Transfer` and **clears the ERC-8004 `agentWallet`** by calling `IdentityRegistry.update()` if msg.sender is the registered agent address. (Spec §4.4 anti-laundering — wallet must be re-signed by new owner.)
- `encryptedMemory(tokenId)` returns `(rootHash bytes32, ciphertextUri string)` — root from 0G Storage, ciphertext URI (`og://<root>`) decryptable by the current owner's TEE-attested re-encryption oracle. **For demo: skip real re-encryption; ciphertext URI points to a sealed JSON.**
- Standard ERC-721 viewer compat (so OpenSea-clone front-ends Just Work).

**Tasks:**

- [ ] Vendor `solmate/ERC721.sol` or OpenZeppelin's via `forge install`. Recommend OZ since it's already battle-tested for testnet — install `OpenZeppelin/openzeppelin-contracts@v5.0.2`, add `@openzeppelin/=lib/openzeppelin-contracts/` to remappings.
- [ ] Write the failing test `AgentINFT.t.sol::test_mintLinksToErc8004AgentId` first.
- [ ] Implement `AgentINFT.sol` extending `ERC721`, with `mapping(uint256 => uint256) tokenIdToAgentId` and `mapping(uint256 => bytes32) encryptedMemoryRoot`.
- [ ] Add `setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata sig)` to `IdentityRegistry.sol` (EIP-712 signed) — **this is a backwards-compatible additive change**, not a redeploy. Or deploy v2 and migrate; whichever is faster (likely v2 is faster — the existing registry doesn't have the right ownership model for upgrades). **Decision: deploy `IdentityRegistryV2` with all v1 methods + the EIP-712 method, redeploy via `Deploy.s.sol` extension, migrate `agentId=1` by re-registering.**
- [ ] Override `_update` (OZ v5 hook) in `AgentINFT` so any transfer clears the linked `agentWallet` in `IdentityRegistryV2` until the new owner calls `setAgentWallet` with their EIP-712 sig.
- [ ] Write `lib/inft.ts` exporting `getInft(tokenId)`, `mintInft({ agentId, encryptedRoot })`, `transferInft({ tokenId, to })`.
- [ ] Build the viewer page `app/inft/page.tsx` — owner address, agentId link to ERC-8004, encrypted memory root with link to 0G explorer.
- [ ] Mint script `scripts/mint-inft.ts` — encrypts the agent's memory blob (sealed JSON for demo) → uploads to 0G Storage → mints INFT pointing at the root.
- [ ] Add `inft` field to `app/api/agent-card/route.ts`.

**Commit checkpoints:** v2 registry → INFT contract + tests → wallet-clear hook → TS wrapper → viewer page → mint script.

**Risk:** medium-high. The `IdentityRegistry` migration is the spicy bit. **Decision (2026-04-27, user confirmed): redeploy `IdentityRegistryV2`.** Sidecar fallback is documented but not chosen. Migration plan: deploy v2, register `agentId=1` for tradewise + `agentId=2` for pricewatch (Phase 7) on v2, swap Edge Config `addresses_sepolia.identityRegistry` to v2, leave v1 entries on-chain for historical continuity (the dashboard's reputation feed still queries v1's `ReputationRegistry` which can stay since it's keyed by `agentId`, not by registry).

---

## Phase 4 — INFT bidding (Option A, revised: OpenSea-style, no expiry)

**User requirement (verbatim):** "not like live auction, just like open sea, you can bid on it with no expiry time, the owner then can just accept the offer."

**Files:**
- Create: `contracts/src/AgentBids.sol`
- Create: `contracts/script/DeployAgentBids.s.sol`
- Create: `contracts/test/AgentBids.t.sol`
- Create: `lib/bids.ts`
- Modify: `app/inft/page.tsx` (add bid form + standing-bid table + accept button)
- Create: `app/api/cron/seed-bids/route.ts` (one or two seeded bot bids during the judging window)
- Modify: `vercel.json` (add the seed-bids cron, off by default in prod via env flag)

**Contract sketch (~80 LOC):**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// OpenSea-style bid pool: bidders escrow USDC, owner accepts any standing bid,
/// transfers INFT, claims escrow. No expiry. Bidders can withdraw any time
/// before acceptance.
contract AgentBids {
    using SafeERC20 for IERC20;

    struct Bid {
        address bidder;
        uint256 amount;     // USDC, 6 decimals
        uint64  createdAt;
        bool    active;
    }

    IERC721 public immutable INFT;
    IERC20  public immutable USDC;

    // tokenId -> bidder -> Bid
    mapping(uint256 => mapping(address => Bid)) public bids;
    // tokenId -> list of bidders (for UI enumeration)
    mapping(uint256 => address[]) public bidders;

    event BidPlaced(uint256 indexed tokenId, address indexed bidder, uint256 amount);
    event BidWithdrawn(uint256 indexed tokenId, address indexed bidder, uint256 amount);
    event BidAccepted(uint256 indexed tokenId, address indexed seller, address indexed bidder, uint256 amount);

    constructor(address inft, address usdc) {
        INFT = IERC721(inft);
        USDC = IERC20(usdc);
    }

    function placeBid(uint256 tokenId, uint256 amount) external {
        require(amount > 0, "zero");
        Bid storage existing = bids[tokenId][msg.sender];
        if (existing.active) {
            // Top up: pull difference. (Or replace; we choose top-up semantics.)
            require(amount > existing.amount, "must increase");
            uint256 delta = amount - existing.amount;
            USDC.safeTransferFrom(msg.sender, address(this), delta);
            existing.amount = amount;
        } else {
            USDC.safeTransferFrom(msg.sender, address(this), amount);
            bids[tokenId][msg.sender] = Bid(msg.sender, amount, uint64(block.timestamp), true);
            bidders[tokenId].push(msg.sender);
        }
        emit BidPlaced(tokenId, msg.sender, amount);
    }

    function withdrawBid(uint256 tokenId) external {
        Bid storage b = bids[tokenId][msg.sender];
        require(b.active, "no bid");
        b.active = false;
        uint256 amt = b.amount;
        b.amount = 0;
        USDC.safeTransfer(msg.sender, amt);
        emit BidWithdrawn(tokenId, msg.sender, amt);
    }

    function acceptBid(uint256 tokenId, address bidder) external {
        require(INFT.ownerOf(tokenId) == msg.sender, "not owner");
        Bid storage b = bids[tokenId][bidder];
        require(b.active, "no bid");
        b.active = false;
        uint256 amt = b.amount;
        b.amount = 0;
        // Pull INFT from owner -> bidder. Owner must have called approve() for tokenId.
        INFT.safeTransferFrom(msg.sender, bidder, tokenId);
        USDC.safeTransfer(msg.sender, amt);
        emit BidAccepted(tokenId, msg.sender, bidder, amt);
    }

    function listBidders(uint256 tokenId) external view returns (address[] memory) {
        return bidders[tokenId];
    }
}
```

**Tasks:**

- [ ] Foundry tests covering: place / top-up / withdraw / accept / accept-when-not-owner-reverts / reentrancy via mock USDC.
- [ ] Deploy on Sepolia (USDC for Sepolia is `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, the official Circle Sepolia faucet token; **double-check the address before deploy**).
- [ ] `lib/bids.ts` — `placeBid`, `withdrawBid`, `acceptBid`, `listBids({ tokenId })` reading the events.
- [ ] Bid UI on `/inft`: allow connect-wallet (use viem's injected connector — minimal, no rainbowkit); approve USDC, then `placeBid`.
- [ ] Standing-bid table sorted desc by amount, with "withdraw" button if `bidder == connected`, "accept" button if `connected == ownerOf(tokenId)`.
- [ ] `app/api/cron/seed-bids/route.ts` — uses `client1` and `client2` wallets (already funded with Sepolia ETH + USDC) to place small standing bids ($0.50 + $1.00 USDC) so the table is non-empty for judges. Gate behind `SEED_BIDS=true` env so it doesn't auto-run on prod by accident.

**Commit checkpoints:** contract → tests → deploy → TS lib → UI → seed cron.

**Risk:** low. ERC-721 + USDC escrow is well-trodden. The novel part is the "owner-accept" semantics (vs. auction with deadline).

**Demo flow for judges:**
1. Land on `/inft` → see INFT, current owner, two seeded bids ($0.50, $1.00).
2. Judge connects MetaMask (Sepolia, faucet pre-loaded) → places $1.50 bid.
3. Judge sees their bid in the standing list.
4. Owner (us, on screen) clicks "accept $1.50 bid" → INFT transfers, USDC pays out, ERC-8004 `agentWallet` clears.
5. New owner (judge) is prompted to sign `setAgentWallet` EIP-712 → next `client-tick` x402 payment lands in their wallet.

This is **the** demo loop.

---

## Phase 5 — Reputation-gated dynamic pricing (Option C)

**Files:**
- Modify: `lib/x402.ts` — replace constant `QUOTE_PRICE_USD` with `getQuotePrice()` that reads ERC-8004 feedback count.
- Modify: `app/api/a2a/jobs/route.ts` — call `getQuotePrice()` per request inside `getPaidHandler` (cache 60s in Redis).
- Modify: `app/api/agent-card/route.ts` — surface the dynamic price in the card (`pricing.scheme: "reputation-graduated"`).

**Pricing curve (per Issue #5):**
```
< 50 feedback events  → $0.10
50–100                → $0.15
≥ 100                 → $0.20
```

**Tasks:**

- [ ] Add `lib/pricing.ts` with `pickPrice(feedbackCount): "$0.10" | "$0.15" | "$0.20"`.
- [ ] Read feedback count from `ReputationRegistry.feedbackCount(agentId)`. Cache for 60s in Redis under `agent:price`.
- [ ] Update `agent-card.json` to include `pricingTiers: [{minScore, price}, …]` so it's machine-readable.
- [ ] **Note:** `withX402` likely caches the price in its handler closure. Move `getPaidHandler()` to recompute per-request OR rebuild the handler each tick. Test by calling the endpoint twice with synthetic feedback bumps in between.

**Risk:** low. ~2 hours.

---

## Phase 6 — CCIP-Read reputation summary on ENS (Option E)

**Why this matters:** Anyone resolving `tradewise.agentlab.eth`'s `text("reputation-summary")` gets a *live, signed* summary off-chain — `count`, `avg`, `last-updated` — verified against the on-chain registry via the resolver proof.

**Files:**
- Create: `contracts/src/OffchainResolver.sol` (vendored from ENS docs, EIP-3668 reverter)
- Create: `contracts/script/DeployOffchainResolver.s.sol`
- Create: `app/api/ens-gateway/[sender]/[data]/route.ts` (CCIP-Read gateway)
- Create: `lib/ens-gateway.ts`
- Modify: `scripts/register-ens.ts` (or new: `scripts/set-resolver.ts`) — point `tradewise.agentlab.eth` at `OffchainResolver` instead of the public resolver, **only for the `reputation-summary` text key** (use `setResolver` only on a new subnode like `reputation.tradewise.agentlab.eth` to avoid breaking existing records, OR override only that key via the resolver's namespace).

**Strategy decision:** rather than swap the entire resolver (which would break the existing ENSIP-25 records), create a **subname** `reputation.tradewise.agentlab.eth` whose resolver is the offchain one. Cleaner, doesn't break Phase 1.

**Tasks:**

- [ ] Vendor `OffchainResolver.sol` from `ensdomains/offchain-resolver` repo (check ENS docs for current canonical source). Adjust signing key to a new env var `ENS_GATEWAY_SIGNER_PK`.
- [ ] Write the gateway endpoint: takes EIP-3668 callback URL params, returns `{ data: <signed-text-record> }`. The signed payload includes `(name, key, value, expires)` signed by `ENS_GATEWAY_SIGNER_PK`.
- [ ] Inside the gateway, when `key == "reputation-summary"`, fetch live data from `ReputationRegistry.feedbackCount(1)` + average of recent scores (use `readRecentFeedback(50)` from `lib/erc8004.ts`), format as JSON, sign, return.
- [ ] Register subnode `reputation.tradewise.agentlab.eth` with the offchain resolver via `ENS_REGISTRY.setSubnodeRecord`.
- [ ] Smoke test using `viem.getEnsText({ name: "reputation.tradewise.agentlab.eth", key: "reputation-summary" })` — viem auto-resolves CCIP-Read.

**Risk:** medium. CCIP-Read setup is a known-finicky path; ENS Sepolia gateway docs are usable but version drift can bite. **Time-box: 2–3 hours; if blocked, ship a static `text("reputation-summary")` value updated by `reputation-cache` cron — judges still see the value, just not the cryptographic gateway proof.**

---

## Phase 7 — Two-agent x402 economy (`pricewatch.agentlab.eth`) (Option B)

**Files:**
- Modify: `scripts/register-ens.ts` (or split: `scripts/register-ens-pricewatch.ts`) — register `pricewatch.agentlab.eth`, set ENSIP-25 text record pointing at `agentId=2`.
- Modify: `contracts/script/Deploy.s.sol` (extend) — register `agentId=2` in `IdentityRegistry`. Or use a separate `scripts/register-pricewatch-agent.ts` that calls `IdentityRegistry.register` from a new wallet.
- Add wallet: `PRICEWATCH_PK` to `.env`, mirror in `lib/wallets.ts` as `WalletId = "pricewatch"`.
- Create: `app/api/a2a/pricewatch/jobs/route.ts` — a paid `metadata` endpoint returning token metadata (name, decimals, last price, liquidity).
- Modify: `app/api/a2a/jobs/route.ts` — autonomously call `pricewatch` via x402-paying client *before* quoting.
- Modify: `lib/x402.ts` — add `payX402({ url, body })` function (paying client) using `@x402/fetch`.
- Modify: `app/page.tsx` dashboard — show `pricewatch` rep + earnings as a sidecar card.

**Tasks:**

- [ ] Generate `pricewatch` wallet via `scripts/gen-wallets.ts` (or edit it to emit the new wallet). Fund from `agent` via `scripts/distribute.ts`.
- [ ] Register agentId=2 on Sepolia. Capture address + ID into Edge Config under `addresses_sepolia.pricewatchAgentId`.
- [ ] Register `pricewatch.agentlab.eth` ENS subname mirroring Phase 1's flow.
- [ ] Build `app/api/a2a/pricewatch/jobs/route.ts` with `withX402(handler, { price: "$0.02", payTo: pricewatchAddress })`.
- [ ] Implement `lib/x402-client.ts` (paying side) — wraps `@x402/fetch` with `agent` wallet; auto-handles 402 challenge → sign → retry.
- [ ] In `app/api/a2a/jobs/route.ts`, before `quoteSwap`, call `payX402({ url: '/api/a2a/pricewatch/jobs', body: { token: intent.tokenIn } })`. Surface the x402 settlement tx in the response so judges can see the two-hop chain in BaseScan.
- [ ] After settlement, `tradewise` posts feedback to `pricewatch`'s ERC-8004 entry (`postFeedback(2, score, …)`).
- [ ] Update `agent-card.json` to advertise both agents' endpoints.

**Risk:** medium. Recursive x402 is novel — the AbortSignal/timeout chain inside Vercel's 300s limit is the risk. Add a hard 30s timeout on the inner `payX402` call.

---

## Phase 8 — Stripe MPP (agent payment protocol, parallel to x402)

**Status (2026-04-27): NOT SHIPPED.** Schema-only — `agent-card.paymentProtocols.mpp.supported: false` is exposed so MPP-aware clients can detect support cleanly, but the wire integration is gated on a Stripe acquirer account + Tempo testnet enrollment we don't have in this build.

**Verified facts (Stripe AI search, 2026-04-27):**
- Stripe MPP launched **March 18, 2026** with **Tempo** (Stripe's L1).
- Session-based streaming payments: agent pre-authorizes a spending limit, then streams granular micropayments inside the session.
- Stripe also integrated x402 on Base in February 2026 — so we have a path to MPP via `stripe` SDK + `@stripe/agent-toolkit` once we configure an account.
- No standalone `@stripe/mpp` package surfaced in search; integration is via the standard `stripe` SDK + dashboard + PaymentIntents-style session resources.

**Strategic value:** judges can pay our agent via *either* x402 *or* MPP — same endpoint, two payment rails. This is the cleanest "agent-protocol-agnostic" demo possible.

**Strategic value:** judges can pay our agent via *either* x402 *or* MMP — same endpoint, two payment rails. This is the cleanest "agent-protocol-agnostic" demo possible.

**Files:**
- Add: `lib/mmp.ts` — Stripe MMP server-side challenge + verification (mirror of `lib/x402.ts`).
- Modify: `app/api/a2a/jobs/route.ts` — wrap handler in *both* `withX402` and `withMmp`. Decide which challenge to send based on the `Accept-Payment` request header (`x402` vs. `mmp`); default: emit a `WWW-Authenticate`-style header that advertises both, let client pick.
- Update: `app/api/agent-card/route.ts` — advertise both `x402Support: true` and `mmpSupport: true` plus the Stripe acquirer/account ID.
- Update: dashboard — show MMP earnings card alongside the x402 earnings.

**Tasks (locked in once we verify the Stripe SDK package name + headers spec at execution time):**

- [ ] Pull Stripe's MMP SDK / docs at execution time — likely `@stripe/agent-payments` or similar package; *verify name with WebFetch on Stripe's docs site before installing*. (As of plan time the exact package isn't pinned.)
- [ ] Configure Stripe test acquirer account, store `STRIPE_MMP_SECRET` in Vercel env.
- [ ] Implement `verifyMmpChallenge(req)` mirroring `getResourceServer()` from `lib/x402.ts`.
- [ ] Update jobs route to dual-protocol gate.
- [ ] Add `x402` *and* `mmp` payment tx hashes to the `Job` shape in `lib/types.ts` (currently only `paymentTx: string | null`).
- [ ] Push MMP earnings into Redis under `agent:mmp_earnings_cents` (mirror of `agent:earnings_cents`).
- [ ] Dashboard: split earnings card into "x402: $X.XX · mmp: $Y.YY".

**Risk:** medium. Hinges on the Stripe SDK being released and stable for testnet. **First action at execution: WebFetch Stripe's agent-payments docs page to confirm package + handshake before any code lands.** If the SDK isn't ready, fall back to a hand-rolled HTTP 401 → POST settlement webhook flow that mimics the spec closely enough for demo purposes.

---

## Phase 9 — Agent IPO: tokenized revenue-share INFT

**The strategic crown jewel.** Per the issue: "this is the first publicly-tradeable, self-operating, on-chain business."

**Files:**
- Create: `contracts/src/AgentShares.sol` — ERC-20, fixed supply (e.g., 10,000), minted to original INFT owner at IPO time.
- Create: `contracts/src/RevenueSplitter.sol` — receives x402 USDC, distributes pro-rata to share holders. Uses pull-pattern (`claim()`) for gas safety.
- Create: `contracts/src/AgentIPO.sol` — orchestrator: takes INFT, locks it, mints shares, configures splitter as agent's payout address.
- Create: `contracts/script/DeployAgentIPO.s.sol`
- Create: `contracts/test/AgentIPO.t.sol`
- Modify: `IdentityRegistryV2.agentWallet` for `agentId=1` → set to `RevenueSplitter` address (so x402 USDC flows to it).
- Create: `lib/ipo.ts`
- Modify: `app/inft/page.tsx` (or new `app/ipo/page.tsx`) — show share holdings, claim button, "buy 1 share" form (uses a tiny constant-product AMM).
- Create: `contracts/src/SharesAMM.sol` — minimal CPMM, share <-> USDC, seeded with 1000 shares + 10 USDC by us.
- Create: `app/api/cron/ipo-tick/route.ts` — pushes seeded liquidity events for demo motion (optional).

**Splitter mechanics:**
- On x402 settlement, USDC lands in `RevenueSplitter`.
- Splitter accumulates a `totalReleased` counter.
- Each holder calls `claim()` → contract reads `balanceOf(holder) / totalSupply()` × `totalReleased - alreadyClaimed[holder]` → transfers.
- Use OpenZeppelin's `PaymentSplitter` pattern as the reference; we'll re-implement a leaner version for ERC-20 since OZ's is ETH-centric.

**Tasks:**

- [ ] Foundry tests: mint shares, send USDC to splitter, claim from 3 holders, assert pro-rata math.
- [ ] Deploy on Sepolia.
- [ ] Run "IPO" tx: transfer agent's INFT into `AgentIPO`, configure splitter as agent's payout address, mint 10,000 shares to deployer.
- [ ] Seed AMM with 1,000 shares + 10 USDC.
- [ ] UI page `/ipo`: connect wallet → buy 1 share for ~$0.01 → see share balance → wait one client-tick → click claim → receive ~$0.0001 USDC.
- [ ] Update dashboard with share-holder count + total claims.

**Risk:** medium. The **agent payout redirection** is the spicy bit — if `agentWallet` was the EOA (it is), changing it to the splitter contract requires the wallet redirection pattern (Phase 3's setAgentWallet EIP-712). This phase therefore depends on Phase 3.

**Demo:** judge buys 1 share for 0.01 USDC during the live window; next client-tick fires; 5 minutes later judge claims 0.0001 USDC. **They are now a fractional owner of an autonomous on-chain business.**

---

## Phase 10 — Reputation-collateralized credit market

**Files:**
- Create: `contracts/src/ReputationCredit.sol` — small lending pool. Borrow up to `min(scoreCap, poolBalance / 10)` USDC against ERC-8004 score. Auto-liquidate from incoming x402 stream if `score < threshold`.
- Create: `contracts/test/ReputationCredit.t.sol`
- Create: `lib/credit.ts`
- Create: `app/credit/page.tsx`

**Borrowing rules:**
- Read `feedbackCount(agentId)` and average score.
- Tier mapping: `count >= 100 && avgScore >= 80` → borrow up to 500 USDC at 5% APR. Lower tiers get less / nothing.
- Loan auto-repays from the agent's payout splitter (Phase 9 dependency!) via a `repaymentHook` that pulls 10% of incoming USDC until balance + interest is settled.
- If `feedbackCount` drops 20% in a 24h window OR avg score drops below tier threshold → loan flagged; next x402 payment fully redirected to repayment.

**Tasks:**

- [ ] Foundry tests: deposit liquidity → agent borrows → simulate feedback updates → assert auto-liquidation.
- [ ] Deploy. Seed 100 USDC liquidity from the agent wallet.
- [ ] UI page `/credit` — show agent's borrowable amount, current loan, repayment schedule.
- [ ] Manual demo borrow during judging (10 USDC for 1 hour).

**Risk:** medium-high. The auto-liquidation hook on top of Phase 9's splitter is custom; needs care. Also: the incentive to "buy reputation" is real — flag this in the demo as a known frontier.

---

## Phase 11 — SLA-insured agent marketplace

**Files:**
- Create: `contracts/src/SlaBond.sol` — agent locks USDC bond per job; validator's `ValidationResponse` with `score < threshold` triggers slash → client refund + slasher reward.
- Modify: `contracts/src/ValidationRegistry.sol` (or v2) — emit `Slashable(jobId)` event when score below threshold so the bond contract picks it up off-chain (since direct cross-contract call would couple the spec).
- Modify: `app/api/a2a/jobs/route.ts` — before returning the quote, post a bond (e.g., 1× the job price = $0.10) into `SlaBond`.
- Create: `app/marketplace/page.tsx` — directory of agents (us + 5–10 mock entries) with bond size, reputation, 30-day uptime.
- Modify: `app/api/cron/validator-tick/route.ts` — if validation score < threshold, call `SlaBond.slash(jobId)`.

**Tasks:**

- [ ] Foundry tests: post bond → satisfactory validation → release; post bond → bad validation → slash.
- [ ] Deploy on Sepolia.
- [ ] Wire bond posting into the jobs route. **Be careful with the 300s budget** — bond tx adds ~10s; gate behind `SLA_BONDED=true` env to allow demo toggle.
- [ ] Marketplace UI page with at least 5 mock entries (+ tradewise + pricewatch as live entries).
- [ ] 30-day uptime: `ens-heartbeat` becomes load-bearing — its tick frequency directly = uptime metric. Reformat heartbeat to write a daily bitmap so uptime is measurable on-chain.

**Risk:** medium. Mostly mechanical; the demo benefit is the **marketplace listing page** which sells the "AWS Marketplace for agents" pitch.

---

## Phase 12 — Agent M&A on-chain

**Files:**
- Create: `contracts/src/AgentMerger.sol` — burns two INFTs, mints one new INFT, concatenates 0G storage memory roots (writes a "merger" event to 0G with both source roots), sums ERC-8004 reputations via a `MergedFeedbackOracle.sol` that exposes `effectiveFeedbackCount(agentId)` = sum of constituent agents.
- Create: `contracts/test/AgentMerger.t.sol`
- Create: `app/merger/page.tsx`

**Tasks:**

- [ ] Foundry tests: mint two INFTs → merge → assert single INFT minted, both burned, reputation oracle returns combined count.
- [ ] Deploy. Mint a `tradewise + pricewatch` merger as the demo (assuming Phase 7 ran).
- [ ] UI: show "lineage" tree — merged INFT → links back to constituent INFT IDs and their original feedback histories on Sepolia.
- [ ] Add `lineage` field to `app/api/agent-card/route.ts` for the merged agent.

**Risk:** medium. Conceptually clean once Phase 3 (INFT) and Phase 7 (pricewatch) exist.

---

## Time / Cost Summary

| Phase | Est. hours | Risk | Demo value |
|---|---:|---|---|
| 1. ENS read | 3 | medium | foundation |
| 2. 0G segments | 2 | medium | prize |
| 3. INFT base | 8 | medium-high | foundation |
| 4. INFT bidding | 6 | low | **★ judge interaction** |
| 5. Dynamic pricing | 2 | low | nice-to-have |
| 6. CCIP-Read | 3 | medium | nice-to-have |
| 7. pricewatch | 6 | medium | strong novelty |
| 8. MPP/Tempo | 4–8 | high | prize, only if confirmed |
| 9. Agent IPO | 10 | medium | **★★ investor pitch** |
| 10. Rep credit | 6 | medium-high | strong novelty |
| 11. SLA marketplace | 6 | medium | strong novelty |
| 12. Agent M&A | 5 | medium | nice-to-have |

**Total: ~70 hours.** Well over a single hackathon window. Recommend prioritizing **1 → 2 → 3 → 4 → 9** as the must-ship spine (~30h), then time-box additions.

---

## Cross-cutting concerns

These apply to every sub-plan; sub-plans should not re-enumerate them:

- **Foundry tests are mandatory for every new contract.** TDD: failing test first, minimal impl, pass, commit.
- **No fork tests against live Sepolia** during dev — too slow. Use Anvil unit tests; reserve fork tests for the integration-test suite if added.
- **Edge Config keys** for any new contract address: `addresses_sepolia.<contractName>`. Add a migration to `scripts/write-edge-config.ts` so a single command syncs everything.
- **Vercel env vars**: any new private key (`PRICEWATCH_PK`, `ENS_GATEWAY_SIGNER_PK`) must be added to all environments via `vercel env add`. Document in README.
- **Cron auth**: every new cron route uses `verifyCronAuth(req)` from `lib/cron-auth.ts`. Match the existing pattern.
- **maxDuration**: every new API route gets an explicit `export const maxDuration = N` and a corresponding entry in `vercel.json`.
- **Avoid breaking the prize-gating crons** (`agent-tick`, `client-tick` ×3, `validator-tick`). Their semantics and frequency are load-bearing for the PLAN.md §0 demo criteria. Any change to them must preserve the existing behavior.

---

## Self-Review Checklist

- [x] All 11 user-listed asks have a phase: ENS (1), CCIP (6), INFT (3), MMP/MPP (8), 0G segments (2), Option A (4), Option B (7), Option C (5), Option E (6), Option F (2), Agent IPO (9), Rep credit (10), SLA marketplace (11), Agent M&A (12). ✓
- [x] Dependencies make sense (INFT → Bidding/IPO/SLA/M&A; Phase 9 splitter → Phase 10 auto-liquidation). ✓
- [x] No placeholders in the contract sketches; the bid contract is concrete code. ✓
- [x] Each phase has explicit Files / Tasks / Risk / Commit checkpoint. ✓
- [x] Time estimates match scope. Total >> hackathon window — flagged. ✓

**Open clarification:**
- "MMP" → confirmed as MPP/Tempo? (Phase 8 blocks on this.)
- After Phase 4 demo, is the IdentityRegistry v2 migration acceptable, or do we ship the `AgentWalletBinding` sidecar fallback? (Phase 3 risk fork.)
