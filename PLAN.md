# Combo D — "The Reputation Moat" Implementation Plan

End-to-end plan for an agent whose entire economic existence is on-chain.
Built strictly on testnets, layered so each phase ships something demoable
even if we run out of time before the next.

**Host platform: Vercel Pro + Next.js App Router.**
The full system — agent endpoint, simulated clients, validator,
dashboard, MCP server, ERC-8004 indexer — all runs as one Next.js
deployment. Cron Jobs (every 1–15 min) drive the loop. Fluid Compute
gives us up to 800s function durations. `waitUntil` handles fire-and-
forget side-effects. Upstash Redis (via Marketplace) is the hot cache;
0G Storage is the durable layer. No long-running servers, no VPS, no
babysitting.

---

## 0. Goal & Hard Success Criteria

**Goal.** A live, named, registered agent that during the hackathon window
**actually earns money from independent client wallets**, accumulates
on-chain reputation, and is verifiable by anyone with a block explorer.

**Demo-able success criteria** (all must be true at submission time):

1. The agent answers requests at `https://hack-agent.vercel.app/api/a2a/jobs`
   (or our custom domain) with a real `HTTP 402` challenge.
2. At least **3 distinct EOA addresses** have paid the agent on Base
   Sepolia USDC via x402, visible on BaseScan.
3. The agent has an **ENS subname** on Sepolia (`tradewise.agentlab.eth` or
   similar) with an `ENSIP-25` text record binding it to an ERC-8004 entry.
4. The agent has at least **5 on-chain feedback entries** in the ERC-8004
   Reputation Registry, from the same 3+ client addresses.
5. At least **1 successful validation** in the ERC-8004 Validation Registry.
6. Memory + transaction history for the agent live on **0G Storage**.
7. At least one inference call routed through **0G Compute** with TEE
   attestation logged.
8. At least one onchain action (a Uniswap swap on Base Sepolia or a token
   transfer) executed through a **KeeperHub workflow**.
9. A 3-minute demo video and a public dashboard URL where judges can see
   the live state.

**Stretch (worth bonus prize signal but not required):**

10. The agent minted as an **INFT (ERC-7857)** on the 0G testnet.
11. A live ownership transfer demo where the INFT moves to a fresh wallet
    and `agentWallet` is rotated via EIP-712 signature.
12. **MPP** session payment demo on Tempo testnet (alongside x402) for the
    KeeperHub feedback bounty.

---

## 1. Product Decision — What Service Does The Agent Provide?

**The agent is a Uniswap trading concierge** named `tradewise.agentlab.eth`.

Why this specific service:

- It's a real, valuable thing to charge for ("execute this swap reliably").
- It plugs naturally into Uniswap's prize track ($5,000 we lose otherwise).
- Job outcome is concrete and measurable → feedback signal is real, not
  vibes ("did the swap fill at the quoted price minus declared slippage?").
- KeeperHub is the natural execution layer for it.
- 0G Compute does the reasoning (route, slippage, timing).
- 0G Storage holds trade history → reputation is provably consistent.

**The service contract.** Client posts:

```jsonc
POST /a2a/jobs
{
  "task": "swap",
  "tokenIn":  "0x...",      // address on Base Sepolia
  "tokenOut": "0x...",
  "amountIn": "1000000",    // 1 USDC (6 decimals)
  "maxSlippageBps": 100,    // 1%
  "deadline": 1714000000
}
```

Agent returns 402 → client pays via x402 → agent quotes via Uniswap API →
executes via KeeperHub workflow → returns receipt + signed result.

---

## 2. Architecture (One Page) — Vercel-Pro Native

The whole project collapses into **one Next.js app on Vercel Pro**. Cron
Jobs replace any "always-running" process. `waitUntil` handles async
side-effects (post-feedback, write-to-0G-Storage). Upstash Redis (via
Vercel Marketplace) is the hot cache; 0G Storage is the durable layer.

```
                ┌──────────────────────────────────────────────────────┐
                │                     Vercel Pro                       │
                │                                                      │
                │  ┌──────────────────────────────────────────────┐    │
                │  │  Next.js App (App Router, Fluid Compute)     │    │
                │  │                                              │    │
                │  │  Pages (RSC):                                │    │
                │  │   /              → Live feedback feed       │    │
                │  │   /agent         → Agent identity card       │    │
                │  │   /jobs          → Last 50 jobs             │    │
                │  │   /inft          → INFT viewer (stretch)    │    │
                │  │                                              │    │
                │  │  Route Handlers (Node.js, 800s max):         │    │
                │  │   POST /api/a2a/jobs        ← x402 protected │    │
                │  │   GET  /api/agent-card      ← rewritten from │    │
                │  │                              /.well-known/   │    │
                │  │   POST /api/mcp             ← MCP server     │    │
                │  │   POST /api/webhooks/keeperhub               │    │
                │  │                                              │    │
                │  │  Cron Jobs (vercel.json):                    │    │
                │  │   * * * * *    → /api/cron/agent-tick        │    │
                │  │   */2 * * * *  → /api/cron/client-tick (×3)  │    │
                │  │   */10 * * * * → /api/cron/validator-tick    │    │
                │  │   */5 * * * *  → /api/cron/storage-sync      │    │
                │  │   */15 * * * * → /api/cron/reputation-cache  │    │
                │  └──────────────────────────────────────────────┘    │
                │                                                      │
                │  Marketplace:                                        │
                │   Upstash Redis  (hot KV: pending jobs, attest hash) │
                │   Edge Config    (contract addresses, ENS names)     │
                │   Vercel Blob    (job snapshots, agent avatar)       │
                └──────────────────────┬───────────────────────────────┘
                                       │
              ┌────────────┬───────────┼───────────────┬─────────────┐
              ▼            ▼           ▼               ▼             ▼
        ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ ┌─────────┐
        │ Uniswap │  │KeeperHub │  │   0G     │  │   0G       │ │ ERC-8004│
        │ Trading │  │ Workflow │  │ Storage  │  │  Compute   │ │ on      │
        │   API   │  │ (Sepolia)│  │ (KV+Log) │  │  (TeeML)   │ │ Sepolia │
        └─────────┘  └──────────┘  └──────────┘  └────────────┘ └─────────┘
              │            │
              └────┬───────┘
                   ▼
            Base Sepolia chain
            (Universal Router + USDC + Permit2)

ENS Sepolia: tradewise.agentlab.eth
  ├── addr() → agent EOA (receives x402 USDC, signs ERC-8004 agentWallet binding)
  ├── text("agent-registration[eip155:11155111:0x...IdReg][1]") = "1"  ← ENSIP-25
  └── text("agent-card") = "https://hack-agent.vercel.app/api/agent-card"
```

**Why this layout is dramatically simpler than separate apps:**

- **No babysitting.** Cron Jobs replace `node --watch` / `pm2` / a VPS.
- **No always-on process.** Each tick is a 1–60s function invocation.
- **Free reliability.** Vercel handles retries on 5xx, regional failover.
- **Single deploy.** `git push` → preview URL → promote to prod. The
  judges always see the latest state.
- **Single log stream.** All cron + API + cron failures in one place.
- **Single env.** All secrets (private keys, API keys, RPC URLs) in
  Vercel project settings; pulled locally with `vercel env pull`.

---

## 3. Per-Protocol Requirements & Testnet Strategy

### 3.0 Vercel Pro infrastructure — the host platform

| What | How | Cost |
|---|---|---|
| Project | `vercel link` from repo root → linked Next.js project on Pro | Included in Pro |
| Custom domain | `agentlab.xyz` or use a `*.vercel.app` URL — **either works** | $10/yr if custom |
| Function runtime | Node.js (default for App Router). 300s default, **800s max on Pro** with Fluid Compute. | Included |
| Upstash Redis (hot KV) | Add via **Vercel Marketplace** → Storage → Upstash. Use `@upstash/redis`. | Free tier sufficient |
| Edge Config | Vercel Project Settings → Edge Config. For contract addresses, ENS names. | Free up to 50KB |
| Vercel Blob | Add via Marketplace. For agent avatar, JSON snapshots. | Free 1GB |
| Vercel KV (legacy) | **Sunset** — use Upstash Redis directly. | n/a |
| Vercel Postgres (legacy) | **Sunset** — use Neon directly via Marketplace. | n/a |

**Key Vercel Pro features we exploit:**

1. **Cron Jobs (up to 40 on Pro, 1-min granularity).** Defined in
   `vercel.json`. Each cron hits an `/api/cron/*` route protected by
   `Authorization: Bearer ${CRON_SECRET}`.
2. **`waitUntil` from `@vercel/functions`.** After we send the response
   to a paying client, we asynchronously persist the job log to 0G
   Storage and let the validator know — without keeping the response
   waiting.
3. **Fluid Compute** (default). One warm instance handles concurrent
   jobs → fewer cold starts during the demo.
4. **`maxDuration: 300`** on the swap-execution route since 0G inference
   + KeeperHub workflow + on-chain confirmation can take 30–90s in the
   worst case.
5. **Streaming responses** via `ReadableStream` for the dashboard's live
   feedback feed. Good demo signal.
6. **Preview deployments** for each PR — judges get a permanent URL we
   can keep iterating on.
7. **Vercel logs** for every cron tick + every job — shown live in the
   demo dashboard via the runtime logs API.

**Crons we will configure (`vercel.json`):**

```json
{
  "crons": [
    { "path": "/api/cron/agent-tick",          "schedule": "* * * * *"   },
    { "path": "/api/cron/client-tick?id=1",    "schedule": "*/2 * * * *" },
    { "path": "/api/cron/client-tick?id=2",    "schedule": "*/3 * * * *" },
    { "path": "/api/cron/client-tick?id=3",    "schedule": "*/5 * * * *" },
    { "path": "/api/cron/validator-tick",      "schedule": "*/10 * * * *"},
    { "path": "/api/cron/storage-sync",        "schedule": "*/5 * * * *" },
    { "path": "/api/cron/reputation-cache",    "schedule": "*/15 * * * *"},
    { "path": "/api/cron/ens-heartbeat",       "schedule": "0 * * * *"   }
  ],
  "functions": {
    "app/api/a2a/jobs/route.ts":   { "maxDuration": 300 },
    "app/api/cron/agent-tick/route.ts":     { "maxDuration": 60  },
    "app/api/cron/client-tick/route.ts":    { "maxDuration": 60  },
    "app/api/cron/validator-tick/route.ts": { "maxDuration": 300 },
    "app/api/cron/storage-sync/route.ts":   { "maxDuration": 120 }
  }
}
```

**What each cron does:**

| Cron | Frequency | Purpose |
|---|---|---|
| `agent-tick` | every 1 min | Drain pending-job queue from Upstash Redis. Process up to N jobs per tick. |
| `client-tick?id=N` | every 2-5 min | Test client #N picks a random swap intent and posts it. Three independent client cron entries → three distinct EOAs posting feedback. |
| `validator-tick` | every 10 min | Picks a recent job from 0G Storage Log, re-runs the inference, posts `validationResponse` on Sepolia. |
| `storage-sync` | every 5 min | Flushes the last batch of completed jobs from Upstash Redis to 0G Storage Log. |
| `reputation-cache` | every 15 min | Reads ERC-8004 events on Sepolia, recomputes the dashboard's cached reputation summary into Upstash Redis. |
| `ens-heartbeat` | hourly | Refreshes the ENS resolver text record's `last-active` timestamp so judges can see the agent is live. |

**`waitUntil` pattern for paid jobs:**

File: `app/api/a2a/jobs/route.ts`

```ts
import { waitUntil } from '@vercel/functions'

export const maxDuration = 300

export async function POST(req: Request) {
  const payment = await verifyX402(req)
  if (!payment) return challenge402()

  const job = await processSwapJob(req)
  const response = Response.json({ ok: true, job })

  waitUntil(async () => {
    await zgStorage.appendLog(job)
    await upstash.publish('jobs.completed', job.id)
  })

  return response
}
```

Steps inside `POST`: (1) verify x402 header or return a 402 challenge,
(2) execute the swap synchronously (≤ 90s), (3) return the receipt to the
client immediately, (4) `waitUntil` persists the job log to 0G Storage
and publishes a `jobs.completed` event so feedback crons fire — all in
the same Fluid Compute instance.

**Vercel CLI commands we'll use:**

```bash
vercel link                          # Link the local repo to the Vercel project
vercel env pull .env.local           # Pull all env vars locally
vercel env add CRON_SECRET           # Add the cron auth secret
vercel deploy                        # Push a preview deployment
vercel deploy --prod                 # Promote to production
vercel logs <deployment-url>         # Stream logs live
vercel marketplace add upstash       # Provision Upstash Redis
```

### 3.1 Sepolia (Ethereum testnet) — for ENS + ERC-8004 + KeeperHub

| What | How | Cost |
|---|---|---|
| RPC endpoint | Alchemy / Infura free tier, or `https://ethereum-sepolia-rpc.publicnode.com` | Free |
| Sepolia ETH | https://sepoliafaucet.com (Alchemy), https://www.infura.io/faucet/sepolia, https://cloud.google.com/application/web3/faucet/ethereum/sepolia | Free, ~0.5 ETH/day |
| ENS test app | https://app.ens.domains (switch wallet to Sepolia) | Free, but 1-year registration costs ~0.003 Sepolia ETH |
| Contracts to deploy | ERC-8004 IdentityRegistry / ReputationRegistry / ValidationRegistry | ~0.1 Sepolia ETH total |
| KeeperHub testnet | KeeperHub supports Sepolia natively. Funded via dashboard. | Free |

**What we need from ENS specifically:**

- Register **`agentlab.eth`** (parent name we control) on Sepolia.
- Issue subnames programmatically (`tradewise.agentlab.eth`,
  `client1.agentlab.eth`, `client2.agentlab.eth`, etc.).
- Set on each:
  - `addr()` → the agent's EOA
  - `text("agent-registration[eip155:11155111:<IdRegAddr>][<agentId>]")` = `"1"` (ENSIP-25)
  - `text("agent-card")` = URL of the agent registration JSON
  - `text("description")`, `text("url")`, `text("avatar")` for cosmetics
- **Reverse resolution**: agent EOA → `tradewise.agentlab.eth`.

ENS docs:
- Building with AI: https://docs.ens.domains/building-with-ai/
- Subname management with viem: https://docs.ens.domains/web/quickstart

### 3.2 Base Sepolia — for x402 USDC payments

| What | How | Cost |
|---|---|---|
| RPC endpoint | https://sepolia.base.org or Alchemy/Infura | Free |
| Base Sepolia ETH | https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet | Free |
| Base Sepolia USDC | Circle testnet faucet: https://faucet.circle.com (select Base Sepolia) | Free, ~10 USDC/req |
| x402 facilitator | Coinbase's hosted facilitator: `https://x402.org/facilitator` (testnet supported) | Free |
| USDC contract | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Base Sepolia) | n/a |

**What we need from x402 specifically:**

- A signing wallet for the **agent** (receives payments).
- A signing wallet for **each test client** (sends payments). Generate 3+
  clients so reputation events look organic.
- Server-side: hand-roll the verifier as a small util in `lib/x402.ts`
  (verifies the EIP-3009 `transferWithAuthorization` signature against
  Base Sepolia USDC, calls the Coinbase facilitator). The `x402-express`
  package targets Express middleware, which we don't use — Next.js
  Route Handlers consume the Web `Request`/`Response` API directly.
- Client-side: install `@coinbase/x402` or use `fetch` + a small helper
  that re-signs on 402, called from the `client-tick` cron handler.

x402 docs: https://www.x402.org/ • https://docs.cdp.coinbase.com/x402

### 3.3 0G Galileo testnet — for Storage + Compute + INFT

| What | How | Cost |
|---|---|---|
| RPC endpoint | `https://evmrpc-testnet.0g.ai` | Free |
| Chain ID | 16602 (Galileo) | n/a |
| Test 0G | https://faucet.0g.ai (also works from build hub) | Free |
| Storage SDK | `pnpm add @0glabs/0g-ts-sdk` | Free |
| Compute SDK | `pnpm add @0glabs/0g-serving-broker` | Free |
| INFT contracts | Reference impl in 0G builder hub: https://build.0g.ai | Free |

**What we need from 0G Storage:**

- A KV namespace for "agent state" (current open positions, last signal,
  config snapshot).
- A Log stream for "transaction history" (every job ever processed:
  request, response, payment receipt, feedback event).
- Encrypt-at-rest via the SDK's helpers — required if we go to INFT later.

**What we need from 0G Compute:**

- Pick **one TeeML model** that's actually live on Galileo testnet at the
  time of building. As of now plausible options: `gpt-oss-120b`,
  `deepseek-chat-v3`, `GLM-5-FP8`. **Verify availability before P3** —
  fall back to `qwen3.6-plus` over TeeTLS if no TeeML model is live.
- Use the OpenAI-compatible endpoint via the broker SDK.
- On every response, capture the `ZG-Res-Key` header and call
  `broker.inference.processResponse(...)` to verify the TEE signature.
- Store the attestation hash with each job log entry on 0G Storage.

**What we need from 0G INFT (stretch):**

- Deploy or use the reference ERC-7857 contract on Galileo.
- Mint one INFT pointing at the agent's encrypted memory blob on 0G Storage.
- Demo a single transfer to a fresh wallet using the TEE oracle re-encrypt
  flow.

0G docs:
- Builder hub: https://build.0g.ai
- Compute inference: https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference
- Storage SDK: https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk
- INFT overview: https://docs.0g.ai/developer-hub/building-on-0g/inft/inft-overview

### 3.4 KeeperHub — execution reliability layer

| What | How | Cost |
|---|---|---|
| Account | Sign up at https://app.keeperhub.com/ | Free |
| Network | KeeperHub supports Sepolia + Base Sepolia | Free |
| MCP server | `claude mcp add --transport http keeperhub https://app.keeperhub.com/mcp` | Free |
| `kh` CLI | `brew install keeperhub/tap/kh` then `kh auth login` | Free |
| Agentic wallet | `npx @keeperhub/wallet skill install && npx @keeperhub/wallet add` | Free, funded via Sepolia ETH faucet |

**What we need from KeeperHub specifically:**

- A **workflow** that takes a swap request and executes it on Base Sepolia
  with retries / gas management. Defined via the dashboard or `kh` CLI.
- The agent calls that workflow from its server using either the MCP
  `call_workflow` tool or the REST API.
- Workflow execution logs become part of the trade history on 0G Storage.
- Optional: configure the workflow as a **paid** workflow so we exercise
  KeeperHub's own x402/MPP path → that's the "deep integration" angle for
  the prize.

KeeperHub docs:
- AI tools: https://docs.keeperhub.com/ai-tools
- Agentic wallet: https://docs.keeperhub.com/ai-tools/agentic-wallet

### 3.5 Uniswap (Trading API) — actual swap execution

| What | How | Cost |
|---|---|---|
| API key | Apply at https://developers.uniswap.org/ (free tier sufficient) | Free |
| Trading API base | `https://trade-api.gateway.uniswap.org/v1` | Free |
| Testnet swaps | Uniswap's hosted **Trading API** is mainnet-only as of writing. For testnet, deploy our own minimal Permit2-based swap router OR call the v3 router contracts directly on Base Sepolia. | Free |
| Permit2 (Base Sepolia) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` (canonical, deployed everywhere) | n/a |
| Universal Router (Base Sepolia) | Look up at https://docs.uniswap.org/contracts/v4/deployments | n/a |

**What we need from Uniswap specifically:**

- For the **quote step**: hit the Trading API on **mainnet** (read-only, no
  funds at risk) to get realistic quotes. Pricing data is the same
  abstraction — the agent learns/reasons against real pools.
- For the **execute step**: do the actual swap on Base Sepolia using the
  Universal Router + Permit2 directly via viem. We control the test pool
  liquidity if needed (deploy two ERC-20s and a v3 pool we seed).
- **`FEEDBACK.md`** must live at the repo root from day 1 — hard prize
  eligibility gate.

Uniswap docs:
- Trading API: https://developers.uniswap.org/docs/trading/swapping-api/getting-started
- v4 deployments: https://docs.uniswap.org/contracts/v4/deployments

### 3.6 ERC-8004 — Identity, Reputation, Validation

| What | How | Cost |
|---|---|---|
| Reference contracts | Fork from https://github.com/erc8004 (or the trustless-agents reference repo cited in the EIP) | n/a |
| Deployment | Foundry script → Sepolia | ~0.05 Sepolia ETH |
| Spec | https://eips.ethereum.org/EIPS/eip-8004 | n/a |

**What we need to deploy on Sepolia:**

1. **`IdentityRegistry`** (ERC-721 with URIStorage). Mint one NFT for the
   agent. `tokenURI` points at our hosted agent card JSON.
2. **`ReputationRegistry`**. Anyone can call `giveFeedback(...)`. We post
   from each client's wallet after the corresponding job.
3. **`ValidationRegistry`**. Stub validator address = our validator EOA.

**Agent registration file we serve at `/.well-known/agent-card.json`:**

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "tradewise",
  "description": "Reliable Uniswap swap concierge. Pay per swap.",
  "image": "https://agent.example.com/avatar.png",
  "services": [
    { "name": "A2A",  "endpoint": "https://agent.example.com/a2a", "version": "0.3.0" },
    { "name": "MCP",  "endpoint": "https://agent.example.com/mcp", "version": "2025-06-18" },
    { "name": "ENS",  "endpoint": "tradewise.agentlab.eth",        "version": "v1" }
  ],
  "x402Support": true,
  "active": true,
  "registrations": [
    { "agentId": 1, "agentRegistry": "eip155:11155111:0x...IdReg" }
  ],
  "supportedTrust": ["reputation", "tee-attestation"],
  "agentWallet": "0x...agentEOA"
}
```

`agentWallet` is set via `setAgentWallet(agentId, newWallet, deadline,
signature)` — sign EIP-712 from the wallet's private key. **This is the
anti-laundering hook**: clears on transfer, must be re-signed by the new
owner. Demo-worthy.

### 3.7 ERC-7857 (INFT) — stretch goal

| What | How |
|---|---|
| Reference contracts | 0G's INFT reference repo on the builder hub |
| TEE oracle | 0G provides one; or stub locally for the demo |
| Re-encryption | Done by the oracle inside a TEE; we observe the outcome |

We deploy a reference ERC-7857 on **Galileo testnet**, mint one tied to the
agent's encrypted memory blob URL, and demo a transfer at the end of the
hackathon. **Don't start this until P3 is green.**

### 3.8 MPP — stretch goal (KeeperHub feedback bounty angle)

| What | How |
|---|---|
| Tempo testnet RPC | `https://rpc.testnet.tempo.network` (chain ID 4218) |
| USDC.e testnet faucet | https://faucet.tempo.network |
| `mppx` SDK | `npm i @mpp/mppx` |

If we have time, expose a parallel `MPP` payment path on the agent so a
client can pre-authorise a session and stream micropayments. Same
challenge/response shape as x402. **Optional.**

---

## 4. Build Phases — Strict Priority Order

The plan is **sequenced so every phase produces a demoable artefact**. If
we run out of time after P3, we still have a complete prize-eligible
submission for ENS + 0G + Uniswap. P4 unlocks KeeperHub. P5 unlocks the
INFT/transfer story.

### Phase 0 — Pre-hackathon setup (do this BEFORE the start signal)

Time: 2–3 hours, the night before.

- [ ] Create GitHub repo. Run `pnpm create next-app@latest hack-agent
      --ts --app --tailwind --eslint --no-src-dir`.
- [ ] **Vercel Pro provisioning:**
      - `vercel link` → connect repo to a Vercel Pro project.
      - In dashboard → Storage → add **Upstash Redis** from Marketplace.
        This auto-injects `UPSTASH_REDIS_REST_URL` and
        `UPSTASH_REDIS_REST_TOKEN`.
      - Settings → **Edge Config** → create one called `agent-config`.
      - Add `CRON_SECRET` env var (generate with `openssl rand -hex 32`).
      - Add private keys + RPC URLs as env vars (mark as
        "Production, Preview, Development", *not* exposed to the browser).
      - `vercel env pull .env.local` to mirror locally.
- [ ] Sign up KeeperHub, Uniswap dev portal, Alchemy / Infura, 0G builder
      hub.
- [ ] Top up Sepolia, Base Sepolia, and Galileo testnet faucets to the
      hilt (drain every faucet you can find — they rate limit).
- [ ] Generate **5 EOAs** with viem: `agent`, `client1`, `client2`,
      `client3`, `validator`. Save private keys to Vercel env vars
      (`AGENT_PK`, `CLIENT1_PK`, etc.) — **never** commit to git, **never**
      prefix with `NEXT_PUBLIC_`. Fund each from faucets.
- [ ] On Sepolia ENS, register `agentlab.eth` (~$0.003 Sepolia ETH/year).
- [ ] On Galileo testnet, fund the agent EOA so it can pay for storage
      writes and compute calls.
- [ ] Verify everything works: `cast call`, `viem` reads, a sample 0G
      Storage write, a sample 0G Compute inference, a KeeperHub MCP tool
      call.
- [ ] Pull all relevant `llms.txt` / docs into the repo (under `/docs`)
      for offline reference (ENS, KeeperHub, x402, 0G).
- [ ] First deploy: `vercel deploy` → confirm preview URL is reachable.
      Save the production URL — that becomes our public agent endpoint.

### Phase 1 — Skeleton agent that earns money (hours 0–8)

**Goal:** a Next.js route handler that returns 402, accepts payment,
returns a useful answer.

- [ ] Add `app/api/a2a/jobs/route.ts` Route Handler.
  - `POST`: validate intent shape with Zod → check x402 header → if
    missing, return 402 challenge JSON with the agent's Base Sepolia
    USDC payment address. If valid, fetch a quote from Uniswap mainnet
    Trading API and return it signed.
  - `export const maxDuration = 300` so the swap path has headroom.
- [ ] Add `app/api/agent-card/route.ts` returning the full ERC-8004 +
      A2A agent card JSON. Wire `vercel.json` rewrite:
      `/.well-known/agent-card.json` → `/api/agent-card`.
- [ ] Add `app/api/cron/client-tick/route.ts` — picks the client wallet
      indicated by `?id=N`, generates a swap intent, posts to
      `/api/a2a/jobs`, signs the 402, completes the payment loop, logs.
      Verify with `Authorization: Bearer ${CRON_SECRET}`.
- [ ] Add minimal x402 verification in `lib/x402.ts` (Base Sepolia
      facilitator URL hard-coded; price = `1 USDC`).
- [ ] Push: `git push` → preview deploy. Trigger
      `/api/cron/client-tick?id=1` manually. Confirm 402 → pay → quote.
- [ ] **Demoable now:** Vercel preview URL serves an agent that charges
      1 USDC on Base Sepolia and returns Uniswap quotes. Cron is
      simulating clients paying it on a schedule.

### Phase 2 — On-chain identity (hours 8–16)

**Goal:** agent has an ENS subname, an ERC-8004 entry, and a verifiable
agent card served from Vercel.

- [ ] In `contracts/`: scaffold Foundry workspace **outside** the
      Next.js app dir but inside the same repo. Add the path to
      `.vercelignore` so Vercel doesn't try to build it.
- [ ] Deploy `IdentityRegistry`, `ReputationRegistry`,
      `ValidationRegistry` to Sepolia. Run
      `pnpm script:write-edge-config` to push their addresses into
      Vercel Edge Config under key `addresses.sepolia` — every route
      handler reads them via `@vercel/edge-config` (instant, no DB
      call).
- [ ] Mint identity NFT for the agent (`agentId = 1`) with `tokenURI`
      pointing at `https://<prod-url>/api/agent-card`.
- [ ] Call `setAgentWallet(1, agentEOA, deadline, sig)` to bind payout
      address.
- [ ] On Sepolia ENS:
      - Register `agentlab.eth`.
      - Issue subname `tradewise.agentlab.eth`.
      - Set `addr()` → agent EOA.
      - Set ENSIP-25 text record
        `agent-registration[eip155:11155111:0x...IdReg][1]` = `"1"`.
      - Set `text("agent-card")` = full Vercel URL.
- [ ] Make `/api/agent-card` read its addresses dynamically from Edge
      Config so we can change them without redeploying.
- [ ] **Demoable now:** point a judge at `tradewise.agentlab.eth`, they
      can resolve it, fetch the card from Vercel, see the ERC-8004 link,
      and verify on Etherscan.

### Phase 3 — Reputation + 0G integration (hours 16–28)

**Goal:** every paid job produces an on-chain feedback entry; memory and
inference live on 0G; cron jobs drive the loop.

- [ ] Wire `app/api/cron/client-tick` so that **after** each successful
      paid job it calls
      `reputationRegistry.giveFeedback(1, score, decimals, "swap-success", ...)`
      from the corresponding client wallet → 3 distinct feedback
      sources via 3 cron entries.
- [ ] Add `lib/zg-storage.ts` adapter (server-only, never imported in
      client components):
      - `appendJobLog(job)` → 0G Storage Log.
      - `readState(key)` / `writeState(key, value)` → 0G Storage KV.
- [ ] Inside `app/api/a2a/jobs/route.ts`, after returning the response,
      use `waitUntil(() => zgStorage.appendJobLog(job))` so persistence
      doesn't block the client.
- [ ] Migrate the agent to use **0G Compute** for reasoning. Use the
      OpenAI-compatible endpoint via `@0glabs/0g-serving-broker` wrapped
      in `lib/zg-compute.ts`. Capture the TEE attestation header on
      every call and store its hash with the job log.
- [ ] Add `app/api/cron/storage-sync/route.ts` (every 5 min): drains the
      `jobs:pending-sync` Upstash Redis list and writes any missing logs
      to 0G Storage. Insurance against `waitUntil` failure.
- [ ] Add `app/api/cron/reputation-cache/route.ts` (every 15 min): reads
      `ReputationRegistry` events on Sepolia, recomputes the dashboard's
      reputation summary, writes to Upstash Redis under
      `reputation:summary`.
- [ ] Build the dashboard pages — same Next.js app, RSC by default:
      - `app/page.tsx`: live feedback feed. Server Component reading
        directly from Upstash Redis cache (refreshed by cron).
      - `app/agent/page.tsx`: the resolved ENS card + ERC-8004 metadata.
      - `app/jobs/page.tsx`: last 50 jobs from 0G Storage.
      - Use `revalidate = 30` or React Server Component streaming so the
        dashboard auto-updates without a websocket.
- [ ] **Demoable now:** complete reputation loop. ENS + 0G + Uniswap
      submissions are all eligible. **If we stop here, we still win.**

### Phase 4 — Validation + KeeperHub (hours 28–40)

**Goal:** validation registry has real entries, and onchain execution
goes through KeeperHub workflows.

- [ ] Add `app/api/cron/validator-tick/route.ts` (every 10 min):
      - Reads recent jobs from 0G Storage.
      - Picks every Nth one and re-runs the inference inside a mock TEE
        wrapper (or — bonus — inside a real 0G Compute attested call).
      - Posts `validationResponse(...)` to the ValidationRegistry on
        Sepolia from the validator EOA.
      - `maxDuration: 300` for headroom (compute + chain confirmation).
- [ ] Create a KeeperHub workflow on Sepolia for the **swap execution**
      step. Trigger: HTTP. Action: a Web3 `write-contract` against the
      Universal Router on Base Sepolia. Save the workflow ID into Edge
      Config.
- [ ] Replace the agent's direct viem swap call with
      `kh.callWorkflow(workflowId, params)` — preferably via the MCP
      client so we get the "deep integration" judging signal.
- [ ] Optionally expose **our own** MCP server at `app/api/mcp/route.ts`
      so other agents (and Cursor itself) can call `tradewise.swap` as a
      tool. Bonus signal for KeeperHub + ENS judges.
- [ ] Demonstrate failure-mode resilience: pause the Vercel project's
      cron jobs mid-job and show that KeeperHub still completes the
      swap. Record this for the demo.
- [ ] **Demoable now:** all 4 sponsors are hit deeply.

### Phase 5 — Polish + INFT + demo video (hours 40–48)

**Goal:** prize-grade polish + the transferability story.

- [ ] On 0G Galileo, deploy the ERC-7857 reference contract (or use the
      one already deployed). Mint INFT for the agent, with metadata
      pointing at the encrypted memory snapshot on 0G Storage.
- [ ] Add `app/inft/page.tsx` showing the INFT and a one-click transfer
      button (server action) that:
      1. Old owner calls `transfer(...)`.
      2. TEE oracle re-encrypts memory for new owner's pubkey.
      3. `agentWallet` clears on the ERC-8004 entry; new owner signs
         `setAgentWallet(...)`.
      4. New owner makes a paid call to the agent; it works seamlessly.
- [ ] Generate a dynamic OpenGraph image for the agent at
      `app/agent/opengraph-image.tsx` using Vercel's built-in OG
      generator — embeds the live reputation score. Looks great when
      the agent ENS link is shared on X/Telegram.
- [ ] Write `FEEDBACK.md` for the **Uniswap track + KeeperHub feedback
      bounty** simultaneously. Cover real DX pain we hit (especially
      around running x402 + cron on Vercel).
- [ ] Architecture diagram (export from Excalidraw / Figma → PNG into
      `/public/docs`).
- [ ] Record 3-min demo video. Script in `/docs/demo-script.md`.
- [ ] Final README pass: link to the production Vercel URL, BaseScan tx
      hashes, Etherscan addresses, 0G explorer pages, ENS app links.
- [ ] Promote to production: `vercel deploy --prod`. Confirm crons are
      running on the production deployment (Vercel only runs cron on
      production).
- [ ] Submit to each sponsor portal.

---

## 5. Repository Layout — One Next.js App + Foundry Workspace

```
hack-agent/
├── app/                              ← Next.js App Router (the WHOLE agent)
│   ├── layout.tsx
│   ├── page.tsx                      ← Dashboard root: live feedback feed
│   ├── agent/
│   │   ├── page.tsx                  ← ENS + ERC-8004 identity card viewer
│   │   └── opengraph-image.tsx       ← Dynamic OG image with live reputation
│   ├── jobs/page.tsx                 ← Last 50 jobs from 0G Storage
│   ├── inft/page.tsx                 ← (P5) INFT viewer + transfer button
│   └── api/
│       ├── agent-card/
│       │   └── route.ts              ← Serves ERC-8004 + A2A agent card
│       ├── a2a/
│       │   └── jobs/
│       │       └── route.ts          ← POST: x402-protected job intake
│       ├── mcp/
│       │   └── route.ts              ← Our MCP server (P4)
│       ├── webhooks/
│       │   └── keeperhub/route.ts    ← Workflow completion callback
│       └── cron/
│           ├── agent-tick/route.ts          ← Drain pending jobs
│           ├── client-tick/route.ts         ← Simulated client posts a job
│           ├── validator-tick/route.ts      ← Re-run + post validation
│           ├── storage-sync/route.ts        ← Flush KV → 0G Storage
│           ├── reputation-cache/route.ts    ← Recompute dashboard cache
│           └── ens-heartbeat/route.ts       ← Ping ENS resolver text record
├── lib/                               ← Server-only modules (never bundled to client)
│   ├── x402.ts                        ← x402 verify + challenge helpers
│   ├── erc8004.ts                     ← Read/write helpers for the 3 registries
│   ├── ens.ts                         ← ENS subname + ENSIP-25 helpers
│   ├── uniswap.ts                     ← Trading API client (mainnet quote)
│   ├── keeperhub.ts                   ← Workflow + MCP client wrapper
│   ├── zg-storage.ts                  ← 0G Storage KV + Log adapter
│   ├── zg-compute.ts                  ← 0G Compute broker (TeeML / TeeTLS)
│   ├── upstash.ts                     ← Upstash Redis client (singleton)
│   ├── edge-config.ts                 ← Read deployed addresses from Edge Config
│   ├── wallets.ts                     ← Loads agent / client / validator EOAs
│   ├── cron-auth.ts                   ← Verifies Bearer ${CRON_SECRET}
│   ├── soul.md                        ← OpenClaw-style agent prompt
│   └── abis/                          ← Generated ABIs from contracts/
├── contracts/                         ← Foundry workspace (NOT bundled by Next)
│   ├── src/
│   │   ├── IdentityRegistry.sol       ← ERC-8004
│   │   ├── ReputationRegistry.sol
│   │   ├── ValidationRegistry.sol
│   │   └── INFT.sol                   ← ERC-7857 (stretch)
│   ├── script/
│   │   ├── Deploy.s.sol
│   │   ├── MintIdentity.s.sol
│   │   ├── SetAgentWallet.s.sol
│   │   └── WriteEdgeConfig.s.sol      ← Pushes addresses to Vercel Edge Config
│   ├── test/
│   └── foundry.toml
├── public/
│   └── docs/
│       └── architecture.png
├── docs/
│   ├── demo-script.md
│   └── deployments.md                 ← Testnet addresses + tx hashes
├── .env.example                       ← Names of every env var (no values)
├── .vercelignore                      ← Excludes contracts/, foundry artefacts
├── vercel.json                        ← Cron schedules + maxDuration overrides
├── next.config.ts
├── tsconfig.json
├── package.json                       ← Single root package, no workspace
├── FEEDBACK.md                        ← Uniswap + KeeperHub feedback bounty
├── README.md
└── PLAN.md                            ← This file
```

**Why single-package and not pnpm workspaces:**

- Vercel deploys the whole repo as one Next.js project.
- Cron jobs, A2A endpoint, MCP server, dashboard, OG images — all the
  same Vercel Function bundle.
- The "client" agents and "validator" used to be separate Node.js
  processes; now they're cron-triggered Route Handlers.
- The only thing **not** in the Next.js bundle is `contracts/` —
  Foundry compiles separately and writes the artifacts into `lib/abis/`
  for the runtime to consume.

**Environment variables** (set in Vercel project settings, pulled with
`vercel env pull`):

```
# Auth
CRON_SECRET                 — Bearer token for cron routes
EDGE_CONFIG                 — Auto-injected by Vercel

# Wallets (server-only, never NEXT_PUBLIC_*)
AGENT_PK
CLIENT1_PK
CLIENT2_PK
CLIENT3_PK
VALIDATOR_PK

# RPCs
SEPOLIA_RPC_URL
BASE_SEPOLIA_RPC_URL
ZG_GALILEO_RPC_URL

# Sponsor APIs
UNISWAP_API_KEY
KEEPERHUB_API_KEY
KEEPERHUB_WORKFLOW_ID_SWAP
ZG_BROKER_URL
ZG_PRIVATE_KEY                ← Funds 0G Storage writes + Compute calls

# Storage (auto-injected by Marketplace)
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
BLOB_READ_WRITE_TOKEN
```

---

## 6. Risk Register & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Uniswap Trading API doesn't support testnet | High | Medium | Use mainnet API for quoting (read-only), execute swaps directly via Universal Router on Base Sepolia. Document in `FEEDBACK.md`. |
| 0G Compute model availability shifts on testnet | Medium | High | Audit available models in P0. Have TeeTLS fallback (`qwen3.6-plus`) ready. |
| ERC-8004 reference contracts not yet on Sepolia | Medium | Low | Deploy our own from the spec — saves time vs hunting community deployments. |
| ENS Sepolia subname registration flow changes | Low | Medium | Use viem's ENS helpers + the official Sepolia ENS app as fallback. |
| KeeperHub MCP tool surface drift | Low | Medium | Pin to the `kh` CLI version we tested in P0. Have REST API fallback. |
| INFT (P5) is too complex to ship | Medium | Low | P5 is explicitly stretch. Do not start until P4 is green. |
| Cron only runs on production deployments | Certain | Medium | Promote with `vercel deploy --prod` early in P3 so we have real cron data by P5. Manually invoke cron routes during dev with curl + `CRON_SECRET`. |
| Vercel function timeout (300s default) hits during slow chain confirms | Medium | Medium | Set `maxDuration: 800` on the swap-execution route (Pro allows up to 800s). Use `waitUntil` to detach side-effects. |
| Two cron ticks step on each other (concurrent agent-tick) | Low | Medium | Use Upstash Redis SETNX lock (`agent-tick:lock`, TTL 90s) at the top of the handler. |
| `waitUntil` work fails silently after response sent | Low | Medium | Mirror every event into Upstash Redis first; `storage-sync` cron acts as the durable retry. |
| Edge Config staleness during a contract redeploy | Low | Low | Edge Config replicates in seconds; confirm with `vercel edge-config get` after every contract redeploy. |
| Faucets rate-limit during the hackathon | High | Medium | Pre-fund all 5 EOAs to the maximum in P0. |
| Anthropic / 0G inference outage during demo | Low | High | Cache the last successful response in Upstash. Have a recorded video as Plan C. |
| ERC-8004 validator infinite-loop re-executes its own work | Low | Low | Validator only acts on `agentId != validatorAddress`. Tested in P4. |
| Cron secret leaks via referer / logs | Low | High | Validate via constant-time compare; never log header. Treat as a deployment secret in Vercel. |

---

## 7. Time Box (48-hour hackathon)

| Hours | Phase | Output |
|---|---|---|
| -3 to 0 | P0 | All accounts, faucets, keys, RPCs ready. `git init` done. |
| 0–8 | P1 | Agent earns x402 on Base Sepolia. Client pays. Quote returned. |
| 8–16 | P2 | ERC-8004 deployed. ENS subname live. Agent card resolves. |
| 16–28 | P3 | Reputation events. 0G Storage live. 0G Compute live. Dashboard live. |
| 28–40 | P4 | Validator posting. KeeperHub workflow executing swaps. |
| 40–46 | P5 | INFT minted + 1 transfer demo. FEEDBACK.md polished. |
| 46–48 | submit | Video recorded. README links wired. Forms filled. |

---

## 8. Demo Script (3 minutes — record at the end of P5)

1. (0:00) Show `https://hack-agent.vercel.app` dashboard with the live
   feedback feed — already populated from the hackathon's overnight
   cron runs (the Vercel cron tab on the side shows the last 10
   client-tick + validator-tick invocations succeeding).
2. (0:20) Open the agent's ENS name on the Sepolia ENS app — show the
   ENSIP-25 record + agent-card text record (which resolves to a
   Vercel-hosted URL).
3. (0:35) Click through to the Etherscan ERC-8004 IdentityRegistry entry
   for `agentId 1`. Show `tokenURI`, the agent card JSON.
4. (0:55) In a terminal: `curl -X POST https://hack-agent.vercel.app/api/cron/client-tick?id=1
   -H "Authorization: Bearer $CRON_SECRET"` — a fresh client posts a
   swap request. Watch the 402 challenge → payment → fulfilment in the
   Vercel logs tab side-by-side.
5. (1:30) Refresh dashboard — the new feedback event appears, the
   earnings counter ticks up.
6. (1:45) Show the BaseScan tx for the x402 USDC payment landing in the
   agent's wallet.
7. (2:00) Show the 0G explorer page for the agent's job log entry,
   including the TEE attestation hash.
8. (2:15) Show the KeeperHub dashboard with the workflow run that did
   the actual swap on Base Sepolia.
9. (2:30) (Stretch) Open the INFT viewer on the 0G testnet explorer.
   Run the transfer script live; show `agentWallet` clearing then being
   re-set by the new owner.
10. (2:50) Cut to the final card: "tradewise.agentlab.eth — earned $X
    during the hackathon, 5 client addresses, 12 feedback entries, 1
    validation, all on-chain."

---

## 9. Submission Checklist

For each of the four sponsors, do the same prep once and reuse:

- [ ] **Public GitHub repo.** `https://github.com/<user>/hack-agent`. MIT.
- [ ] **README.md** at root with: live URLs, deployment addresses, one
      paragraph per sponsor explaining what we use them for.
- [ ] **PLAN.md** (this file) committed.
- [ ] **FEEDBACK.md** at root. Cover Uniswap DX + KeeperHub DX in the
      same file. Sections per sponsor.
- [ ] **Architecture diagram** (`docs/architecture.png`).
- [ ] **3-min demo video** uploaded to YouTube/Loom. Link in README.
- [ ] **Live demo URL** (the dashboard) reachable from a fresh browser.
- [ ] **Per-sponsor submission**:
      - 0G — both tracks: paste contract addresses, INFT explorer link,
        TEE attestation evidence.
      - KeeperHub — main track + feedback bounty: workflow ID, MCP usage
        evidence, `FEEDBACK.md` link.
      - ENS — AI-Agents track: ENS app URL for the resolvable name, video.
      - Uniswap — `FEEDBACK.md` link, swap tx hashes on BaseScan.
- [ ] **Team contacts**: Telegram + X handles in each form.

---

## 10. Open Decisions To Lock In Before Starting

1. **Solo or team?** Affects whether P4 + P5 are realistic.
2. **Domain name for the agent.** `agentlab.xyz` vs the auto-assigned
   `*.vercel.app` URL. Vercel Pro includes the production `*.vercel.app`
   subdomain for free; a custom domain is $10 of real money. The ENS
   `text("agent-card")` record can point to either — both work, the
   `*.vercel.app` URL is genuinely fine for judging.
3. **Parent ENS name.** `agentlab.eth` is the placeholder; pick something
   we like in P0.
4. **OpenClaw vs hand-rolled agent.** OpenClaw is sponsor-aligned but
   adds integration risk. Default: hand-roll a minimal loop in
   `lib/soul.md` + `lib/agent-loop.ts`, keep filenames OpenClaw-
   compatible (`SOUL.md`, `USER.md`, `AGENTS.md`, `TOOLS.md`) so we can
   swap in OpenClaw later without rework.
5. **Real money for 0G mainnet INFT?** No. Stick to Galileo testnet. The
   judging signal from a testnet INFT is essentially the same as mainnet
   for a 48-hour hackathon.
