# tradewise.agentlab.eth

> An autonomous on-chain agent quoting Uniswap swaps for x402 USDC. Publicly tradeable, reputation-collateralised, sla-bonded — every paid call adds to the agent's reputation, its revenue stream, and its share-holders' dividends.

**Live:** https://hackagent-nine.vercel.app · **Docs:** https://hackagent-nine.vercel.app/docs · **Sponsor feedback:** [Uniswap](FEEDBACK.md) · [KeeperHub](KEEPERHUB_FEEDBACK.md)

---

## What it is

A single coherent product that exercises **all four hackathon sponsors** end-to-end:

| Layer | Tech | What it does |
| --- | --- | --- |
| Identity | **ENS** + ERC-8004 + ENSIP-25 | `tradewise.agentlab.eth` resolves through a CCIP-Read gateway we built; ENSIP-25 text record binds the ENS name to the agent's on-chain registry entry. |
| Memory | **0G Storage** + ERC-7857 INFT | Encrypted memory anchored to 0G; the missing TEE-style oracle that 0G's reference contracts left as `// TODO` is implemented in `AgentINFTVerifier.sol`. |
| Inference | 0G Compute (TeeML chatbot) | Used by the agent's reasoning steps — verifiable via TEE attestation. |
| Execution | **KeeperHub** | Three workflows (heartbeat, reputation cache, compliance attest) keep the agent's surface fresh — webhook-only, zero-gas, fires on every paid quote. |
| Service | **Uniswap** Trading API | What the agent actually sells — signed Uniswap quotes with Permit2 + UniswapX support. |
| Payments | **x402** on Base Sepolia | Per-quote USDC settlement. The agent's payTo is the `RevenueSplitter` so every paid call adds dividends. |
| Ownership | ERC-7857 INFT + AgentBids | The agent itself is a token. OpenSea-style standing offers in Sepolia USDC. |
| Revenue share | ERC-20 + RevenueSplitter | The agent IPO'd itself — 10 000 TRADE shares on Base Sepolia, claim pro-rata against the splitter. |
| Credit | ReputationCredit | Uncollateralised lending against on-chain feedback count. Liquidates if reputation drops 20 %+. |
| M&A | AgentMerger | Dual-INFT-proof recorded merger; constituent reputation sums into the merged agent. |
| Compliance | ComplianceManifest | USDC-bonded declaration of every external data source the agent touches; slashable on challenge. |

For the long-form version of any of these, open https://hackagent-nine.vercel.app/docs.

---

## Run it locally

```bash
pnpm install
cp .env.example .env.local      # fill in RPC URLs, AGENT_PK, KEEPERHUB_API_KEY, etc.
pnpm dev                         # http://localhost:3000

# contract suite (125 tests across 15 suites)
cd contracts && forge test
```

Deploy scripts live in [contracts/script/](contracts/script/). Each contract has its own `Deploy*.s.sol`.

---

## Live deployments

**Sepolia** — agent identity, reputation, INFT, credit, compliance, bids, merger, SLA bond.
**Base Sepolia** — x402 settlement, agent shares, revenue splitter, shares sale.

Full address ledger lives at https://hackagent-nine.vercel.app/docs (section "contract addresses — full ledger"). Key entry points:

| Contract | Chain | Address |
| --- | --- | --- |
| AgentINFT (ERC-7857) | Sepolia | `0x103B2F28480c57ba49efeF50379Ef674d805DeDA` |
| ReputationRegistry (ERC-8004) | Sepolia | `0x477D6FeFCE87B627a7B2215ee62a4E21fc102BbA` |
| ReputationCredit | Sepolia | `0x4D3f8cBfAA97f617929f3237331C59Bf212Bf418` |
| ComplianceManifest | Sepolia | `0xD92F99A883B3Ca3F5736bf24361aa75B53168e7c` |
| AgentBids | Sepolia | `0x58C4F095474430314611D0784BeDF93bDB0b8453` |
| AgentMerger | Sepolia | `0x809cA3DB368a7d29DB98e0520688705D3eB413D1` |
| RevenueSplitter | Base Sepolia | `0xab3EaeB666f97ca2366a78f62f53aEEc12EB94aB` |
| AgentShares (TRADE) | Base Sepolia | `0x5097D660de831f0d09476035F7cE1eBf09F72265` |

Agent EOA on both chains: `0x7a83678e330a0C565e6272498FFDF421621820A3`.

---

## Repo layout

```
app/                    Next.js 16 app router
  api/                  cron, webhooks, x402 a2a/jobs, INFT oracle, ENS gateway
  inft/ ipo/ credit/    feature pages with client controls
  marketplace/ merger/  
  compliance/ keeperhub/
  ens/                  CCIP-Read demo with name + record dropdowns
  docs/                 long-form documentation page
contracts/              Foundry — Solidity 0.8.28
  src/                  AgentINFT, AgentINFTVerifier, ReputationCredit, ...
  test/                 125 tests across 15 suites
  script/               one Deploy*.s.sol per contract
lib/                    typed clients + helpers (ens, x402, keeperhub, log-chunks, ...)
components/             shared React components
scripts/                tsx utilities — seed ENS, mint INFT, manual e2e tests
```

---

## Verification

| Check | Command |
| --- | --- |
| TypeScript | `pnpm exec tsc --noEmit` |
| Build | `pnpm exec next build` |
| Contracts | `cd contracts && forge test` (125 tests) |

CI: every push to `main` auto-deploys to Vercel production.

---

## Demo

The most photogenic moments to walk through in the video:

1. **`/ens`** — click "resolve all records" against `tradewise.agentlab.eth`. 10 fields back via CCIP-Read in ~1.7 s, including a live `last-seen-at` heartbeat that the agent's runtime updates on every paid quote.
2. **`/ipo`** — the splitter section. Real USDC accumulating from x402 settlements, claimable pro-rata against TRADE shares.
3. **`/inft`** — the encrypted memory block. Merkle root of the agent's memory anchored to 0G Storage, transferred with re-encryption on every ownership change.

---

## License

MIT.
