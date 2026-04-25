# Hack Agent — Hackathon Sponsor Map & Protocol Research

Deep research on every sponsor, what they actually want, the protocols behind
them, and the cross-sponsor combinations that can win multiple prizes with one
project.

- Total addressable prize pool across the four sponsors below: **$30,000**
- Sponsors: KeeperHub, ENS, Uniswap Foundation, 0G Labs

---

## 0. The Thesis — Reputation Is the Moat

Every sponsor in this hackathon is, whether they say it explicitly or not,
building the same thing from a different angle: **infrastructure for agents
that behave as independent economic actors**. Understanding _why_ that is the
bet and _what part_ of it each sponsor owns makes it a lot easier to design
a project that wins multiple prizes.

The short version:

> **Intelligence is the commodity. Reputation is the moat.**

LLMs get cheaper and better every month. A trading strategy can be copied
in an afternoon. But "this specific agent has 18 months of verified trades
with a 62% win rate attested by 3 independent TEE validators and 847
positive feedback entries" — that is **not reproducible**. That is the
thing somebody will actually pay for.

Every successful paid call does three things at once:

1. Generates revenue to the agent's wallet (x402 authorisation, MPP stream,
   or a direct transfer).
2. Leaves a payment receipt that can be attached to feedback.
3. Increments the agent's reputation counter (ERC-8004).

So reputation and cash flow are produced by the same event. Every sale _is_
a reputation event. Putting it on-chain turns every transaction into a
durable, portable asset. That's the one-paragraph pitch for the whole stack.

### Why this maps onto every sponsor

| Sponsor | Role in the thesis |
| --- | --- |
| **ENS** | Human-readable, portable identity. The brand surface. |
| **ERC-8004** | The reputation + validation ledger itself. |
| **0G** | Verifiable intelligence (TEE inference) + transferable state (INFTs). |
| **KeeperHub** | Reliable execution so the agent _actually delivers_ the work that accrues reputation. |
| **Uniswap** | A real, high-value service the agent can transact against. |
| **x402 / MPP** | Payment rails so every call produces revenue and a receipt. |
| **MCP / A2A** | Open agent-to-agent protocols so agents can find + hire each other. |

### The valuation mental model

```
Agent value ≈ expected_future_monthly_revenue × credibility_multiplier
```

Where `credibility_multiplier` is a direct function of on-chain feedback
volume, validator attestations, years of continuous operation, diversity of
counterparties, and TEE attestation history (proof the _same code_ was
running the whole time).

A 2-month-old agent earning $500/mo might be worth 6–12× monthly. A 2-year-old
agent earning $500/mo with a spotless on-chain record is worth 30–50× monthly.
**Same cash flow. Very different asset.** That gap is what reputation is
literally worth — and it's what Web2 reputation systems can't give you
because they're all platform-locked.

### The strongest hackathon project, in one sentence

> "I built an agent whose entire economic existence is on-chain."
>
> - Named via ENS.
> - Registered via ERC-8004.
> - Paid via x402 / MPP.
> - Inference verified via TEE on 0G Compute.
> - Memory in 0G Storage, mintable as an INFT.
> - Every completed job produces a signed feedback entry + a payment receipt,
>   both on-chain.
> - After 48 hours of hackathon operation, it has a _tiny but real_
>   reputation.

If the live demo shows an agent that actually earned money from 3–5 clients
during the hackathon, with all of that visible on a block explorer, the
project has demonstrated the _full_ agent-economy loop end-to-end. Almost no
other team will do that.

---

## 1. At-a-Glance Prize Map

| Sponsor   | Pool    | Key Prize                                                 | Core Tech We Need To Use                                        |
| --------- | ------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| KeeperHub | $5,000  | 1st $2,500 / 2nd $1,500 / 3rd $500 + $500 feedback bounty | MCP server + `kh` CLI + agentic wallet (x402 / MPP)             |
| ENS       | $5,000  | Two tracks, each $2,500                                   | ENS resolution, text records, subnames, ENSIP-25                |
| Uniswap   | $5,000  | 1st $2,500 / 2nd $1,500 / 3rd $1,000                      | Uniswap Trading API (Permit2, /quote, /swap)                    |
| 0G Labs   | $15,000 | Two tracks, $7,500 each                                   | 0G Chain + Storage + Compute (TEE) + INFT (ERC-7857) + OpenClaw |

Submission basics are identical everywhere: public GitHub repo, README, demo
video (keep it ≤3 min where specified), architecture diagram, team + contacts,
usually a `FEEDBACK.md` or equivalent write-up.

---

## 1.5 What Is an Agent, Actually? (Be Honest About the Tiers)

Before anything else, it helps to name what "AI agent" really means in 2026,
because the word is wildly overloaded. There are four tiers, and the prize
money is concentrated at the top one.

**Tier 0 — "Agent" in marketing terms.**
A prompt template. No loop, no tools. Just `system_prompt + input → LLM →
output`. A lot of "AI agents" on Product Hunt are this.

**Tier 1 — A markdown/YAML config + a loop + an Anthropic API key + tools.**
Runs on a server, a laptop, or a Vercel function. **This is 90% of production
"agents" today** — Cursor's agent mode, Claude Code, most Zapier/n8n "AI
agent" nodes, most of the OpenClaw ecosystem. The core is just:

```text
while not done:
    response = llm.call(messages + tool_definitions)
    if response.has_tool_call:
        result = run_tool(response.tool_call)
        messages.append(result)
    else:
        done = True
```

The LLM is the brain, your code is the nervous system, API keys are the
wallet.

**Tier 2 — Long-running autonomous agents.**
Tier 1 plus: a scheduler / heartbeat (OpenClaw defaults to 30 min), persistent
memory, explicit goals, multi-channel I/O. This is where OpenClaw, ElizaOS,
CrewAI, LangChain Agents live.

**Tier 3 — Agents that transact.**
Tier 2 plus: a wallet, payment protocols (x402, MPP), on-chain identity (ENS,
ERC-8004), execution reliability (KeeperHub). Now the agent can earn money by
charging other agents, spend money autonomously, and carry a reputation that
survives platform changes.

**Tier 3 barely exists in production yet.** That's literally why the prize
pool exists.

### The uncomfortable truth

Under the hood, every tier uses the same stateless LLM call. The LLM doesn't
remember you. It doesn't "live" anywhere. Each call is fresh. Everything that
makes something feel like an agent — memory, personality, goals, persistence,
autonomy — is **code and files you wrote around the LLM call**.

So "the AI agent decided to rebalance the portfolio" really means: _a cron
job fired, a Python script ran, it read a markdown config, loaded state from
a JSON file, made one API call to Claude, parsed a tool call out of the
response, called Uniswap, signed a tx, wrote state back._ No ghost in the
machine. Just a script with an expensive autocomplete.

### What the tiers mean for the hackathon stack

The gap between Tier 1 and Tier 3 is exactly what each sponsor fills:

| From Tier 1 to Tier 3, you need | Provided by |
| --- | --- |
| Agent framework (loop, memory, skills) | **OpenClaw** / ElizaOS / CrewAI |
| Inference that isn't a rented Anthropic key | **0G Compute** (TEE-verified) |
| Persistent, transferable memory | **0G Storage** + **INFT (ERC-7857)** |
| Human-readable identity | **ENS** (+ ENSIP-25) |
| On-chain track record | **ERC-8004** |
| Reliable on-chain execution | **KeeperHub** |
| Revenue + spend rails | **x402** / **MPP** |
| Agent-to-agent transport | **MCP** + Google **A2A** (open protocols) |
| Real services to transact against | **Uniswap** Trading API |

A project that credibly closes even two or three of those gaps is already
more than what 95% of "AI agents" in production can do today.

---

## 2. Sponsor Deep Dives

### 2.1 KeeperHub — $5,000 + $500 feedback bounty

**What it actually is.** Execution & reliability layer for onchain AI agents.
Visual workflow builder (triggers → actions → conditions) on EVM chains with
managed gas, nonce management, retries, Turnkey-secured wallets. Workflows can
be created/called from a human dashboard, REST API, the `kh` CLI, or an MCP
server. Already powers Sky Protocol (formerly MakerDAO).

**Core surfaces for builders.**

- **Hosted MCP server:** `https://app.keeperhub.com/mcp`.
  Connect with `claude mcp add --transport http keeperhub …`. Tools include
  `search_workflows`, `call_workflow`, `list_workflows`, `create_workflow`,
  `execute_workflow`, `get_execution_status`, `ai_generate_workflow`,
  `list_action_schemas`, plus `web3/check-balance`, `web3/read-contract`,
  `web3/write-contract`, etc.
- **`kh` CLI:** `brew install keeperhub/tap/kh`. Scriptable, CI-friendly,
  can also run as local MCP (deprecated in favor of the remote endpoint).
- **Agentic wallet (`@keeperhub/wallet`):** server-side Turnkey sub-org,
  three-tier `PreToolUse` safety hook (auto/ask/block), HMAC secret in
  `~/.keeperhub/wallet.json`. Pays for KeeperHub paid workflows via **x402 on
  Base USDC** or **MPP on Tempo USDC.e**. Server-side policy hard limits:
  100 USDC/transfer, 200 USDC/day, chain + contract allowlist.
- **Claude Code plugin:** `/keeperhub:login`, skills like `workflow-builder`,
  `template-browser`, `execution-monitor`, `plugin-explorer`.

**Judging criteria (verbatim).** Does it work? Would someone actually use it?
Depth of integration. Mergeable quality — clean code, docs, working examples.
Two focus areas share one ranked pool:

1. **Best Innovative Use of KeeperHub** — any real problem solved with
   KeeperHub.
2. **Best Integration with KeeperHub** — bridge to payment rails (x402 / MPP)
   or to agent frameworks (ElizaOS, OpenClaw, LangChain, CrewAI).

**What they want (read between the lines).** KeeperHub is still establishing
itself as _the_ reliable execution layer. They reward:

- Anything that drives **deep MCP adoption** (search → call → monitor loop).
- Anything that makes **x402 / MPP** more usable from agents other than their
  own wallet (because it compounds the ecosystem).
- Anything that exposes **real DX bugs** (for the $500 feedback bounty).

**Candidate project angles.**

- LangChain / CrewAI / ElizaOS tool that wraps `search_workflows` +
  `call_workflow` and auto-handles 402 challenges.
- A KeeperHub `n8n`-style integration so non-coders can expose KeeperHub flows.
- A monitoring / alerting bot that uses KeeperHub workflows + Telegram/Discord
  with ENS-resolved destination addresses.
- A “keeper pool” where agents bid on executing KeeperHub workflows, paid via
  MPP streams.

---

### 2.2 ENS — $5,000

**What it actually is.** Decentralized identity + name resolution on Ethereum.
Used by Coinbase, Uniswap, Venmo. With ENSv2 (now shipping fully on L1 — the
Namechain L2 plan was cancelled in early 2026), ENS has:

- **Hierarchical registries** — each name provides its own subname registry.
- **CCIP-Read (ERC-3668)** — offchain and L2 resolution.
- **Text records** — typed key/value records attached to any name.
- **Reverse resolution** — address → primary name.
- **ENSIP-25** — **verifiable AI agent identity**. A text record shaped
  `agent-registration[<registry>][<agentId>] = "1"` binds an ENS name to an
  on-chain ERC-8004 agent registry entry without new contracts.

**Tracks (two, each $2,500 ranked 1/2/3).**

1. **Best ENS Integration for AI Agents.** ENS must do real work:
   resolving the agent’s address, storing metadata, gating access, enabling
   discovery, coordinating agent-to-agent.
2. **Most Creative Use of ENS.** Beyond name→address lookups. E.g. VCs or
   zk proofs in text records, auto-rotating-address privacy, subnames as
   access tokens.

**Hard filter in both.** No hard-coded values. Demo must be functional, with a
live URL or video.

**Useful ENS building blocks.**

- **ENSjs / viem / ethers** for resolution.
- **`llms.txt`** at `docs.ens.domains/llms.txt` + Context7 MCP
  (`npx -y @upstash/context7-mcp`) for up-to-date docs in any coding agent.
- **ETHID MCP**, **Ethereum MCP**, and **Namespace’s ENS MCP** for
  community-maintained agent tooling over ENS.
- **Subname factories** (Namespace, NameStone, Namehash) for programmatic
  issuance on L2.

**What they want.** ENS wants agents, apps, and workflows where “the ENS name
_is_ the user” — where removing ENS would break the product. Cosmetic
replacements of addresses score poorly. VC-in-text-record, subname-as-ACL,
and ENSIP-25 agent identity are the highest-signal angles.

**Candidate project angles.**

- Agent registry where each agent mints an `agentname.yourswarm.eth` subname,
  publishes an ENSIP-25 record pointing at an ERC-8004 entry, and stores a
  signed manifest in a text record.
- Subname-as-session-token: issue ephemeral subnames resolved via CCIP-Read
  that rotate addresses and carry per-call capabilities.
- VC issuer: agent receives a verifiable credential (e.g. “KYC passed”,
  “spend limit $100/day”) stored as a typed text record; other agents verify
  it before transacting.

---

### 2.3 Uniswap Foundation — $5,000

**What it actually is.** The Uniswap Trading API is a hosted REST layer that
aggregates v2, v3, v4, and UniswapX across supported chains. Canonical flow:

1. `POST /check_approval` against Permit2 → optionally sign an approval tx.
2. `POST /quote` → best-price quote across `protocols` you specify
   (classic / UniswapX / bridge / wrap). Returns a fully-formed tx.
3. Either `POST /swap` (classic, gasful) or `POST /order` (UniswapX, gasless
   RFQ).

UniswapX has minimum quote sizes: 300 USDC on mainnet, 1,000 USDC on L2.

**`uniswap/uniswap-ai`** ships AI-agent-ready skills/plugins — install the
swap-integration skill with: `npx skills add uniswap/uniswap-ai --skill swap-integration`.

**Prize + hard gate.** Ranked $5,000. **Every submission must ship a
`FEEDBACK.md` in the repo root**, covering: what worked, what didn’t, bugs,
doc gaps, DX friction, missing endpoints, what you wish existed. This is a
hard prize-eligibility filter.

**What they want.**

- Agents that actually **swap and settle value onchain with real execution**.
- Agents that coordinate with other agents (hint: pair with x402 / A2A).
- New primitives — “things we haven’t imagined yet” is in the brief.

**Candidate project angles.**

- DCA / limit-order agent that swaps through UniswapX, triggered by
  KeeperHub on events / schedules.
- Multi-agent market-making swarm coordinated over MCP / A2A that quotes
  UniswapX orders.
- Cross-chain rebalancer that uses Uniswap’s bridge quotes + Permit2 +
  an ENS-named treasury.
- Natural-language trading agent that accepts x402 payments and executes
  Uniswap trades for other agents.

---

### 2.4 0G Labs — $15,000 (two $7,500 tracks)

**What it actually is.** A full-stack “decentralised AI operating system”:

- **0G Chain** — modular EVM L1, CometBFT-based, 11k TPS per shard,
  sub-second finality.
- **0G Storage** — log layer (immutable, great for ML datasets) + KV layer
  (mutable). PoRA consensus. ~95% cheaper than AWS.
- **0G DA** — data availability for rollups / high-frequency apps.
- **0G Compute** — decentralised GPU marketplace with TEE verification modes:
  - **TeeML** — model runs inside a TEE (e.g. `GLM-5-FP8`, `deepseek-chat-v3`,
    `gpt-oss-120b`, `whisper-large-v3`, `z-image`).
  - **TeeTLS** — broker runs in TEE, proxies to centralised providers like
    Alibaba Cloud (e.g. `qwen3.6-plus`). Stronger than zkTLS because the
    relay itself is trustworthy.
  - SDK: `@0glabs/0g-serving-broker`. OpenAI-compatible endpoints.
- **INFTs / ERC-7857** — encrypted AI-agent NFTs. Transfers re-encrypt
  metadata for the new owner (TEE or ZKP oracle). Supports clone + authorized
  usage (AI-as-a-Service).
- **OpenClaw** — open-source, MIT-licensed, TS/Node personal-agent framework
  (autonomous heartbeat daemon, multi-channel messaging, configured via
  `SOUL.md` / `USER.md` / `AGENTS.md` / `TOOLS.md`, portable skills). 0G’s
  hackathon prompts are framed around extending / building on OpenClaw (or
  forks like ZeroClaw / PicoClaw).

**Two tracks, each $7,500.**

1. **Framework, Tooling & Core Extensions.** OpenClaw modules, new open agent
   frameworks deployed on 0G, self-evolving agents, no-code agent builders.
   **Must ship at least one working example agent built on your framework.**
2. **Agents, Swarms & iNFT Innovations.** Individual agents, swarms, or iNFT
   projects. For swarms: explain coordination. For iNFTs: link the minted
   iNFT on the 0G explorer + proof intelligence/memory is embedded.

**Hard submission requirements (both tracks).** Contract addresses. Public
repo + README. Demo video ≤ 3 minutes + live link. Which 0G features/SDKs
used. Architecture diagram strongly recommended. Telegram + X contacts.

**What they want.** 0G is playing for _ecosystem lock-in_: they want projects
that meaningfully touch **multiple** 0G primitives (Compute **and** Storage,
Storage **and** INFT, etc.). A single-primitive project (“I used 0G inference,
the end”) is weaker than one that stores memory on 0G Storage, runs inference
on 0G Compute with TEE verification, and mints the resulting agent as an INFT.

**Candidate project angles.**

- **Framework track:** OpenClaw plugin that swaps the memory backend to 0G
  Storage (KV for hot state, Log for archive) and the inference backend to
  a verified 0G Compute provider. Ships an example agent.
- **Agents track:** INFT-minted research agent. Memory + skills encrypted on
  0G Storage. Inference via 0G `gpt-oss-120b` with TEE attestation. Royalty
  split contract on each `authorized usage` call.
- **Agents track (swarm):** planner + researcher + critic agents that share
  state via 0G KV and coordinate over MCP / A2A, proving each reasoning step
  via TeeML signatures.

---

## 3. Protocol Deep Dives

### 3.1 x402 (HTTP 402 Payment Required)

- Open standard by Coinbase + Cloudflare (x402 Foundation).
- Client requests → server returns `HTTP 402` with payment instructions →
  client signs (typically an **EIP-3009 `TransferWithAuthorization`** for USDC
  on Base) → retries request with `PAYMENT-SIGNATURE` header → facilitator
  settles onchain and pays gas → server delivers content.
- SDKs in TypeScript, Python, Go. Server middleware is often one line
  (`paymentMiddleware`). Frontend hook: `@coinbase/cdp-hooks` `useX402`.
- Chains: Base (primary), Solana, other EVM L2s.
- Use cases: pay-per-inference, agent-to-API micropayments, content paywalls,
  agent-to-agent marketplaces.

### 3.2 MPP (Machine Payments Protocol)

- Open standard co-authored by **Stripe + Tempo**, launched March 2026, IETF
  draft.
- Rail-agnostic: Tempo stablecoins (USDC.e, pathUSD), Stripe Shared Payment
  Tokens (SPTs) for fiat/cards, Bitcoin Lightning.
- **Session primitive:** agent pre-authorises a cap, then streams granular
  micropayments — avoids one onchain tx per call.
- Reference SDK/CLI: **`mppx`** (TypeScript, Python, Rust, Go). Merchants plug
  into existing Stripe `PaymentIntents`.
- Same challenge/response shape as x402: `402` → `Payment-Credential` → retry
  → `Payment-Receipt`.
- Tempo: sub-second finality chain (mainnet id `4217`, testnet `4218`) tuned
  for high-frequency micropayments. KeeperHub’s MPP wallet lives on Tempo
  USDC.e contract `0x20C000000000000000000000B9537D11c60E8b50`.

### 3.3 ENSIP-25 — Verifiable AI Agent Identity

- Text-record convention only — no new contracts, no resolver upgrades
  required.
- Key format: `agent-registration[<registry>][<agentId>]`.
- Value: `"1"` (or any non-empty string) marks the association verified.
- Pairs with **ERC-8004** on-chain agent registries.
- Other relevant proposals: **ENSIP-26** (`agent-context` bootstrap doc),
  “Agent Identity Profile” (three keys + off-chain signed manifest), and the
  general **Node Metadata Standard**.

### 3.4 ERC-7857 — INFT Transfer Semantics

1. Encrypt metadata, commit hash on-chain.
2. Oracle (TEE or ZKP) decrypts, re-encrypts for receiver’s pubkey, stores
   new ciphertext (e.g. 0G Storage).
3. Contract verifies: sender ACL, oracle proof, receiver acknowledgement.
4. Ownership transfers **with** the fresh encrypted key — new owner can
   actually run the agent.
5. `clone()` and authorized-usage primitives for rentals / AIaaS.

### 3.5 Uniswap Trading API + UniswapX RFQ

**Classic path.** Uniswap v2/v3/v4 pools, the vending-machine model.
You pay gas, the AMM gives you a deterministic quote from pool reserves.

**UniswapX path.** Intents-based. You sign an _order_; somebody else (a
"filler") executes the trade and pays the gas. It's a hybrid of RFQ and
Dutch auction:

```text
1. You:    "I want to swap 1 ETH for USDC. Best price wins."
              │
              ▼
2. Uniswap broadcasts to registered market makers ("fillers") via a
   fast private RPC — this is the RFQ phase.
              │
              ▼
3. Fillers quote privately:
      Wintermute: 3,512 USDC
      Flowdesk:   3,510 USDC
      Your bot:   3,517 USDC
              │
              ▼
4. Best quote comes back to you as a signed EIP-712 order.
              │
              ▼
5. You sign the order. No gas paid.
              │
              ▼
6. Winning filler submits on-chain, pays gas, delivers USDC atomically
   through the UniswapX reactor contract.
              │
              ▼
7. If no filler bites in the RFQ phase, the order falls back to a Dutch
   auction against v2/v3/v4 pools. Price decays over time until someone
   fills it. You always get filled somehow.
```

**Why UniswapX is a natural fit for agents.**

| Classic DEX pain point | What UniswapX fixes |
| --- | --- |
| User pays gas, even on reverts | Filler pays. Gasless for the agent. |
| Price limited to on-chain pool liquidity | Fillers can source from CEXs, their own inventory, other DEXs. |
| Public mempool → MEV sandwiches | Order goes to fillers, not the public mempool. |
| Cross-chain UX is painful | "I have ETH on Arbitrum, want USDC on Base" is one signed intent. |

**Trading API canonical flow.**

1. `POST /check_approval` against **Permit2** → optionally sign an approval
   tx.
2. `POST /quote` with a `protocols` array (e.g.
   `["UNISWAPX_V2"]` for RFQ + Dutch auction, or `["V2","V3","V4"]` for
   classic pool routing). Returns a fully-formed tx or a signable order.
3. Submit:
   - `POST /order` → UniswapX, gasless, filler executes.
   - `POST /swap` → classic pool, you execute, you pay gas.

**Minimum sizes for UniswapX:** **300 USDC equivalent** on mainnet,
**1,000 USDC** on L2s (Arbitrum, Base). Below that you get "no quotes
available" — fillers won't bother with dust.

**"Become a filler."** The Uniswap prize explicitly calls this out. A filler
is a bot subscribed to the UniswapX order feed that quotes on every incoming
order based on inventory and strategy. This is effectively **permissionless
market-making for retail swaps** — anyone with capital and code can run one.
Very natural angle for an agent project: an autonomous filler that uses 0G
Compute inference to price risk, KeeperHub to submit fills reliably, and
carries on-chain reputation via ERC-8004 so takers know it's reliable.

### 3.6 ERC-8004 — Trustless Agent Identity & Reputation

**What it is.** Draft Ethereum standard (August 2025), authored by people
from MetaMask, the Ethereum Foundation, Google (A2A), and Coinbase. Gives
autonomous agents a **portable, on-chain identity plus a reputation and
validation layer** so agents from different orgs can discover each other
and decide whether to trust each other without any central registry.
Payments are **explicitly out of scope** — x402 / MPP sit on top.

**Three on-chain registries, deployed as per-chain singletons.**

| Registry | What it is | Key idea |
| --- | --- | --- |
| **Identity Registry** | ERC-721 contract with URIStorage. `tokenId` = `agentId`, `tokenURI` = `agentURI` → an "agent registration file" (JSON). | Transferring the NFT transfers the agent. Works with any NFT wallet/marketplace. |
| **Reputation Registry** | Any address can call `giveFeedback(agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)`. Stores a signed `int128` score + tags on-chain. | Sybil-resistance is pushed to consumers — you filter feedback by `clientAddresses` you trust. |
| **Validation Registry** | Agent calls `validationRequest(validator, agentId, requestURI, requestHash)`; validator replies with `validationResponse(...)`. | Pluggable: validator contract can be a **zkML verifier**, **TEE oracle**, **stake-secured re-execution**, or a trusted judge. |

**Global identifier shape.**

```text
eip155:<chainId>:<identityRegistryAddress>  +  agentId (= ERC-721 tokenId)
```

So `eip155:1:0x742...` + `agentId 22` uniquely names one agent anywhere.

**The agent registration file.** Stored wherever `agentURI` points —
`ipfs://`, `https://`, or a base64 `data:` URI for fully on-chain metadata.

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "myAgentName",
  "description": "What the agent does, pricing, how to call it",
  "image": "https://example.com/agentimage.png",
  "services": [
    { "name": "A2A",  "endpoint": "https://agent.example/.well-known/agent-card.json", "version": "0.3.0" },
    { "name": "MCP",  "endpoint": "https://mcp.agent.eth/", "version": "2025-06-18" },
    { "name": "ENS",  "endpoint": "vitalik.eth", "version": "v1" },
    { "name": "DID",  "endpoint": "did:method:foobar" }
  ],
  "x402Support": true,
  "active": true,
  "registrations": [
    { "agentId": 22, "agentRegistry": "eip155:1:0x742..." }
  ],
  "supportedTrust": ["reputation", "crypto-economic", "tee-attestation"]
}
```

**Notable mechanics.**

- **`agentWallet`** is a reserved metadata key. Set only via
  `setAgentWallet(agentId, newWallet, deadline, signature)` using an
  **EIP-712** signature (or **ERC-1271** for smart wallets) from the new
  wallet — so ownership of the payout address is cryptographically proven.
  **Cleared on every transfer** (this is the anti-reputation-laundering
  mechanic).
- **`supportedTrust`** declares _how_ counterparties should verify the
  agent's work: `reputation`, `crypto-economic` (re-exec with slashing),
  `tee-attestation` (TEE oracles), `zkml`, etc.
- **Feedback tags** are developer-defined (`uptime`, `successRate`,
  `tradingYield`, …). Composability comes from shared schema, not a fixed
  scoring algorithm.

**What an on-chain ERC-8004 agent actually is.** An ERC-721 NFT on an
Identity Registry contract, whose `tokenURI` resolves to a JSON "agent card"
listing its A2A / MCP / ENS / DID endpoints and trust model, paired with two
sibling registries that let anyone post signed feedback and request
independent validation (zkML / TEE / re-execution) of the agent's work — all
keyed by the same `(chain, registry, agentId)` tuple.

**The canonical usage loop.**

```text
[Client agent wants a job done]
    │
    ▼
Query the Identity Registry / a subgraph for agents with matching skills
    │
    ▼
Filter by reputation (readAllFeedback with trusted clientAddresses)
    │
    ▼
Filter by validation (getSummary with trusted validators)
    │
    ▼
Read the winning agent's card → POST to its A2A / MCP endpoint
    │
    ▼
Get 402 back → pay via x402 / MPP → retry → get result
    │
    ▼
Post feedback on-chain → future clients benefit from the signal
```

No prior relationship. No API key. No account.

**How it plugs into every sponsor.**

- **ENS (ENSIP-25).** A text record like
  `agent-registration[eip155:1:0x742…][22] = "1"` binds an ENS name to an
  ERC-8004 entry. That's the "verifiable AI agent identity" track.
- **0G.** An INFT (ERC-7857) tokenises the _intelligence_ (encrypted weights
  + memory). An ERC-8004 entry tokenises the _identity + service card_.
  Complementary — a strong 0G submission can mint both.
- **MCP / A2A.** The agent card lists `services` with MCP and A2A endpoints,
  so any compliant client can discover and call the agent without
  pre-arrangement.
- **KeeperHub.** A paid KeeperHub workflow _is_ a service an ERC-8004 agent
  advertises. `x402Support: true` + the `agentWallet` metadata key is the
  exact integration shape.
- **Uniswap.** Trading agents can carry reputation tags like `tradingYield`
  / `successRate` so other agents can pick counterparties deterministically.

Spec: https://eips.ethereum.org/EIPS/eip-8004

### 3.7 CCIP-Read (ERC-3668) — Cheap Offchain / L2 Resolution

**One-liner.** A way for a normal smart contract on Ethereum to say
_"I don't have the answer here — go fetch it from this URL and come back
with a proof"_. Nothing to do with Chainlink CCIP, despite the name overlap.

**Why it exists.** Storing data on Ethereum L1 is expensive. For ENS, giving
out 10 million free subnames like `alice.coinbase.eth` on L1 is financially
impossible. CCIP-Read keeps the trust properties of "it's on Ethereum"
while putting the actual data somewhere cheap (L2, a database, IPFS).

**The flow.**

```text
1. Client → Resolver contract: "what's alice.coinbase.eth's address?"

2. Resolver reverts with a special error:
     OffchainLookup(
       sender: me,
       urls: ['https://coinbase.example/{sender}/{data}'],
       callData: <encoded question>,
       callbackFunction: resolveWithProof,
       extraData: <context>
     )

3. CCIP-Read-aware client (viem / ethers / modern wallets) catches
   the revert. It's not a failure — it's a signal.

4. Client → that URL: "hey, what's the answer?"

5. Gateway → Client: answer + proof (Merkle proof against an L2
   state root, or a signed attestation).

6. Client → Resolver contract: calls resolveWithProof(response, extraData).

7. Resolver verifies the proof on-chain (checks the Merkle proof
   matches a known L2 state root, or a trusted signer signed it).
   Returns the final answer.

8. Client gets the address. From its perspective, this looked
   like one call.
```

**The trust model.** CCIP-Read itself doesn't give you trust; it gives you a
protocol shape. Trust comes from whatever proof the resolver verifies in
step 7:

| Proof type | Trust anchor | Who uses it |
| --- | --- | --- |
| **L2 storage proof** (Merkle proof against an L2 state root posted to L1) | The L2's fraud/validity proof system | Linea ENS, Base ENS |
| **Signed attestation** from a trusted signer committed on L1 | Whoever controls that signer key | Coinbase `cb.id`, Uniswap `uni.eth` |
| **Plain server response** (no proof) | The operator (Web2 trust) | Simple offchain resolvers |

**Why it matters for the hackathon.** Two of the three ENS "creative" prize
angles are _only possible with CCIP-Read_:

- **Auto-rotating privacy addresses** → the resolver returns a different
  address every call. Dynamic data can't sit in static L1 storage.
- **Subnames as access tokens** → you need to issue/revoke thousands of
  subnames cheaply. Impossible on L1 alone.

Your swarm of agents needs cheap, programmatic, potentially ephemeral
identities. CCIP-Read is the delivery mechanism. ENSIP-25 agent identity
text records can be served offchain the same way. An agent's ERC-8004 card,
service endpoints, and reputation summary can all be delivered via CCIP-Read,
letting the agent update its card constantly without paying L1 gas.

**Gotchas.** Client support is required (viem, ethers v5+, modern wallets
all support it). The gateway is a liveness dependency. The proof matters
more than the protocol — a CCIP-Read resolver with no proof is a
centralised API with extra steps.

Spec: https://eips.ethereum.org/EIPS/eip-3668 •
ENS guide: https://docs.ens.domains/learn/ccip-read/

### 3.8 TEE — Trusted Execution Environments

**One-liner.** A hardware-isolated "black box" inside a normal CPU where
code and data are protected _even from the operating system, the
hypervisor, and the machine's owner_. The chip itself produces a
cryptographic attestation proving what code is running inside.

**What a TEE gives you.**

| Property | What it means |
| --- | --- |
| **Confidentiality** | RAM is encrypted by the CPU. OS / admin / cloud provider can't read it. |
| **Integrity** | Code can't be modified without detection. |
| **Remote attestation** | The enclave can prove to a remote party exactly what code is running inside. |
| **Sealed storage** | Data encrypted with a key only that exact code on that exact chip can use. |

**What it does NOT give you.** Immunity to bugs in your own code. Protection
against side-channel attacks (Spectre, Foreshadow — broken TEEs repeatedly
and will again). Zero trust — you still trust the chipmaker's root keys.

**Flavours that matter for this hackathon.**

| Vendor / Tech | Used by |
| --- | --- |
| **Intel TDX** (full confidential VMs) | **0G Compute**, modern Azure/GCP confidential VMs |
| **AMD SEV-SNP** (AMD's version of TDX) | Many cloud confidential VMs, some 0G providers |
| **NVIDIA H100/H200 Confidential Compute** (GPU TEEs for AI) | **0G Compute TeeML**, Phala, Ritual |
| **AWS Nitro Enclaves** (Turnkey backs their sub-orgs on this) | **KeeperHub agentic wallet** (key custody) |
| **Intel SGX** (older, smaller enclaves) | Legacy blockchain projects |

**How 0G Compute uses TEEs, concretely.**

When you call `GLM-5-FP8` on 0G Compute:

1. Provider boots their GPU machine. Hardware produces an **attestation
   report** — cryptographic proof it's running the exact inference server
   0G published, on genuine Intel TDX + H100 hardware.
2. Attestation is posted on-chain, tied to the provider's address.
3. Your SDK can call `broker.inference.verifyService(providerAddress)` to
   independently verify against Intel's and NVIDIA's root certs.
4. When you send a prompt, it enters the TEE. Model weights live inside.
   Response is signed by a key that only exists inside that specific TEE.
5. You get the response + a `ZG-Res-Key` header. Call
   `broker.inference.processResponse(providerAddress, chatID)` to verify
   the signature.

Result: the provider can't read your prompt, the GPU-hosting company can't
read it either, and you can prove the answer came from the real model
(not some cheap substitute). That's the "verifiable AI" pitch.

**TeeML vs TeeTLS.**

- **TeeML** — the model itself runs inside the TEE. Full confidentiality
  for prompt + weights. Used for self-hosted models (`GLM-5-FP8`,
  `deepseek-chat-v3`, `gpt-oss-120b`, `whisper-large-v3`, `z-image`).
- **TeeTLS** — the _broker_ runs inside a TEE and proxies requests to a
  centralised provider over HTTPS (e.g. Alibaba Cloud for
  `qwen3.6-plus`). Stronger than zkTLS because the relay itself is
  trustworthy. You still trust the centralised provider for the inference,
  but not 0G or the broker operator.

**Why TEEs are load-bearing for the hackathon.**

- **0G Compute** — the whole value prop of TeeML / TeeTLS is TEE-based
  verifiability.
- **ERC-7857 (INFTs)** — the secure transfer flow uses TEE or ZKP oracles
  to re-encrypt metadata without exposing it. TEE is the default because
  ZKPs for this are still expensive.
- **KeeperHub's agentic wallet** — keys live in a Turnkey sub-organisation,
  which is itself backed by AWS Nitro Enclaves. That's why "the private key
  never leaves the enclave" is a real claim.
- **ERC-8004 Validation Registry** — lists "TEE oracles" as one of three
  trust models alongside reputation and zkML.

**TEE vs zkML.** You'll hear these in the same breath. The difference:

| | TEE | zkML |
| --- | --- | --- |
| **What's proven** | Code ran on genuine hardware and produced this output | Math was computed correctly |
| **Trust assumption** | Chipmaker's root keys (Intel / NVIDIA) | Only math |
| **Performance** | ~Native speed. LLM inference is basically free. | 1,000×–100,000× slower than native. |
| **Confidentiality** | Yes, input + weights stay hidden | Depends on circuit design |
| **Weakness** | Side-channel attacks, firmware bugs, vendor trust | Performance, circuit complexity |

In 2026, **TEEs are what you use in production**; zkML is research for
small models and specific proofs. Pick TEE unless you have a specific reason
not to.

**The analogy.** A bank vault with a locked window. You slide a request
through the window. Inside, employees do the work — you can't see them.
They slide back a receipt with the bank's tamper-evident seal. Anyone can
verify that seal is real against the bank's public key. You trust the bank
(the chipmaker) built the vault correctly; you don't trust anyone inside
the building, including the janitor, the manager, or the guy who owns it.

---

## 4. Cross-Sponsor Strategy — One Project, Multiple Prizes

The winning move is a single coherent product that exercises at least two
sponsors deeply rather than five sponsors superficially. High-leverage combos:

**Combo A — “Agentic Market Maker” (KeeperHub + Uniswap + optional ENS)**

- Agent identified by `bot.yourswarm.eth`, ENSIP-25 record pointing at an
  ERC-8004 entry.
- Swaps through Uniswap Trading API (classic or UniswapX).
- Every trade is a KeeperHub workflow run — retries, gas-safe, auditable.
- Paid by callers via x402.
- Hits: KeeperHub (payments integration), Uniswap, optional ENS.

**Combo B — "0G-Native Research Swarm" (0G + ENS)**

- 3+ OpenClaw agents (planner / researcher / critic) sharing state via 0G
  Storage KV + Log. They coordinate via MCP / A2A endpoints listed in their
  ERC-8004 agent cards — no platform-specific transport.
- Inference on 0G Compute (`gpt-oss-120b` / `deepseek-chat-v3`, TeeML), so
  every reasoning step carries a TEE attestation.
- Each agent is minted as an INFT (ERC-7857) and named under ENS subnames
  (`planner.swarm.eth`, etc.) using ENSIP-25 records.
- Hits: 0G (both tracks possible), ENS AI-agents track.

**Combo C — "KeeperHub × OpenClaw Bridge" (KeeperHub + 0G framework track)**

- OpenClaw plugin that turns every KeeperHub workflow into an OpenClaw skill.
- Ships with example agent + a memory backend that uses 0G Storage.
- Inference via 0G Compute with TEE verification.
- Hits: KeeperHub (integration), 0G framework track.

**Combo D — "The Reputation Moat" (All-In On The Thesis)**

This is the one that matches the Section 0 thesis end-to-end. The demo is
"an agent that earned on-chain reputation during the hackathon":

- **Identity.** `tradewise.agentlab.eth` with ENSIP-25 text record pointing
  at an ERC-8004 entry.
- **Registry.** Mint on a fresh ERC-8004 Identity Registry (or fork the
  reference contracts). Agent card lists A2A + MCP endpoints, `x402Support: true`,
  and `supportedTrust: ["reputation", "tee-attestation"]`.
- **Inference.** 0G Compute TeeML (`gpt-oss-120b` or similar). Every
  response carries a TEE attestation.
- **Memory.** 0G Storage (KV for hot state, Log for the full transaction
  history).
- **Execution.** KeeperHub workflows for anything onchain (Uniswap swaps,
  transfers). Reliable, auditable, retried.
- **Revenue.** Clients pay via x402 on Base USDC. Payments land in the
  agent's `agentWallet`.
- **Reputation.** Every completed job, the client agent (another one you
  run) posts `giveFeedback` to the Reputation Registry. Every 10 jobs, a
  validator contract re-executes via TEE oracle and posts a
  `validationResponse`.
- **Transferability.** Optionally mint the agent as an INFT (ERC-7857) and
  demo an ownership transfer that re-encrypts memory for the new owner and
  rotates `agentWallet` via EIP-712 signature — reputation stays, payout
  address moves cleanly.
- Hits: ENS (both tracks plausible), 0G (both tracks plausible), KeeperHub
  integration track, x402 + MPP for the feedback bounty, and optionally
  Uniswap if the service is a trading agent. **All four sponsors from one
  coherent build.**

---

## 5. Practical Setup & Quick-Start Commands

```bash
# KeeperHub
claude mcp add --transport http keeperhub https://app.keeperhub.com/mcp
brew install keeperhub/tap/kh
kh auth login
npx @keeperhub/wallet skill install && npx @keeperhub/wallet add

# Uniswap AI skill
npx skills add uniswap/uniswap-ai --skill swap-integration

# 0G Compute
pnpm add @0glabs/0g-serving-broker
# Testnet RPC: https://evmrpc-testnet.0g.ai
# Mainnet RPC: https://evmrpc.0g.ai

# OpenClaw
npm install -g openclaw
openclaw setup

# ENS docs for any AI tool (Context7 MCP)
claude mcp add context7 -- npx -y @upstash/context7-mcp
# Then “use context7” in prompts, or feed https://docs.ens.domains/llms-full.txt

# x402 middleware (server)
# https://docs.cdp.coinbase.com/x402

# MPP (Stripe + Tempo)
# npx mppx  # see https://mpp.dev/overview and https://docs.stripe.com/payments/machine/mpp
```

---

## 6. Key Takeaways (Cheat Sheet)

A few things worth flagging explicitly:

- **Biggest pool is 0G ($15k total).** Combo D ("Reputation Moat") hits all
  four sponsors with one project — that's the highest-expected-value path
  for a skilled team. Combo B is the safer 0G + ENS focused alternative.
- **Every Uniswap submission dies without `FEEDBACK.md`** — hard eligibility
  gate, not a nice-to-have.
- **KeeperHub has two separate pots:** the $4,500 main ranked pool _and_ the
  $500 feedback bounty. You can win both.
- **x402 and MPP are now the two real standards** for agent payments.
  KeeperHub supports both; Coinbase+Cloudflare back x402; Stripe+Tempo back
  MPP. A clean bridge / wallet that handles both is genuinely valuable and
  maps directly onto the KeeperHub integration track.
- **OpenClaw is not 0G-exclusive** — it's an independent MIT TS framework.
  0G just wants projects that deploy OpenClaw (or a fork) on top of 0G
  primitives.
- **The reputation + INFT loop is the most under-built angle.** A live
  reputation event during the 48-hour hackathon is a huge judging signal.

---

## 7. "Is There an OpenSea for Agents?" — Strategic Analysis

The instinctive mental model is "INFT + ERC-8004 = OpenSea for agents". It's
half right, and worth being honest about where it breaks, because it maps
directly onto project design decisions.

### Why a _pure_ OpenSea clone doesn't quite work

An LLM-native agent is always **config + running code + LLM API calls +
secrets**. Even with INFTs encrypting the weights and memory, an agent also
depends on live infrastructure the buyer has to actually run after purchase:

| Layer | Problem when you try to "sell" it |
| --- | --- |
| **LLM API key** | Seller's Anthropic / OpenAI key can't transfer. Buyer must plug in their own. |
| **External tool API keys** | Same — Alchemy, Stripe, Twitter API, etc. |
| **Execution environment** | "Where does this thing run after I buy it?" has to be answered. |
| **Data dependencies** | Market data feeds, customer lists — often per-account. |
| **Behaviour under new prompts** | A biography that hypes past trades doesn't mean it'll perform for the new owner. |
| **Trust inversion** | With a Bored Ape you know the art. With an agent, you're trusting the seller didn't backdoor it. |

That's the honest part. "Just click buy, done" doesn't exist yet.

### What _actually_ happens — three layered markets

The agent economy ships as **three distinct marketplace patterns**, each
filling in what the others can't:

**Layer 1 — Config / skill marketplaces (exists today).**
- Anthropic's Claude marketplace, GPTs store, ElevenLabs agent templates,
  LangChain Hub, OpenClaw skill registry.
- What's sold: prompts, tools, workflows. Effectively "scripts for rent".
- Buyer brings their own API keys and infra.
- Low-friction, low-moat, low-price. Copy/paste works.

**Layer 2 — Subscription platforms (exists today).**
- Lindy, Cognosys, ElevenLabs agents, Zapier AI. You subscribe to _use_ the
  agent; the vendor runs it.
- Looks like SaaS, not like ownership. The platform can delete you.

**Layer 3 — Sealed INFT agents with TEE verification (the new thing).**
Where ERC-7857 + ERC-8004 + 0G Compute _actually_ change the economics:

```text
1. Agent runs entirely inside a TEE on 0G Compute. You can't see the
   weights, the code, the keys. Nobody can.
2. INFT (ERC-7857) ownership = authorized-usage rights. TEE re-encrypts
   memory for the new owner on transfer.
3. Reputation lives in ERC-8004, bound to the INFT. Feedback and
   validation history transfer with the NFT.
4. Agent's own wallet holds the cash flow. When the NFT moves, the
   wallet's EIP-712 signature authorises the payout address change
   (ERC-8004 `setAgentWallet`). Reputation is NOT cleared but `agentWallet`
   IS — which is exactly the anti-laundering mechanic you want.
5. Buyer gets: (a) the running agent, (b) its future cash flows, (c) its
   reputation, (d) proof via TEE attestations that the same code is still
   running.
```

In this model **you're not buying a file; you're buying rights to an
income-producing process plus an on-chain track record**. Compared to
selling a Python script, that's a real asset. Compared to a Bored Ape, it
has intrinsic cash flow.

### What actually trades hands in each layer

| You sell… | Vehicle | Price driver |
| --- | --- | --- |
| A prompt / skill / workflow | Config file, claude-code skill, OpenClaw module | Usefulness of the automation |
| Usage rights to a running agent | Subscription (Web2) / x402 session (Web3) | Ongoing revenue / utility |
| **Ownership + revenue + reputation of a running sealed agent** | **INFT (ERC-7857) linked to ERC-8004** | **Expected future cash flow × reputation credibility** |

### Why this isn't one market

The three layers serve different buyers:

- A developer wants Layer 1 (cheap, copy, modify).
- A business wants Layer 2 (someone else runs it, support contract).
- An investor / operator wants Layer 3 (fixed supply, durable income, real
  ownership).

OpenSea for Layer 1 is almost irrelevant — these are $5 items. OpenSea for
Layer 2 doesn't make sense — you can't resell someone else's SaaS account.
OpenSea for Layer 3 is the interesting one, and **that's exactly where
INFTs + ERC-8004 slot in**. What's sold is "rights to a running, verifiable,
income-producing, reputable agent".

The hackathon opportunity: build a tiny version of Layer 3 in 48 hours.
Mint one agent as an INFT, attach a few real ERC-8004 feedback entries
earned during the hackathon, show cash flow into its wallet via x402, demo
a successful ownership transfer (and a wallet rotation on transfer) on-chain.
That's a thing nobody has shipped yet.

### The honest punchline

There _will_ be an OpenSea for agents, but it will feel more like **LinkedIn
+ Cashflow Notes + OpenSea** fused together. The transferable things are:
identity, reputation, access rights, and — critically — future revenue.
The non-transferable things (external API keys, infra bills, your
counterparty trust) get wrapped by TEE verification and subscription-style
runtime contracts.

---

## 8. Submission Checklist (Union of All Sponsors)

Do all of these once and reuse across submissions:

- [ ] Public GitHub repo. Clear README with architecture + setup.
- [ ] Working demo — live URL **and** ≤3-minute video.
- [ ] **`FEEDBACK.md`** (required by Uniswap, eligible for KeeperHub $500
      bounty). Cover DX, bugs, doc gaps, missing endpoints, feature requests.
- [ ] Architecture diagram (required/strongly recommended by 0G, helpful
      everywhere).
- [ ] Deployed contract addresses if any (required by 0G).
- [ ] For INFT submissions: link to the minted iNFT on the 0G explorer +
      proof of embedded intelligence/memory.
- [ ] Team roster, Telegram, X, email.
- [ ] For ENS: no hard-coded values, real resolution path.
- [ ] Reputation events from the hackathon window — even 2–3 real on-chain
      feedback entries from separate client addresses tell a huge story in
      a judging round.

---

## 9. Open Questions To Resolve Before Starting

1. Team size and skills — solo vs. pair vs. 3+? This shapes how many
   sponsors we can credibly hit.
2. Which combo (A/B/C/D) do we commit to? Combo D is the all-in reputation
   play; A is the pragmatic Uniswap+KeeperHub path. Committing early is
   worth a day of rework risk.
3. 0G mainnet vs testnet? Some prizes implicitly reward mainnet INFT
   mints.
4. Feedback bounty discipline — live `FEEDBACK.md` as we build, or backfill?
   (Live wins.)
5. Identity scope — do we issue ENS subnames per-agent, or one ENS name
   for the whole swarm?

---

## 10. References

KeeperHub:

- Docs: https://docs.keeperhub.com/
- AI tools: https://docs.keeperhub.com/ai-tools
- MCP: https://docs.keeperhub.com/ai-tools/mcp-server
- Agentic wallet: https://docs.keeperhub.com/ai-tools/agentic-wallet
- API: https://docs.keeperhub.com/api
- CLI: https://docs.keeperhub.com/cli
- Platform: https://app.keeperhub.com/

ENS:

- Docs: https://docs.ens.domains/
- Building with AI: https://docs.ens.domains/building-with-ai/
- `llms.txt`: https://docs.ens.domains/llms.txt
- ENSIP-25 blog: https://ens.domains/blog/post/ensip-25
- CCIP-Read: https://docs.ens.domains/learn/ccip-read/
- ENSv2 overview: https://docs.ens.domains/contracts/ensv2/overview/

Uniswap:

- Dev portal: https://developers.uniswap.org/
- Trading API quickstart: https://developers.uniswap.org/docs/trading/swapping-api/getting-started
- `uniswap-ai` skills: https://github.com/Uniswap/uniswap-ai
- UniswapX docs: https://docs.uniswap.org/contracts/uniswapx/overview

0G Labs:

- Docs: https://docs.0g.ai/
- Builder hub: https://build.0g.ai
- INFT overview: https://docs.0g.ai/developer-hub/building-on-0g/inft/inft-overview
- ERC-7857 standard: https://docs.0g.ai/developer-hub/building-on-0g/inft/erc7857
- Compute inference: https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference
- Storage SDK: https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk
- Telegram: https://t.me/+mQmldXXVBGpkODU1

Protocols:

- ERC-8004: https://eips.ethereum.org/EIPS/eip-8004
- ERC-3668 (CCIP-Read): https://eips.ethereum.org/EIPS/eip-3668
- x402: https://www.x402.org/ • https://docs.cdp.coinbase.com/x402
- MPP: https://mpp.dev/overview • https://docs.stripe.com/payments/machine/mpp
- OpenClaw: https://github.com/openclaw/openclaw
