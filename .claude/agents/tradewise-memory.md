# tradewise-memory

Deep-context memory for the `tradewise-agent` subagent. Updated whenever the codebase shifts in a way that the system prompt can't carry on its own (new modules, new flows, new conventions discovered during work). The agent's system prompt has the *shape* of the system; this file has the *map*.

## 1. End-to-end flows worth tracing

These are the load-bearing flows. If you're investigating a bug or extending behavior, find which one you're in first.

### 1.1 x402 quote → settle (M1 hackathon-era, demoted but still live)

```
client → POST /api/a2a/jobs                              (lib/x402.ts paywall)
   ↓ challenge 402, client re-POSTs with X-PAYMENT
   ↓ on settlement, /api/a2a/jobs:
       lib/uniswap.ts → quote (or mockQuote)
       lib/pricewatch.ts → optional upstream pricewatch call (the two-hop demo)
       redis.pushJob / recordSettledPayment
       triggerKeeperHub({kind:"swap"})        ← gracefully nulls; no live workflow
       waitUntil → zg-storage.appendJobLog    ← 0G anchor for the trade log
       triggerKeeperHub({kind:"reputation-cache"}) (debounced 5min)
```

Money flow: client pays `payTo` (agent EOA or X402_PAYOUT_OVERRIDE). Earnings counted in `agent:earnings_cents` in Redis. Code path is fine; the strategy itself is just stub Uniswap quoting.

### 1.2 M1 strategy loop (Base Sepolia, working today)

```
KH TreasuryFundingPoll (every 5min)
   → reads MockPerpExchange.fundingRatePerSecond() on Base Sepolia
   → POST /api/keeperhub/funding-poll (bearer auth)
       lib/redis.pushFundingSnapshot
KH TreasuryStrategyTrigger (every 15min)
   → GET /api/cron/treasury-strategy (bearer CRON_SECRET)
       lib/treasury.readTreasury           ← on-chain state
       lib/redis.getLatestFundingSnapshot  ← funding from KH cache
       lib/treasury-strategy.decide()      ← pure
       lib/treasury.openPosition/close     ← AGENT_PK on Base Sepolia
       lib/treasury-log.appendTradeLog     ← 0G + Redis
       lib/redis.pushKeeperhubRun          ← dashboard surface
KH TreasuryHeartbeatTrigger (every 30min)
   → GET /api/cron/treasury-heartbeat (bearer CRON_SECRET)
       lib/treasury.pingHeartbeat          ← AGENT_PK calls TradingTreasury.heartbeat()
KH TreasuryKillSwitch (hourly)
   → reads TradingTreasury.heartbeatStale() via web3/read-contract
   → Condition node: if true, web3/write-contract emergencyExit() via Turnkey
       (Turnkey is permissioned only for emergencyExit-when-stale, not the trade path)
```

### 1.3 M1 dividend cycle

```
KH TreasuryDividendDistribute (weekly, Sundays 00:00 UTC)
   → POST /api/keeperhub/distribute-dividend (bearer auth)
       lib/treasury.readTreasury → balance
       if balance > 0.1 USDC reserve:
         lib/treasury.distributeRevenue(balance - reserve) ← agent EOA
         lib/treasury-log.appendTradeLog (action: "distribute")
       lib/redis.pushKeeperhubRun (kind: "dividend-distribute")
```

Proved end-to-end: 0.4 USDC distributed via tx 0x9c9a6afb…, treasury now at 0.1 USDC reserve.

### 1.4 M2 HL strategy loop (built, awaiting HyperEVM deploy)

```
KH TreasuryStrategyHLTrigger (every 15min)
   → GET /api/cron/treasury-strategy-hl
       lib/hyperliquid-treasury.readHlTreasury
           ← reads HyperliquidTreasury state via viem on HyperEVM
           ← passthroughs to L1Read precompiles
       lib/hyperliquid.getFundingRate (REST POST /info on HL testnet/mainnet)
       lib/treasury-strategy-hl.decide()
       lib/hyperliquid-treasury.openPosition/closePosition
           ← AGENT_PK on HyperEVM → HyperliquidTreasury → CoreWriter (0x3333...)
       lib/treasury-log.appendTradeLog
```

Skips silently when `HYPERLIQUID_TREASURY_ADDRESS` env is unset.

### 1.5 ENS resolution (CCIP-Read offchain resolver)

```
client query for *.agentlab.eth
   → on-chain OffchainResolver.resolve() reverts OffchainLookup(...)
   → CCIP-Read client GETs /api/ens-gateway/[sender]/[data]
       lib/ens-gateway.ts: decode call → fetch record → EIP-191 sign with EXPECTED_GATEWAY_SIGNER
       Records sourced from on-chain state via lib/ens-records.ts + lib/erc8004.ts
   → client returns signed response to OffchainResolver.resolveWithProof()
   → resolver verifies sig, returns the record value
```

10 fields returned in ~1.7s. ENS heartbeat workflow updates the `last-seen-at` text record via Turnkey wallet (different ENS resolver path).

### 1.6 INFT mint / transfer (production-grade)

```
mint (oracle-attested):
   lib/inft-oracle.prepareMint → 0G compute → returns proof
   AgentINFTVerifier on-chain verifies oracle sig
   AgentINFT.mintWithProof → links agentId

transfer:
   /api/inft/transfer/prepare → returns OffchainLookup
   oracle re-encrypts memory blob (zg-compute)
   /api/inft/transfer/confirm → on-chain transferWithProof
   on transfer hook: clearAgentWalletOnTransfer in IdentityRegistryV2
```

The INFT path is the *most polished* code in the repo. AgentINFTVerifier is genuinely well-built (replay protection via usedNonces, two-signature design). See the original code review for why.

## 2. Where to look for X

| Want to | Look at |
|---|---|
| Add a new strategy decision branch | `lib/treasury-strategy.ts` or `lib/treasury-strategy-hl.ts` (pure functions) |
| Add a new KH workflow | `lib/keeperhub-workflows.ts` (builder) + `scripts/setup-*.ts` (provisioner) |
| Add an endpoint a KH workflow can call | `app/api/keeperhub/*` for new webhooks, `app/api/cron/*` for cron-triggered |
| Read on-chain state into the dashboard | Use existing `readTreasury` / `readHlTreasury` patterns + `getRecent*` from redis.ts |
| Write to the trade log | `lib/treasury-log.appendTradeLog` with a built entry from `buildOpenEntry` / `buildCloseEntry` / `buildDistributeEntry` |
| Update contract addresses across the app | Edge Config `addresses_base_sepolia` (read via `lib/edge-config.getBaseSepoliaAddresses`). Patch via `vercel edge-config update hackagent --patch '{"items":[...]}'` |
| Move USDC HL spot ↔ perp inside the treasury | `HyperliquidTreasury.moveToPerp(amount)` / `.moveToSpot(amount)` — wraps `usdClassTransfer` |
| Sign for HL externally | `lib/hyperliquid.placeOrder` / `signWithdraw` — uses viem `signTypedData`, no Python SDK needed |
| Construct an HL action payload from a contract | `HyperliquidActions.encodeLimitOrder(...)` → `HyperliquidActions.send(bytes)` → CoreWriter |
| Read on-chain HL state from a contract | `L1Read.position2(this, asset)`, `oraclePx(asset)`, etc. |

## 3. Conventions specific to this codebase

- **Pure decision functions.** `decide()` in strategy libs is pure — input shape, output Action. Smoke tests via `scripts/strategy-*-smoke.ts` rather than full integration tests. Add cases to the smoke when adding branches.
- **Trade-log on every state-changing tx.** Strategy cron + dividend endpoint already wrap successful txes with `appendTradeLog`. New tx paths should follow.
- **KH-first for new schedules.** `lib/keeperhub-workflows.buildScheduledCronTrigger` is the generic shape. Endpoint stays Vercel; KH drives the cadence.
- **CronAuth bearer = `CRON_SECRET`.** Vercel cron and KH-triggered webhooks both use it. The endpoint pattern is `verifyCronAuth(req)` → `recordCronTick(ROUTE, ok|fail)` → JSON response.
- **`{{$run.id}}` is BANNED in webhook payloads.** KH's strict resolver rejects it. Use `{{@trigger:Label.data.triggeredAt}}` + synth ids app-side (see `pushKeeperhubRun` fallback `${kind}-${ts}`).
- **HyperliquidTreasury intentionally does NOT implement `IPerpExchange`.** HL semantics differ (account-level margin, no positionId, no per-trade collateral). Forcing the shape would hide the mismatch.
- **Edge Config is the source of truth for contract addresses,** not env vars. Code already reads via `lib/edge-config.ts`. After redeploy, patch Edge Config — don't `vercel env add`.
- **ABI sync.** After contract changes, `pnpm tsx scripts/sync-abis.ts`. New contracts must be added to the `CONTRACTS` array in that script.

## 4. Module-level map

The three sections below are populated by the agent-exploration pass and updated whenever the repo materially shifts.

### 4.1 lib/

Six interdependent domains. Action is heaviest in capital stack, identity-and-trust, and the x402/quoting layer. M2 work concentrates in `hyperliquid*.ts` and `treasury-strategy-hl.ts`.

**Capital stack & treasury (M1)**
- `ipo.ts` — reads AgentShares / RevenueSplitter / SharesSale state + purchase + claim events. Returns `IpoView`, `IpoEvent`. Used by `/api/treasury` and `/api/shares`.
- `treasury.ts` — viem wrappers for TradingTreasury: `readTreasury()` + write helpers (`pingHeartbeat`, `openPosition`, `closePosition`, `distributeRevenue`, `depositToExchange`, `withdrawFromExchange`).
- `treasury-strategy.ts` — pure `decide(state, funding) → Action`. Smoke at `scripts/strategy-smoke.ts`.
- `treasury-log.ts` — `appendTradeLog` writes JSON blob to 0G (anchors merkle root + uploads segments) + Redis ring buffer. Exposes `getRecentTradeLog` for the dashboard. `buildOpenEntry`/`buildCloseEntry`/`buildDistributeEntry` are the helpers.
- `funding-hub.ts` — single-fn helper (`getFundingHubAddress`) for FUNDING_HUB_PK fallback.

**HL stack (M2)**
- `hyperliquid.ts` — TS REST client. `getMeta`, `getAssetIndex`, `getFundingRate`, `getClearinghouseState`, `getPosition`, `placeOrder`, `openPosition`, `closePosition`, `signWithdraw`, `withdraw`. Pure viem signing (msgpack + keccak + EIP-712 phantom-agent for L1 actions; EIP-712 user-signed for withdraw). Smoke at `scripts/hl-smoke.ts` + `scripts/hl-write-smoke.ts`.
- `hyperliquid-treasury.ts` — viem wrappers for the on-chain HyperliquidTreasury contract. `readHlTreasury()` + write helpers. Address from `HYPERLIQUID_TREASURY_ADDRESS` env; module no-ops if unset so it ships safely before HyperEVM deploy.
- `treasury-strategy-hl.ts` — pure HL-shape `decide()`. Funding in hourly units, account-level margin, account-indexed position. Thresholds: `OPEN_THRESHOLD_HOURLY = 5e-5`, `CLOSE_THRESHOLD_HOURLY = 2.5e-5`. State-divergence case (synth open vs HL flat) returns skip. Smoke at `scripts/strategy-hl-smoke.ts`.

**KeeperHub**
- `keeperhub.ts` — MCP client: `getSession`, `callSwapWorkflow`, `triggerKeeperHub({kind, input, pollForTx})`, `triggerKeeperHubByKind`, `getWorkflowRun`. SSE parser. Workflow IDs resolved by kind via `lib/edge-config`.
- `keeperhub-workflows.ts` — workflow spec builders. Constants: `INTEGRATION_ID = "i2ywfgrbbmtpr0hf1xh80"`, signer `"test"`, Turnkey wallet `0xB28cC07F397Af54c89b2Ff06b6c595F282856539`. Exports `buildEnsPrimaryNameSetter`, `buildEnsAvatarSync`, `buildGatewayCacheInvalidator`, `buildTreasuryKillSwitch`, `buildTreasuryFundingPoll`, `buildTreasuryDividendDistribute`, `buildScheduledCronTrigger` (generic wrapper for migrating Vercel crons onto KH).

**ENS**
- `ens.ts` — resolves the agent's ENS records (tradewise.agentlab.eth). `resolveAgentEns` returns `{address, lastSeenAt, ...}`. Updates via KH heartbeat workflow.
- `ens-constants.ts` — Sepolia ENS addresses (`SEPOLIA_PUBLIC_RESOLVER`, `SEPOLIA_ENS_REGISTRY`, ENS_TEXT_KEYS list, RESOLVER_ABI). `AGENT_ENS`, `PARENT_ENS`, `AGENT_SUBNAME` literals.
- `ens-gateway.ts` — DNS-wire decoder + EIP-191 signer for the CCIP-Read gateway. `decodeDnsName`, `signGatewayResponse`. Hardcoded WALLET_LABELS (Turnkey + AGENT_PK addresses).
- `ens-records.ts` — high-level text-record reader with 8s timeout fallback. Used by `/api/agent-card`.

**Persistence**
- `redis.ts` — IORedis singleton + everything that touches Redis: `pushJob`, `pushKeeperhubRun`, `pushFundingSnapshot`, `getRecentTradeLog` (via treasury-log), `tryAcquireDebounce`, `recordCronTick`, `getAllCronStatuses`. Types: `KeeperhubRunKind`, `KeeperhubRun`, `FundingSnapshot`, `PricewatchCall`.
- `edge-config.ts` — Vercel Edge Config loader. Types: `AddressMap` (Sepolia), `BaseSepoliaAddressMap` (Base + HL). `KeeperHubKind` union. Lookups: `getSepoliaAddresses`, `getBaseSepoliaAddresses`, `getKeeperHubWorkflowIdByKind`. **Source of truth for contract addresses.**

**Agent identity & trust (mostly honest-cuts)**
- `erc8004.ts` — reads on-chain ERC-8004 reputation + validation events. `readRecentFeedback`, `readValidationHistory`. Used on `/` dashboard + `/api/agent-card`.
- `inft.ts` — reads AgentINFT state (memory root/URI, oracle, verifier). `readInft`, `getInftAddresses`, `inftOwner`, `transfer`.
- `inft-oracle.ts` — AES-GCM blob encryption. `aesKeyFresh`, `encryptBlob`, `decryptBlob`, `oracleAddress`. Used by `/api/inft/oracle/*`.
- `inft-redis.ts` — HKDF-wrapped per-token AES key store in Redis.
- `bids.ts` — AgentBids events (honest-cuts: contract marked for removal). `readStandingBids`, `readBidHistory`.
- `merger.ts` — AgentMerger events (honest-cuts). `MergerLineage`, `readMergerHistory`.
- `compliance.ts` — ComplianceManifest reader (honest-cuts).
- `credit.ts` — ReputationCredit reader (honest-cuts).
- `rep-summary.ts` — reputation aggregation for ENS `reputation-summary` text record.

**x402 / quoting**
- `x402.ts` — server setup. `BASE_SEPOLIA_USDC`, `QUOTE_PRICE_USD = 0.10`. ExactEVM scheme. Used by `/api/a2a/jobs`.
- `x402-client.ts` — `payingFetchFor(walletId)`. `decodePaymentResponse` extracts tx hash + payer from response headers.
- `uniswap.ts` — Uniswap Trading API (mainnet) for quote lookups. `quoteSwap` + `mockQuote` fallback when no API key.
- `pricewatch.ts` — token metadata + price lookups. `KNOWN_METADATA` + `FAKE_PRICES` hardcoded (honest-cuts: marked for replacement).
- `pricing.ts` — reputation-graduated x402 pricing. Tiers `0/$0.10`, `50/$0.15`, `100/$0.20`. `pickPrice(feedbackCount)`.

**0G**
- `zg-storage.ts` — `writeBytes`, `writeState`, `writeBlob`, `appendJobLog`. Anchors merkle roots on Galileo chain 16602 + uploads segments. `readState` / `listRecentJobLogs` are stubs returning `null` / `[]`.
- `zg-compute.ts` — 0G inference broker. Lists services, selects provider, acknowledges signer. `inference`, `tokenCount`, `callInference`.

**Infrastructure**
- `wallets.ts` — viem account loader by `WalletId` (`agent`, `client1..3`, `validator`, `pricewatch`). Public + wallet clients for Sepolia, Base Sepolia, HyperEVM. Exports the `hyperEvm` defineChain.
- `cron-auth.ts` — `verifyCronAuth(req)`, `unauthorized()`, `getCronStatuses()`. Bearer-token timing-safe compare against `CRON_SECRET`.
- `log-chunks.ts` — chunked `getLogs` wrapper for RPCs with the 50k-block cap. Used by every event-history reader.
- `types.ts` — Zod schemas: `SwapIntent`, `Quote`, `PricewatchSummary`, `Job`, `CronStatus`.

### 4.2 app/api/

**a2a — x402 quoting**
- `POST /api/a2a/jobs` — Uniswap-quote endpoint paid in x402 USDC. Reputation-graduated pricing. Fires: KH `swap`, debounced `reputation-cache`, 0G job log, redis settled-payment. The hackathon's headline path; demoted in the M2 brief.
- `POST /api/a2a/pricewatch/jobs` — sidecar pricewatch endpoint, $0.02 per call. Two-hop demo of agent-to-agent x402.

**agent identity**
- `GET /api/agent-card` — EIP-8004 v1 agent card. Public. Reads ENS records, pricing tiers, treasury, contract addresses, INFT.
- `GET /api/role-addresses` — public role-address map.

**treasury (M1+M2)**
- `GET /api/treasury` — public read of TradingTreasury state. Used by dashboard.
- `POST /api/treasury` — CRON_SECRET-gated. Dispatch by `{action: heartbeat|deposit|withdraw|open|close|distribute}`. AGENT_PK writes.
- `GET /api/cron/treasury-heartbeat` — KH-triggered (TreasuryHeartbeatTrigger). Pings TradingTreasury.heartbeat() from AGENT_PK.
- `GET /api/cron/treasury-strategy` — KH-triggered (TreasuryStrategyTrigger). Reads on-chain state + funding snapshot, runs decide(), executes open/close.
- `GET /api/cron/treasury-strategy-hl` — KH-triggered (TreasuryStrategyHLTrigger). HL-stack variant; skips if `HYPERLIQUID_TREASURY_ADDRESS` unset.
- `POST /api/keeperhub/distribute-dividend` — KH webhook (TreasuryDividendDistribute weekly). Reads balance, distributes balance − 0.1 USDC reserve. Bearer KEEPERHUB_WEBHOOK_SECRET.
- `POST /api/keeperhub/funding-poll` — KH webhook (TreasuryFundingPoll, 5min). Stashes funding snapshot in Redis. Bearer.

**KH webhooks**
- `POST /api/webhooks/keeperhub` — unified post-run sink. Accepts any KeeperhubRunKind. Compliance-attest path parses on-chain vs expected manifest roots and derives a verified/DRIFT summary.
- `POST /api/keeperhub/heartbeat-pulse` — push heartbeat → Redis `last-seen-at` (vs on-chain setText). Used by /api/a2a/jobs as the "fast path" for ENS heartbeat freshness.
- `POST /api/keeperhub/reputation-pulse` — push reputation cache → Redis. Companion to heartbeat-pulse.

**ENS gateway (CCIP-Read)**
- `GET/POST /api/ens-gateway/[sender]/[data]` — EIP-3668 offchain resolver gateway. Decodes ABI calldata for `addr()`, `text(node,key)`, `contenthash()`; signs the response with EXPECTED_GATEWAY_SIGNER (EIP-191 bound to `address(this)`). The keystone of the ENS story.
- `POST /api/ens-gateway/cache/invalidate` — KH-triggered cache invalidation after on-chain events (MemoryReencrypted, MemoryStaled, BidPlaced, etc.). Bearer.
- `GET /api/ens` — public ENS records dashboard. Resolves text + addr against Sepolia resolver with latency timing.

**INFT oracle (ERC-7857, oracle-attested re-encryption)**
Two layers: **public** routes do auth (sig / rate-limit) then proxy to **internal** oracle routes which do the heavy lifting.

Public:
- `GET /api/inft/[tokenId]` — ERC-7857 metadata (OpenSea-style). Public, cached 30s.
- `POST /api/inft/transfer/prepare` — EIP-191 sig + rate-limit, proxies to oracle/prepare-transfer.
- `POST /api/inft/transfer/confirm` — verifies Transferred event server-side, proxies to oracle/confirm-transfer.
- `POST /api/inft/transfer/reveal` — owner-sig auth, proxies to oracle/reveal.

Oracle internals (require INFT_ORACLE_API_KEY):
- `POST /api/inft/oracle/seal-blob` — encrypt plaintext under fresh AES key, anchor to 0G, build mint proof.
- `POST /api/inft/oracle/prepare-merge` / `confirm-merge` — two-INFT merge with re-encryption.
- `POST /api/inft/oracle/prepare-transfer` / `confirm-transfer` — bidder-pubkey-recovery via DelegationSet sig, re-encrypt, on-confirm trigger avatar-sync + gateway-invalidate KH workflows.
- `POST /api/inft/oracle/reveal` — decrypt current owner's blob with nonce-replay protection.
- `GET /api/inft/oracle/meta` — Redis rotation counter per token.
- `GET /api/inft/oracle/key` — oracle + verifier addresses.

**Legacy crons (Vercel cron, non-treasury)**
- `GET /api/cron/agent-tick` — P3+ pending-job draining stub.
- `GET /api/cron/client-tick?id=1..3` — drives the three demo client wallets. Honest-cuts: removable.
- `GET /api/cron/validator-tick` — every 12h, posts ERC-8004 validation request + response.
- `GET /api/cron/storage-sync` — Redis → 0G flush stub (P3 placeholder).
- `GET /api/cron/reputation-cache` — daily safety-net (push path is primary).
- `GET /api/cron/ens-heartbeat` — daily safety-net (push path is primary).
- `GET /api/cron/compliance-attest` — every 6h drift check. Honest-cuts: removable when compliance contract goes.

**Dev / stub**
- `GET/POST /api/mcp` — 501 not_implemented. Honest-cuts: build it OR remove from agent-card.
- `POST/GET /api/dev/funding` — local-only funding helper.

**Auth patterns**
- `CRON_SECRET` (Bearer) — all `/api/cron/*`.
- `KEEPERHUB_WEBHOOK_SECRET` (Bearer) — `/api/keeperhub/funding-poll`, `/api/keeperhub/distribute-dividend`, `/api/keeperhub/heartbeat-pulse`, `/api/keeperhub/reputation-pulse`, `/api/ens-gateway/cache/invalidate`.
- `INFT_ORACLE_API_KEY` — `/api/inft/oracle/*` internals.
- EIP-191 sig — public INFT routes (transfer prepare/confirm/reveal).
- x402 paywall — `/api/a2a/jobs`, `/api/a2a/pricewatch/jobs`.
- public — agent-card, dashboard reads, ENS gateway (the sig is *part of the response*, not auth).

### 4.3 contracts/src/ + scripts/

**Capital stack**
- `AgentShares` — ERC-20, fixed 10k supply. `_update` hook calls `splitter.syncOnTransfer(from, to)` before balances change so the per-share accumulator stays consistent across transfers. `setSplitter` is one-shot, deployer-only.
- `RevenueSplitter` — MasterChef-style accumulator: `accPerShareStored` + `lastBalance` + per-holder `userAccPerShare` + `pending`. `claim()` syncs global accumulator from inbound USDC, accrues caller, transfers. `syncOnTransfer` callable only by the shares contract. **Bug history:** old PaymentSplitter math (`released[user]` + balanceOf-based entitled) was unsound for transferable shares; rewrote in this session.
- `SharesSale` — fixed-price primary issuance, $0.005/share. Deployer-only `withdrawShares`.

**Trading (M1)**
- `TradingTreasury` — agent-only `openPosition(size, collateral)`/`closePosition()`/`distributeRevenue(amount)`/`depositToExchange`/`withdrawFromExchange`. Owner can `rotateAgent`/`rotateExchange` (only when flat)/`setHeartbeatTimeout` (1h..7d)/`kill`. **Heartbeat** updated on every state-changing call. `emergencyExit(reason)`: permissionless once stale OR `onlyOwner` anytime. Closes position, withdraws collateral, drains every USDC to splitter, sets `killed = true`.
- `MockPerpExchange` — `deposit`/`withdraw`/`openPosition(size, collateral) → positionId`/`closePosition(positionId) → pnl`/`fundingRatePerSecond()`/`collateralOf(address)`. Owner-settable `markPrice` + `fundingRatePerSecond`. **Counter-party pool** required for tests (mint USDC directly to the exchange).

**Trading (M2 / HL)**
- `HyperliquidTreasury` — separate surface from TradingTreasury. `moveToPerp(amount)`/`moveToSpot(amount)` for HL spot↔perp via `usdClassTransfer`. `openPosition(isBuy, limitPx, size, tif)` returns synthetic positionId = `keccak(asset, openedAt, isBuy, size, limitPx)`. `closePosition(limitPx)` reads HL size from L1Read.position2, sends reduce-only IOC. `emergencyExit(closeLimitPx, reason)` wraps L1Read in try/catch so precompile reverts never block the kill. Asset immutable at deploy.
- `L1Read` — library. Constants for precompile addresses 0x0800..0x0813. Gas caps `2000 + 65*(in+out) + ~20%`. Exposes `position`/`position2` (uint32 perp), `oraclePx`, `markPx`, `withdrawable`, `accountMarginSummary`, `perpAssetInfo`.
- `HyperliquidActions` — library + `ICoreWriter` interface to `0x3333333333333333333333333333333333333333`. TIF constants `ALO=1`, `GTC=2`, `IOC=3`. Encoders: `encodeLimitOrder`, `encodeUsdClassTransfer`, `encodeCancelByOid`, `encodeCancelByCloid`. Wrapper header: `version(1) || actionId(uint24 BE) || abi.encode(params)`. `send(bytes)` pushes through CoreWriter.

**INFT identity (well-built, keep)**
- `AgentINFT` — ERC-7857 with re-encryption oracle hook. `mintWithProof`, `transferWithProof`. Calls `clearAgentWalletOnTransfer` on IdentityRegistryV2 on transfer.
- `AgentINFTVerifier` — IERC7857DataVerifier impl. `verifyPreimage` (mint) + `verifyTransferValidity` (transfer). Replay protection via `usedNonces`. Two-signature design. The most genuinely thoughtful contract in the repo.
- `IERC7857DataVerifier` — interface.

**ERC-8004 identity stack**
- `IdentityRegistry` — v1 agent registration. `register(domain, address)`, `update`. Permissionless.
- `IdentityRegistryV2` — adds EIP-8004 §4.4 anti-laundering. `setAgentWallet` requires EIP-712 sig from INFT owner. `clearAgentWalletOnTransfer` is `onlyInft`. **Known issue:** the old `update()` method can be used to bypass the EIP-712 path because the original agentAddress can still call it; documented in the original code review as HIGH severity.
- `ReputationRegistry` — `postFeedback`. **Permissionless** — the original code review flagged this as a HIGH sybil-vector. Mitigation deferred; ReputationCredit (which depends on this) is on the honest-cuts list.
- `ValidationRegistry` — `requestValidation` + `postResponse`. Permissionless validator set.

**Honest-cuts** (deprecated by the trading-agent brief — do not extend)
- `AgentBids` — OpenSea-style standing offers. EIP-712 delegation + oracle-attested transfer. Marked for removal.
- `AgentMerger` — on-chain agent M&A. Marked for removal.
- `ReputationCredit` — uncollateralized USDC credit line. Front-runnable, sybil-able. Marked for removal.
- `SlaBond` — slashable bond per job. `release` callable by agent at any time → bond is cosmetic. Marked for removal.
- `ComplianceManifest` — `commitManifest` is front-runnable (no check that msg.sender matches the IdentityRegistry agent address). Marked for removal.

**ENS**
- `OffchainResolver` — EIP-3668 wildcard resolver for `*.agentlab.eth`. Reverts `OffchainLookup` to the gateway. `resolveWithProof` verifies EIP-191 sig bound to `address(this)`. The signature timestamp check prevents replay. Keep.

---

**Scripts (one-line each)**

Bootstrap / setup
- `gen-wallets.ts` — generate test wallets. **Footgun:** prints PKs to stdout (review flag).
- `distribute.ts` — fund test wallets with ETH + USDC.
- `register-ens.ts` — register agent ENS name on Sepolia.
- `register-pricewatch.ts` — bootstrap pricewatch sidecar.
- `seed-ens-static.ts` — seed default ENS text records.
- `set-agentlab-resolver.ts` — wire OffchainResolver as agentlab.eth resolver.
- `setup-primary-names.ts` — configure reverse ENS for locally-held wallets.
- `write-edge-config.ts` — write runtime config JSON.

KH provisioning
- `setup-keeperhub-workflows.ts` — original 3 ENS workflows.
- `setup-treasury-killswitch.ts` — TreasuryKillSwitch (M1).
- `setup-treasury-funding-poll.ts` — TreasuryFundingPoll (M1).
- `setup-treasury-dividend.ts` — TreasuryDividendDistribute (M1).
- `setup-treasury-cron-triggers.ts` — TreasuryHeartbeatTrigger + Strategy + StrategyHL (KH-first migration).
- `update-funding-poll.ts` / `update-killswitch.ts` — re-push specs without recreating.
- `patch-keeperhub-workflows.ts` — bulk patcher for legacy workflows.
- `approve-keeperhub-ens.ts` — authorize Turnkey wallet to write ENS records.
- `check-keeperhub.ts` — list / inspect workflows.
- `keeperhub-mcp.ts` — generic MCP client (`tools` / `workflow <id>` / `execution <id>` / `list` / `delete <id>` / `docs` / `call <tool> <jsonArgs>`).

INFT / oracle
- `mint-inft.ts` — mint tradewise INFT.
- `inft-oracle-smoke.ts` — oracle primitives.
- `test-inft-oracle-e2e.ts` — full INFT oracle pipeline (no HTTP).

ENS gateway
- `ens-gateway-smoke.ts` — smoke test live gateway.
- `test-ens-gateway-e2e.ts` — full EIP-3668 flow.
- `test-primary-names-e2e.ts` — ENSIP-19 cross-links.

Strategy / HL
- `strategy-smoke.ts` — pure decide() for M1.
- `strategy-hl-smoke.ts` — pure decide() for M2 HL.
- `hl-smoke.ts` — read path against HL testnet.
- `hl-write-smoke.ts` — write path (signing wire) against HL testnet.

Compliance / misc
- `commit-tradewise-manifest.ts` — submit compliance manifest.
- `sync-abis.ts` — `pnpm tsx scripts/sync-abis.ts` after every contract change. CONTRACTS array at top.

0G
- `zg-anchor-test.ts` / `zg-compute-spike.ts` / `zg-ledger-check.ts` / `zg-prod-lib-test.ts` — 0G integration probes.

## 5. Recent decisions (this is the agent's "session memory" — keep current)

- 2026-05-12: Migrated treasury crons (heartbeat, strategy, strategy-hl) from Vercel cron to KH-triggered webhooks. Endpoints unchanged.
- 2026-05-12: `RevenueSplitter` rewritten with per-share accumulator (MasterChef-style). Old PaymentSplitter math was unsound for transferable shares — old contract still on-chain at `0xab3EaeB666f97ca2366a78f62f53aEEc12EB94aB`, current one at `0x3B1Ae95aDA500e8B73dc153063F9F5C175e87268`.
- 2026-05-12: M2 brief landed (`M2_VERIFICATION_BRIEF.md`). Decided HyperEVM-native treasury over the oracle pattern in §4. HyperCore precompiles + CoreWriter at `0x3333...3333` let us keep TradingTreasury logic on-chain.
- 2026-05-12: HL_FACTS.md captures concrete numbers (fees, funding, bridge, signing). Bridge2 on Arbitrum at `0x2df1c51e09aecf9cacb7bc98cb1742757f163df7` (mainnet), `0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89` (testnet).
- 2026-05-12: V1 HL TS client + V2.5 HyperliquidTreasury shipped, 176/176 tests pass.
- 2026-05-12: V2.6 off-chain HL strategy adapter shipped; cron triggers migrated to KH.

## 6. Open M3 questions (for the operator, not technical blockers)

1. Capital ceiling for V3 — should it be enforced at the contract level so even a rogue agent can't exceed it?
2. Wood-tier HYPE staking (10 HYPE ≈ $500) for 5% fee discount at V2 — yes/no?
3. Audit firm and timing — V3 gate requires it, lead time is 4-8 weeks
4. Tokenized-equity regulatory posture — needs a lawyer's read before opening to outside capital
