# M2 Verification Brief — Hyperliquid integration

M1 shipped a testnet stack where `MockPerpExchange` *was* the venue. M2 swaps it for the real thing. Hyperliquid is unusual: it has its own L1 plus a new EVM-compatible chain (HyperEVM), and a Solidity contract on HyperEVM can call into the orderbook via precompiles. That changes the architecture from what the original brief assumed (off-chain oracle relaying HL state).

This document is the verification gate the M1 brief called for, plus the architecture recommendation that follows from it. **No code yet.**

## 1. Verified parameters

All numbers below were pulled from the public Hyperliquid docs in this session. Citations live in the docs path next to each claim.

**Fees** — `docs/trading/fees`
- Tier 0 (base): **taker 0.045% / maker 0.015%**
- Sliding tiers down to 0.024% / 0% at $7B 14-day volume
- HYPE staking discount up to 40% (Diamond tier, 500k staked)
- Maker rebates `-0.001%` to `-0.003%` paid per trade
- At our scale (sub-$10K notional/day) we will live in tier 0 indefinitely

**Funding** — `docs/trading/funding`
- Paid hourly at 1/8 of the 8-hour computed rate
- Cap: **4% / hour** (much looser than centralised exchanges)
- Interest-rate component: 0.01% / 8h ≈ 11.6% APR floor
- Positive funding → longs pay shorts (our intuition matches)
- Calculated `position_size × oracle_price × funding_rate` — oracle, not mark

**Deposits / withdrawals** — `docs/onboarding/how-to-start-trading`
- USDC bridges through **Arbitrum** to HL L1
- Flat **$1 withdrawal fee**, no per-tx gas
- No fraud-proof window or security delay documented
- ⚠️ Bridge contract address: **not in public docs**, needs lookup
- ⚠️ Withdrawal latency under load: **not documented**, needs empirical test

**API surface** — `docs/for-developers/api`
- Mainnet: `https://api.hyperliquid.xyz`
- Testnet: `https://api.hyperliquid-testnet.xyz`
- Official SDKs: Python (first-party), Rust + TS (community), CCXT
- Two signing schemes: `sign_l1_action` and `sign_user_signed_action`
- ⚠️ Exact EIP-712 / phantom-agent details: needs read of Python SDK source

**HyperEVM** — `docs/hyperevm` + `docs/for-developers/hyperevm`
- Chain ID **999**, RPC `https://rpc.hyperliquid.xyz/evm`
- Native gas: **HYPE** (18 decimals), EIP-1559 with priority fees burned
- Cancun EVM (no blobs)
- HyperCore "read precompile" + "write system contract" exposed to EVM
- ⚠️ Precompile addresses: **not in public docs**, needs source dive

## 2. Unverified items (M2 gate)

Each of these blocks a confident M2 ship. They are small research tasks, not unknowns.

| Item | Why it blocks | How to verify |
|---|---|---|
| HyperEVM precompile addresses (read orderbook, send orders) | Architecture (§3) hinges on whether `TradingTreasury` can stay on-chain | Read the Hyperliquid Python SDK source, or ping HL devrel |
| Bridge contract on Arbitrum | Need it to programmatically deposit/withdraw from HL | docs/onboarding sub-page or Etherscan trace from `app.hyperliquid.xyz` deposit flow |
| Withdrawal latency p50 / p99 | Capital-at-risk decision — we need to know how long shareholders' USDC is locked if we ever close out | Do five test deposit+withdraw cycles on mainnet with $20, measure |
| Signing details for `sign_l1_action` | Determines whether we can sign with `viem`/`ethers` or need the Python SDK in a subprocess | Read the Python SDK signing module |
| HYPE for gas | Even read-only smart-contract calls on HyperEVM cost HYPE — need some on the treasury wallet | Plan a one-time HYPE swap once we know the bridge route |
| HL rate limits for the trading wallet | Affects how aggressive the strategy can poll | Find the public limit doc, otherwise empirically probe |

## 3. Architecture options

### A. Oracle pattern (the original brief's assumption)
HL stays off-chain; agent EOA reads HL API and pushes signed state into a `HyperliquidOracle` contract on Base mainnet that implements `IPerpExchange`. TradingTreasury (on Base) reads from the oracle.

- **Pro:** AgentShares + RevenueSplitter + TradingTreasury all stay on Base; no new chain in the trust model
- **Pro:** Trust boundary is honest — shareholders trust the agent to mirror HL faithfully; 0G log provides independent audit
- **Con:** Adds a trusted-pusher role with weak on-chain enforceability
- **Con:** Position state can lag actual HL state by a block; emergencyExit only forces *off-chain* close, which the agent must then mirror back into the oracle

### B. HyperEVM-native treasury
Deploy a new `HyperliquidTreasury` on HyperEVM that talks to HL orderbook via precompiles. AgentShares + RevenueSplitter stay on Base mainnet. USDC bridges Base ↔ Arbitrum ↔ HL.

- **Pro:** No trusted pusher — position state is on-chain truth on HyperEVM
- **Pro:** emergencyExit becomes a real same-chain action against the orderbook
- **Con:** Two-chain stack; capital movement between Base and HyperEVM has multi-hop bridge latency
- **Con:** Precompile interface stability unknown; HyperEVM is new (Feb 2025 mainnet)
- **Con:** Treasury and shareholders on different chains means dividend distributions need a bridge step too

### C. Single-chain on Arbitrum (or HyperEVM)
Move everything — AgentShares + Sale + Splitter + Treasury — to one chain. Either Arbitrum (HL bridge endpoint) or HyperEVM.

- **Pro:** Simplest mental model; no inter-chain moves except HL itself
- **Con:** Arbitrum doesn't have Aerodrome (it has Camelot, Uniswap v3) — spot leg changes
- **Con:** HyperEVM is young; shareholders may not want exposure on it for the equity issuance

## 4. Recommendation

**Option B with one twist: start oracle-mode, migrate to precompiles when proven.**

Concretely:
1. Stand up `HyperliquidTreasury` on HyperEVM with an *agent-pusher* interface (oracle mode) for M2 days 1–14. Cheap, fast to ship, doesn't depend on precompile stability.
2. In parallel, validate that the precompile path works with a tiny standalone test (open + close a $10 position from a HyperEVM contract). If it works, swap the pusher path for the native path before opening to outside capital in M3.
3. Keep AgentShares + RevenueSplitter on Base mainnet. Dividend distributions bridge USDC back from HyperEVM via the native bridge ($1 fee) every cycle — small cost, large simplification for shareholders.

This sequences the work so that the **trust boundary visible to shareholders moves only once** (from "agent mirrors HL" to "treasury is HL", at the M3 promotion).

## 5. Milestone plan

| Slice | Scope | Output |
|---|---|---|
| **V0 — verification (this week)** | Resolve every ⚠️ in §2. Empirical bridge + withdrawal test with $20. Read Python SDK signing. | `HL_FACTS.md` (small reference doc) + cached precompile addresses |
| **V1 — HL adapter (week 1–2)** | TS client wrapping HL signing + REST. `lib/hyperliquid.ts` exports `openPosition`, `closePosition`, `getPosition`, `getFundingRate`. Verifiable with HL **testnet** ($0 risk). | TS lib + integration tests against testnet |
| **V2 — HyperEVM treasury (week 2–3)** | Deploy `HyperliquidTreasury` on HyperEVM (oracle mode). Agent EOA pushes positions and funding into it. Splitter still on Base; dividend cycle bridges. | Live deployment + dashboard tile |
| **V3 — $100 personal capital (week 3–7)** | Owner is sole shareholder. Real money. Run 30 days. Daily P&L matches attested trade log within 1bp. | Logged 30-day P&L curve + kill-switch dry run |
| **V4 — precompile flip** | Replace agent-pusher with direct HyperCore precompile calls. New trust boundary. | Audited treasury, ready for M3 |

V0 + V1 + V2 are the M2 substantive work. V3 is the time gate. V4 is the M3 prep.

## 6. Risks and the kill-criteria for M2

- **Precompile path doesn't work / unstable** — kills option B; fall back to option A indefinitely, accept the weaker trust boundary, document it honestly to shareholders
- **HL withdrawal latency > 10 min at p99** — re-prices the kill-switch story; the 6h dead-man's switch becomes the lower bound for "capital out" rather than "trade closed", which is a meaningfully different promise
- **HL counterparty risk realised during V3** — entire AUM at risk. Cap at-risk capital at $100 for V3; document acceptable loss explicitly; M3 promotion requires either insurance (HYPE-backed?) or a hard cap on AUM in HL
- **Funding rate stays in dead zone (|rate| < CLOSE_THRESHOLD) for the entire 30 days** — strategy never trades, V3 proves nothing about P&L. Mitigation: pick a more volatile alt (HYPE, kPEPE) instead of ETH for V3; document the choice
- **HyperEVM gas (HYPE) supply** — agent needs ongoing HYPE balance. Cheap insurance: pre-fund $50 of HYPE and a refill cron

## 7. Two questions for you before V0 starts

1. **Capital ceiling for V3?** The brief says $100. With HL withdrawal latency unknown, do we want a hard contract-level cap so even if the agent goes rogue the loss is bounded?
2. **HYPE staking discount worth it?** Diamond tier (40% off fees) needs 500k HYPE ≈ $25M at current prices — not happening. But Wood tier (5% off, 10 HYPE staked, ≈$500) is essentially free. Stake at V2?
