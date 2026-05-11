# Tradewise → Funding-Rate Arb Agent: Post-Hackathon Brief

**Status:** working thesis, written for the owner. Sharp opinions, citations to existing repo, things to verify flagged explicitly.

---

## 1. Thesis

The novel primitive in this repo is *not* an agent that quotes Uniswap swaps for $0.10/call — it is an **autonomous business that raised capital on-chain, deploys that capital mechanically, and returns yield to its shareholders pro-rata**. The plumbing for that already exists: `contracts/src/AgentShares.sol:12` (10k TRADE supply), `contracts/src/SharesSale.sol:17` (fixed-price primary), `contracts/src/RevenueSplitter.sol:23` (pull-pattern USDC dividend). What's missing is a *strategy* whose P&L is large enough to be interesting at a $1–10K AUM and small enough that retail capital can't trivially compete it away. **Funding-rate arbitrage on L2 perps vs. spot is that strategy.**

Why it fits:

- **Mechanical revenue.** Funding pays every hour (Hyperliquid), every 8h (most other venues). The agent is not "predicting" anything — it is collecting a cash flow that exists whether the agent is there or not.
- **Capital-efficient.** $1K of shareholders' USDC turns into ~$1K of spot + ~$1K of short perp at 1× collateralisation = $2K notional. At 5–15% annualised funding (typical BTC/ETH neutral conditions — **needs verification**), that's $100–300/yr on $1K — small but *attestable*. Unit economics scale roughly linearly until capacity decay, see §4.
- **Low MEV competition.** Funding arb is "boring" — it requires inventory and operational uptime, not block-builder relationships. Citadel doesn't bother with $1K positions. Retail hates the operational tax (rebalancing, liquidation watch). An always-on autonomous agent is *exactly* the actor that should win this niche.
- **Attestation-friendly.** Each leg is a discrete on-chain (spot) or signed-API (perp) event with a clear timestamp, fill price, and funding payment. Trade log → 0G Storage → Merkle root → ERC-8004 reputation. The agent can prove "I delivered 12% APY net of fees over Q3" with cryptographic receipts, not vibes.

**What goes wrong if we pick alternatives.** DEX–DEX arb on L2 is saturated — bots front-run anything that prints. Long-tail token arb requires inventory in 50+ tokens and gets you rugged. Statistical arb / vol-selling has unbounded tail risk and is impossible to attest cleanly. Funding arb is the only strategy where (a) the edge survives at small size, (b) the loss tail is bounded by liquidation logic the agent controls, and (c) the P&L is a linear sum of attestable events.

---

## 2. Venue analysis

**Perp leg — pick: Hyperliquid.** GMX v2 / dYdX v4 / Aevo are the alternatives.

| Venue | Funding cadence | Maker/taker (approx, **verify**) | Withdrawal | Programmatic access | Verdict |
|---|---|---|---|---|---|
| Hyperliquid | 1h | ~0.01% / ~0.035% | ~3 min via L1→Arbitrum bridge | EIP-712 signed REST + WebSocket, well-documented | **Pick.** Deepest perp book outside Binance, cheapest fees, hourly funding gives 8× the rebalance opportunities vs. 8h venues. |
| dYdX v4 | 1h | ~0.02% / ~0.05% | Cosmos withdrawal, slower | Cosmos SDK, harder for an EVM-native agent | Skip — operational tax not worth it. |
| GMX v2 | 1h | 0.05% open + ~0.1% price impact | Native on Arbitrum, instant | Solidity contracts, fully on-chain | Backup option. Higher friction but **no exchange counterparty risk** — fully EVM-verifiable. |
| Aevo | 8h | ~0.03% / ~0.05% | Optimistic L2, slower | REST API | Skip — 8h funding is too lumpy for $1–10K. |

**Numbers to verify before M2:** exact maker/taker, exact funding-rate distribution over the last 90 days for BTC-PERP and ETH-PERP, minimum position size, withdrawal latency under load. The numbers above are recollection — do *not* commit to a venue without confirming on docs.hyperliquid.xyz and a manual ping of the API.

**Spot leg — pick: Aerodrome on Base.** Uniswap v3 on Arbitrum is the runner-up.

- Aerodrome wins on (a) co-location with the agent's existing settlement chain (RevenueSplitter is already on Base Sepolia — `README.md:61`), (b) deeper ETH/USDC liquidity than Arbitrum's UNI v3 pools at the $1–10K size, (c) no bridge between settlement and spot, (d) Slipstream concentrated liquidity gives effectively v3-equivalent pricing.
- The fly in the ointment: bridging Base → Hyperliquid (HL is a sovereign L1 fronted by an Arbitrum bridge) is 2 hops. **Verify** the actual latency and cost at $1K size. If it's > 5 min and > $2 round-trip, GMX v2 on Arbitrum becomes more attractive even with worse fees, because spot and perp share a chain.

**One concrete pair to start: ETH spot on Aerodrome (Base) ↔ ETH-PERP short on Hyperliquid.** ETH because (a) deepest on both venues, (b) funding rate distribution well-characterised, (c) liquidation tolerance highest. BTC second. Anything beyond top-5 by market cap is a research project, not M2 scope.

---

## 3. Architecture sketch

The agent's loop, concretely:

1. **Capital lands.** `SharesSale.buy()` (`contracts/src/SharesSale.sol:52`) sends USDC to the deployer. Today that's the human owner. **Change:** deploy a thin `TradingTreasury` contract that's the `deployer` of a new SharesSale, holds the USDC, and exposes `function spend(address to, uint256 amount, bytes32 reason) onlyAgent`. The agent EOA is the only whitelisted spender. Every withdrawal emits an event with `reason` ∈ {`open-long-spot`, `open-short-perp`, `fund-perp-margin`, `close-position`, `return-to-splitter`}. This is the on-chain audit trail shareholders verify against the off-chain trade log.

2. **Capital splits.** Agent reads current funding rate from Hyperliquid WS. If funding > threshold (suggested initial: 8% APY ≈ 0.0009% per hour for ETH), agent calls `treasury.spend()` twice: ~50% to Aerodrome router for ETH spot, ~50% bridged to Hyperliquid as USDC collateral. Open ETH-PERP short of equivalent USD notional. Both fills attested to 0G Storage via the existing `appendJobLog` path (already wired at `app/api/a2a/jobs/route.ts:162`).

3. **Hold.** Funding accrues hourly on the short leg; spot leg is ~delta-neutral against it. Agent polls funding every 5 min via KeeperHub workflow. Holds while funding > exit threshold (suggested: 2% APY) or until basis converges. **State on-chain:** treasury balance, treasury event log, RevenueSplitter inflow. **State off-chain:** open position size, current funding, current basis, P&L since open — written to 0G Storage every poll, each entry signed by the agent EOA.

4. **Close.** When funding < exit threshold *or* spot/perp basis widens beyond risk tolerance (initial: 0.5% from entry), agent closes both legs. Net P&L in USDC → `RevenueSplitter`. The existing `X402_PAYOUT_OVERRIDE` mechanism at `app/api/a2a/jobs/route.ts:274` already proves the splitter accepts arbitrary USDC inflows — same primitive, different source.

5. **Shareholders claim.** `RevenueSplitter.claim()` is unchanged (`contracts/src/RevenueSplitter.sol:54`). The agent has pivoted its revenue source from "$0.10 per x402 quote" to "$X per closed funding-arb trade" without touching the dividend logic. That is the leverage point of this repo.

**Where 0G Storage fits.** The trade log is the agent's defensible reputation. Every fill, every funding payment, every rebalance, every kill-switch event → 0G Storage Log entry, with the Merkle root anchored on-chain (quarterly is plenty) via the existing `appendJobLog` mechanism. Shareholders can independently reconstruct claimed P&L. Reputation moves from "did the swap fill at quote" to "audited returns" — much higher signal.

**Does x402 fit?** Mostly no. x402 was *the* revenue model in v1; in v2 it's a side-channel at most. Optional surface: charge x402 for read access to live position state (e.g. "what's the agent's current exposure?" → $0.01 per call). That keeps the existing x402 + ERC-8004 reputation rails alive without making them load-bearing. The honest answer: x402 is the v1 story, trading is the v2 story. Don't pretend otherwise in the pitch.

---

## 4. Risk model

| Risk | Mitigation |
|---|---|
| **Basis blowout** (spot/perp diverge during a cascade) | Hard stop at 0.5% basis widening from entry. Close both legs even if it means realising a loss. Encoded in the kill-switch workflow, not in agent prompt. |
| **Liquidation on perp leg** | Run perp at 2× collateralisation, not 1×. Burns capital efficiency but means a 50% wick can't liquidate. Margin buffer monitored every 60s. |
| **Hyperliquid counterparty** | Real, unhedgeable. HL is a sovereign L1 with its own validators, not an EVM contract the agent verifies. Mitigation: cap HL exposure at ~30% of treasury (collateral + margin). The other ~70% sits in spot (USDC + ETH on Base), recoverable even if HL vanishes. This is the strongest argument for GMX v2 as a long-term migration target. |
| **Oracle risk** | Funding rate is computed by Hyperliquid; spot price is AMM-derived. Cross-check spot against Chainlink ETH/USD on Base; if divergence > 0.3%, refuse to open a new position. |
| **Smart contract risk** | `TradingTreasury` is the new attack surface. Keep it dumb: whitelisted recipients (Aerodrome router, HL bridge, RevenueSplitter only), per-tx caps, daily caps, owner-only emergency pause. Audit before M3. |
| **Capacity decay** | At ~$50–100K the strategy starts moving spot on Aerodrome enough to leak edge to MEV (**verify** with on-chain depth analysis). **Practical ceiling: $50K AUM for ETH-only.** Above that, diversify pairs (BTC, SOL) before pumping size. |
| **Stuck position (agent can't close)** | The kill switch: if the agent EOA can't post a close tx for 6h, a KeeperHub heartbeat-stale workflow triggers `treasury.emergencyExit()` — sweeps everything back to RevenueSplitter at whatever price. Shareholders may take a haircut but don't lose principal sitting in spot. |

---

## 5. Milestones

| Milestone | What it proves | Gates blocking the next |
|---|---|---|
| **M0 (today)** | x402 quoting agent live; AgentShares + RevenueSplitter + SharesSale deployed; ERC-8004 reputation loop closes. | — |
| **M1 (≈2 weeks)** | Testnet end-to-end with a **stubbed exchange**. Build `TradingTreasury`, a funding-rate simulator that emits ticks, agent opens/closes mock positions, P&L flows through RevenueSplitter. All on Base Sepolia. | TradingTreasury audit-clean, every event emits cleanly, kill switch tested by pausing the agent EOA. |
| **M2 (≈4 weeks)** | **Live with $100 of personal capital, no IPO.** Real Hyperliquid mainnet account, real Aerodrome on Base mainnet, real funding collected. Owner is the sole shareholder. Run ≥ 30 days. | 30-day P&L positive *and* matches attested trade log within 1bp. Zero unexpected kill-switch events. HL withdrawal tested under stress. |
| **M3 (≈8 weeks)** | **Open IPO.** Mainnet SharesSale at $0.50/share × 10k shares = $5K initial cap. 60-day public operation. | M2 P&L data published, treasury contract audit complete, kill switch demoed publicly, RevenueSplitter has paid out at least one real dividend during M2. |
| **M4 (≈16 weeks)** | **Multi-strategy.** Second pair (BTC HL ↔ Base spot), then SOL. Then basis trades (funding-sign flipping). Cap raise expands beyond $5K. | M3 ran 60 days with no significant drawdown, ≥ 3 distinct shareholders bought at IPO and at least one is not the founder's friend. |

Crisp version: M1 proves the plumbing. M2 proves the strategy. M3 proves the IPO primitive. M4 proves it scales beyond one pair.

---

## 6. KeeperHub angle

KeeperHub becomes structural, not cosmetic. The round-two pitch:

- **`funding-poll` workflow** — every 5 min, fetch HL funding rate, write to Edge Config, trigger `open-position` workflow if threshold crossed. Replaces the polling loop an always-on server would otherwise need. This is the canonical KH use case: low-frequency, deterministic, off the critical path.
- **`rebalance` workflow** — every 1h, check spot/perp delta; if drift > 1%, emit a rebalance intent that the agent EOA signs and submits. KH gives retry semantics and gas management for free.
- **`kill-switch` workflow** — heartbeat-based dead-man's switch. If the agent EOA hasn't pinged in 6h, KH calls `treasury.emergencyExit()`. **This is the killer demo:** shareholders can verify on-chain that even if the agent operator vanishes, their capital comes home automatically.
- **`dividend-distribute` workflow** — weekly, batch-claim accrued USDC and push it through RevenueSplitter on behalf of shareholders who haven't called `claim()`. Optional UX nicety, no security implication.

The current repo uses KH for `heartbeat`, `reputation-cache`, and `compliance-attest` (see push at `app/api/a2a/jobs/route.ts:201`) — cute, but cosmetic. The trading agent makes KH **load-bearing for capital safety**. That is a much sharper pitch than "we use KH to update an ENS text record".

---

## 7. Honest cuts

If the project pivots, the following should be cut or demoted to "v1 artefact":

- **Pricewatch agent** (`app/api/a2a/pricewatch/...`, `consultPricewatch` at `app/api/a2a/jobs/route.ts:37`) — the "agent A pays agent B" pattern. Cute hackathon demo, irrelevant to a trading agent's mission. **Cut.**
- **MCP server stub** (`app/api/mcp/route.ts`) — exists for sponsor signal, no role in a trading agent. **Cut**, or downgrade to a single read-only `getPositions` tool.
- **AgentMerger / AgentBids / ReputationCredit / ComplianceManifest** — the "every primitive" land-grab for the hackathon. For the pivot: **keep RevenueSplitter, AgentShares, SharesSale, AgentINFT.** Demote the others to a `legacy/` directory and stop advertising them. ReputationCredit in particular ("uncollateralised lending against reputation count") becomes *actively misleading* once the agent has real capital at risk — a shareholder reading the README needs to understand "this agent trades a fund", not "this agent is a constellation of speculative primitives".
- **The Uniswap quoting endpoint** (`lib/uniswap.ts`, `quoteSwap`) — the quote logic itself is fine, but as the *headline revenue path*, it's dead. Either repurpose it as an internal pricing-check utility or delete. Don't keep it on the front page.
- **The three test-client crons** — replace with one **strategy-tick** cron that runs the M1 simulator. "3 distinct EOAs paying x402" was hackathon-judging theatre; for a real trading agent it's noise.

What stays: x402 + ERC-8004 as the *identity and reputation* layer (now backing "this agent has audited P&L"), AgentINFT as the ownership wrapper, AgentShares/SharesSale/RevenueSplitter as the capital stack, KeeperHub as the operational reliability layer, 0G Storage as the trade-log anchor.

---

**Bottom line.** The agent-as-equity-issuer is the right primitive. Funding-rate arb is the right first strategy because it's mechanical, attestable, and uncompetitive at small size. Hyperliquid + Aerodrome is the right venue pair — *contingent on verifying bridge latency and exact fees in M1*. The repo today has ~80% of the plumbing already built; the missing 20% is `TradingTreasury`, the strategy loop, and a serious kill switch. The cut list is short and honest: most of the hackathon land-grab primitives should go.

Monday morning: write `TradingTreasury.sol` and the funding-rate simulator. M1 is two weeks if you don't get distracted.
