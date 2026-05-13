# tradewise.agentlab.eth

> An autonomous on-chain trading agent that raises capital by selling shares of itself, runs a funding-rate arb strategy, and pays dividends back to shareholders through an on-chain splitter — with a KeeperHub dead-man's switch that drains capital home if the operator vanishes.

**Live:** https://hackagent-nine.vercel.app · **Docs:** https://hackagent-nine.vercel.app/docs · **Roadmap:** [GH issue #17](https://github.com/fritzschoff/hackagent/issues/17) · **Sponsor feedback:** [Uniswap](FEEDBACK.md) · [KeeperHub](KEEPERHUB_FEEDBACK.md)

---

## What it is

Started as an x402 quoting agent at ETHGlobal Open Agents (won the KeeperHub prize). Post-hackathon, it's evolving into a **funding-rate arbitrage agent on Hyperliquid** whose capital is raised via an on-chain IPO. The novel primitive is **agent-as-equity-issuer**: humans buy shares of the agent's future revenue, the agent runs the strategy, profits stream back through a per-share revenue splitter.

The killer demo: a KeeperHub workflow watches the agent's heartbeat. If the off-chain agent goes silent for 6 hours, KH calls `emergencyExit()` autonomously — every USDC flows from the treasury back to the splitter, shareholders claim, contract is permanently killed. Verified live on Base Sepolia at 21:00 UTC on 2026-05-12 (tx [`0xad0abd7d…`](https://sepolia.basescan.org/address/0x3d4243930F3aE7648D34f5775AfAc2699C7Fc5e2)).

| Layer | Tech | What it does |
| --- | --- | --- |
| Identity | **ENS** + ERC-8004 | `tradewise.agentlab.eth` resolves through a CCIP-Read gateway; 10 fields back in ~1.7s. Wildcard offchain resolver with EIP-191 signed responses bound to `address(this)`. |
| Memory | **0G Storage** + ERC-7857 INFT | Encrypted memory anchored to 0G; the missing TEE-style oracle that 0G's reference left as `// TODO` is implemented in `AgentINFTVerifier.sol`. |
| Trading (M1) | TradingTreasury + MockPerpExchange | Agent-delegated open/close on a stubbed perp; realized P&L streams to RevenueSplitter; 6h dead-man's switch with permissionless `emergencyExit`. |
| Trading (M2) | HyperliquidTreasury + L1Read + HyperliquidActions | HL-native treasury on HyperEVM. Reads positions via 0x0800 precompiles, sends orders via CoreWriter at 0x3333…3333. |
| Orchestration | **KeeperHub** | Load-bearing for capital safety. 9 workflows drive heartbeat, funding-poll, strategy ticks, weekly dividend, the kill-switch, and cross-chain payout — KH is the schedule + observability surface, not just nice-to-have. |
| Service | **Uniswap** Trading API | The legacy x402 quoting path. Demoted from headline revenue to optional read-side surface as M2 lands. |
| Payments | **x402** on Base Sepolia | Per-quote USDC settlement to the agent's payout wallet. |
| Capital stack | ERC-20 + RevenueSplitter + SharesSale | The agent IPO'd itself — 10 000 TRADE shares on Base Sepolia. MasterChef per-share accumulator so transferable shares track accrual correctly. |

The original hackathon repo had additional surfaces (AgentBids marketplace, ReputationCredit, AgentMerger, SlaBond, ComplianceManifest, pricewatch sidecar). All removed post-pivot — see `TRADING_AGENT_BRIEF.md` §7 "Honest cuts" for the reasoning.

---

## Run it locally

```bash
pnpm install
cp .env.example .env.local      # fill in RPC URLs, AGENT_PK, KEEPERHUB_API_KEY, etc.
pnpm dev                         # http://localhost:3000

# contract suite (123 tests across 14 suites)
cd contracts && forge test
```

Deploy scripts live in [contracts/script/](contracts/script/). For the current trading stack:

```bash
# Base Sepolia (M1):
REVENUE_SPLITTER_ADDRESS=0x3B1Ae95aDA500e8B73dc153063F9F5C175e87268 \
  forge script script/DeployTradingTreasury.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast

# HyperEVM (M2 — needs HYPE for gas):
HL_USDC_ADDRESS=… HL_SPLITTER_ADDRESS=… HL_ASSET_INDEX=4 \
  forge script script/DeployHyperliquidTreasury.s.sol --rpc-url $HYPEREVM_RPC_URL --broadcast
```

---

## Live deployments

**Base Sepolia** — x402 settlement, agent shares, revenue splitter, sales, trading treasury.
**Sepolia** — agent identity, reputation, INFT memory.

Full address ledger lives at https://hackagent-nine.vercel.app/docs. Key entry points:

| Contract | Chain | Address |
| --- | --- | --- |
| AgentINFT (ERC-7857) | Sepolia | `0x103B2F28480c57ba49efeF50379Ef674d805DeDA` |
| IdentityRegistryV2 (ERC-8004 §4.4) | Sepolia | `0xc456e7123BD79F96aDb590b97b9d0E2B0c2B09D5` |
| ReputationRegistry | Sepolia | `0x477D6FeFCE87B627a7B2215ee62a4E21fc102BbA` |
| AgentShares (TRADE) | Base Sepolia | `0x64D708f88bBA23BB4cA0D5063C5de97F0f89b519` |
| RevenueSplitter | Base Sepolia | `0x3B1Ae95aDA500e8B73dc153063F9F5C175e87268` |
| SharesSale | Base Sepolia | `0x507807eA4Dd32D2f1f8D83e1F475CB9F978Ec7dE` |
| TradingTreasury | Base Sepolia | `0xDF24367b83B3C4d484ea88537197a28C2A0b6A07` |
| MockPerpExchange | Base Sepolia | `0xd951bBdA9666c9917a9eB0594d82fBab1805fd08` |

Agent EOA on every chain: `0x7a83678e330a0C565e6272498FFDF421621820A3`.

---

## Repo layout

```
app/                    Next.js 16 app router
  api/                  KH webhooks, x402 a2a/jobs, INFT oracle, ENS gateway,
                        treasury endpoint + crons (heartbeat / strategy / dividend)
  inft/ ipo/ ens/       feature pages with client controls
  keeperhub/            live KH workflow inventory
  docs/                 long-form documentation page
contracts/              Foundry — Solidity 0.8.28
  src/                  AgentShares, RevenueSplitter, SharesSale,
                        TradingTreasury, MockPerpExchange,
                        HyperliquidTreasury, L1Read, HyperliquidActions,
                        AgentINFT, AgentINFTVerifier, IdentityRegistry/V2,
                        ReputationRegistry, ValidationRegistry,
                        OffchainResolver
  test/                 123 tests across 14 suites
  script/               Deploy*.s.sol per stack
lib/                    typed clients: hyperliquid (HL REST + signing),
                        hyperliquid-treasury (viem wrappers),
                        treasury / treasury-strategy / treasury-log,
                        keeperhub + workflow builders, ens-gateway,
                        edge-config, redis
scripts/                tsx utilities — wallets, distribution,
                        KH workflow setup + updates,
                        smoke tests (HL read/write, strategy decide)
.claude/agents/         tradewise-agent + memory map for Claude Code subagent
```

---

## Verification

| Check | Command |
| --- | --- |
| TypeScript | `pnpm typecheck` |
| Build | `pnpm build` |
| Contracts | `cd contracts && forge test` (123 tests) |
| HL signing wire (testnet, no funds) | `pnpm tsx scripts/hl-write-smoke.ts` |
| Strategy decide() | `pnpm tsx scripts/strategy-smoke.ts` |

CI: every push to `main` auto-deploys to Vercel production.

---

## Demo

The most photogenic moments to walk through:

1. **`/ens`** — click "resolve all records" against `tradewise.agentlab.eth`. 10 fields back via CCIP-Read in ~1.7s, including a live `last-seen-at` heartbeat the agent bumps on every paid quote.
2. **`/ipo`** — TRADE shares + RevenueSplitter accruals. Founder claim returns the latest dividend cycle's payout.
3. **Treasury tile on `/`** — current position, heartbeat freshness, kill-switch timeout. Tx history of the M1 kill-switch trip (2026-05-12, 21:00 UTC) is on-chain proof of the "capital comes home" claim.
4. **`/keeperhub`** — 9 active workflows; the 3 treasury-side ones (heartbeat-trigger, strategy-trigger, kill-switch) are what makes "KH is load-bearing" non-marketing.
5. **`/inft`** — the encrypted memory block. Merkle root anchored to 0G Storage, transferred with re-encryption on every ownership change.

---

## Reference docs

- `TRADING_AGENT_BRIEF.md` — M2 evolution thesis (funding-rate arb on HL, equity issuance, why we picked HyperEVM-native over the oracle pattern)
- `M2_VERIFICATION_BRIEF.md` — pre-M2 architecture decisions
- `HL_FACTS.md` — every concrete HL number verified (fees, funding, bridge, signing)
- `M3_DIVIDEND_DISTRIBUTOR_BRIEF.md` — cross-chain payout design (HyperEVM → Arbitrum → Base splitter)
- `.claude/agents/tradewise-memory.md` — codebase map + recent decisions + lessons learned

---

## License

MIT.
