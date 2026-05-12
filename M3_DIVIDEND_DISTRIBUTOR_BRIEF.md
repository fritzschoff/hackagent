# M3 — Cross-chain dividend distributor

This is the design brief for the **single hardest unsolved technical problem** standing between Tradewise and M3. Everything else on the M3 list (audit, prospectus, regulatory) is operational; the dividend distributor is the code we don't yet have.

## 1. Problem statement

After M2 the capital lives on HyperEVM (HyperliquidTreasury holds USDC; positions on HL Core). The equity stack — AgentShares, SharesSale, RevenueSplitter — lives on Base. Shareholders bought on Base; they should be able to call `RevenueSplitter.claim()` on Base, in USDC, without ever touching HyperEVM, Arbitrum, or knowing what Hyperliquid is.

The agent therefore needs an automated path:

```
HyperliquidTreasury (HyperEVM)
   ↓ HL → Arbitrum native bridge (HL Bridge2, validators, ~3-4 min)
   ↓ Arbitrum → Base (Across / Hop / direct CCTP)
   ↓
RevenueSplitter (Base)
```

Frequency: weekly, matching the existing `TreasuryDividendDistribute` KH workflow cadence. Amount: whatever's free on the treasury minus an operating reserve (current M1 policy: 0.1 USDC reserve, distribute the rest).

## 2. Constraints

| Constraint | Why it matters |
|---|---|
| Shareholders must never bridge themselves | Negates the whole "publicly tradeable agent" pitch if claim flow needs cross-chain UX |
| Bridge cost amortised across all holders | A $1 flat HL withdrawal fee on a $5 weekly dividend is 20% drag. Has to be tolerable. |
| Operator (you) must not be required to sign per cycle | Defeats the autonomous-agent claim |
| Capital exposure in transit must be bounded | If the bridge takes 10 min, treasury is "in flight" capital that can't be killed |
| Kill-switch path must still work | `emergencyExit` on HyperliquidTreasury must still be able to drain. The dividend distributor can't lock funds. |
| Auditable end-to-end | 0G trade-log entries on both sides; shareholders can verify the round trip |

## 3. Architecture options

### A. Operator-mediated (sketch first; rejected)
Agent EOA reads HL position, withdraws to Arbitrum (HL signed withdrawal), bridges Arbitrum→Base via Across, calls `RevenueSplitter.distribute(amount)`. Each step initiated by an off-chain script signed with `AGENT_PK`.

- **Pro:** trivial to implement; we have all the pieces (signWithdraw + Across API)
- **Con:** requires `AGENT_PK` to be live signing on three different chains across ~10 minutes. Bigger attack surface than the rest of M1.
- **Con:** if the agent operator vanishes (the entire kill-switch story) **shareholders stop getting dividends.** The killer demo's promise — capital comes home automatically — has a footnote.

### B. KeeperHub-orchestrated, Turnkey-signed (preferred)
Three KH workflows, each signed by the existing Turnkey integration:

1. `DividendStep1Withdraw` — weekly schedule → call our `/api/keeperhub/dividend-step-1` → endpoint reads HL balance via L1Read, signs HL withdraw3 action via AGENT_PK, POSTs to HL API. HL Bridge2 settles to Arbitrum in 3-4 min.
2. `DividendStep2Bridge` — webhook from step 1's completion notify → endpoint signs Across deposit (Arbitrum → Base) for the same amount. Across' settlement is ~5-30 sec.
3. `DividendStep3Distribute` — webhook from step 2's completion → endpoint calls `RevenueSplitter.distribute()` on Base via AGENT_PK.

Each step is idempotent (operate on observed balance, not assumed). Each step emits a `KeeperhubRunKind = "dividend-step-N"` row in Redis + a 0G trade-log entry. The dashboard shows the in-flight state.

- **Pro:** KH is the orchestrator, not Vercel. Matches the M2 brief's "KH load-bearing" thesis.
- **Pro:** Each step's failure mode is isolated; an Arbitrum congestion doesn't cascade.
- **Pro:** Operator can pause any single step on KH without code changes.
- **Con:** AGENT_PK still signs all three steps. Same key surface as option A — KH just orchestrates the cadence, not the auth.

### C. Permissionless on-chain (the dream, but not for M3)
A `CrossChainDistributor` contract that anyone can call to push the dividend. Same per-step state machine but with on-chain enforcement. Requires a permissionless oracle that proves HL-side state to Arbitrum/Base; not generally available without LayerZero or Wormhole, both of which have their own trust profile.

- **Pro:** No private key anywhere in the dividend path
- **Con:** Multi-chain bridge oracles are an entire research project. M4+ at earliest.

## 4. Recommendation

**Go with B (KH-orchestrated, Turnkey-signed) for M3.** It's the right shape for our trust profile (we're already trusting AGENT_PK for the strategy itself) and it composes cleanly with the existing KH workflows.

Phase the rollout:

| Phase | Scope | Output |
|---|---|---|
| D0 — research | Confirm Across is the right Arbitrum→Base bridge. Alternatives: Hop, native Optimism stack bridge if cheaper, direct CCTP via Circle. Compare fees + latency + per-tx min/max. | `DIVIDEND_BRIDGE_FACTS.md` |
| D1 — single-step proof | Just `DividendStep1Withdraw`: weekly HL withdraw to Arbitrum, no further bridging. Funds sit on Arbitrum; founder bridges manually for the first 1-2 cycles. | KH workflow + endpoint + trade-log entry; verified on testnet |
| D2 — bridge in | Add `DividendStep2Bridge`: Arbitrum → Base via the chosen bridge. Funds land on Base on the agent address. | end-to-end automation up to Base; founder still calls `distribute` |
| D3 — full automation | `DividendStep3Distribute` writes through `RevenueSplitter.distribute()`. Real weekly cycle on testnet for 2-4 weeks before flipping mainnet. | M3-ready dividend cycle |

D0 is pure research (1 session). D1–D3 are each ~1 session of code + tests.

## 5. Open questions before D0

1. **Bridge choice.** Across has the smallest spread + fastest finality of the big bridges for Arbitrum↔Base USDC moves at small size ($5-$500). Hop is comparable. Direct CCTP via Circle is slower (~13 min for finality) but trustless. Pick one before D1.

2. **Failure recovery.** If step 1 lands USDC on Arbitrum but step 2 fails (bridge down, gas spike), how do we recover? Two options: (a) retry from Redis-tracked state, (b) emit a "stranded funds" event and let the operator reconcile. M3 minimum is (b); (a) is M4.

3. **Audit scope.** The distributor is new code; does it need to be in scope of the M3 audit? My take: yes — it touches real capital and uses both AGENT_PK and Turnkey. Adds 1–2 weeks to audit cost estimate.

4. **Operating reserve sizing.** Current 0.1 USDC reserve is M1 testnet-scale. For M3 with $5K AUM, reserve should be sized to cover next week's gas + bridge fees with a buffer. Estimate: $20–50.

## 6. What this brief is NOT trying to solve

- **Bridge from Base back to HyperEVM** — that's the *funding* path (shareholder USDC → treasury → HL). Different brief.
- **HL withdrawal under stress** — separately tracked in HL_FACTS.md §2 as a VERIFY item that needs empirical testing.
- **Tax / reporting infrastructure for shareholders** — operational, not technical, post-M3.

## 7. Decision needed before D0 starts

**Bridge choice** for the Arbitrum→Base leg (Across vs Hop vs CCTP). The other open questions can be deferred to D2/D3 design time. I default to Across unless you have a reason to pick differently — fastest settlement, well-tested API, and good for small amounts.
