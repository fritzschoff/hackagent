# tradewise.agentlab.eth — Architecture

ASCII reference for the Combo D ("The Reputation Moat") build.
One coherent project hitting four sponsor stacks from one Vercel
deployment.

```
                                    ┌────────────────────────────────────────────────────────────────┐
                                    │                                                                │
        ┌────────────┐              │              VERCEL  PRO  ·  Next.js App Router                │
        │            │              │                                                                │
        │  CLIENT    │              │   ┌──────────────────────────────────────────────────────┐    │
        │  AGENTS    │  HTTP 402    │   │  Route Handlers (Node, Fluid Compute)                │    │
        │ (3 cron-   │ ◀──────────▶ │   │   POST /api/a2a/jobs           ← x402 protected      │    │
        │  driven    │  EIP-3009    │   │   GET  /api/agent-card         ← ERC-8004 card        │    │
        │  EOAs)     │  signed auth │   │   GET  /api/cron/{client,validator,agent,…}-tick     │    │
        │            │              │   │   GET  /.well-known/agent-card.json (rewritten)       │    │
        └────────────┘              │   └────────────┬─────────────────────────────────────────┘    │
              │                     │                │                                               │
              │                     │   ┌────────────┴─────────────────────────────────────────┐    │
              │                     │   │  Cron schedule (vercel.json)                         │    │
              │ pays $0.10 USDC     │   │   * * * * *      → agent-tick                        │    │
              │ (Base Sepolia)      │   │   */2,3,5 * * * *→ client-tick?id=1|2|3              │    │
              │                     │   │   */10 * * * *   → validator-tick                    │    │
              │                     │   │   */5  * * * *   → storage-sync                      │    │
              │                     │   │   */15 * * * *   → reputation-cache                  │    │
              │                     │   │   0 * * * *      → ens-heartbeat                     │    │
              │                     │   └──────────────────────────────────────────────────────┘    │
              │                     │                                                                │
              │                     │   Marketplace:                                                 │
              │                     │   ┌──────────┐ ┌──────────────┐ ┌──────────────┐              │
              │                     │   │ Upstash  │ │ Edge Config  │ │ Vercel Blob  │              │
              │                     │   │ Redis    │ │ (addresses,  │ │ (job snaps,  │              │
              │                     │   │ (jobs,   │ │  workflowId) │ │  avatar)     │              │
              │                     │   │  cron)   │ │              │ │              │              │
              │                     │   └──────────┘ └──────────────┘ └──────────────┘              │
              │                     │                                                                │
              ▼                     └─────────┬────────────────┬──────────────┬─────────────┬───────┘
        ┌──────────────────────────┐          │                │              │             │
        │  x402  facilitator       │          │                │              │             │
        │  (Coinbase / x402.rs)    │ ─────────┘                │              │             │
        │  - relays EIP-3009       │ submits USDC.transferWithAuthorization on Base Sepolia │
        │  - pays gas on settle    │                                                          │
        └──────────────────────────┘                                                          │
                                                                                              │
                          ┌───────────────────┬────────────────┬────────────────┬─────────────┘
                          ▼                   ▼                ▼                ▼
                ┌─────────────────┐ ┌──────────────────┐ ┌────────────┐ ┌─────────────────┐
                │  Base Sepolia   │ │   Sepolia        │ │  0G        │ │  KeeperHub      │
                │  (chain 84532)  │ │  (chain 11155111)│ │  Galileo   │ │  (hosted)       │
                │                 │ │                  │ │  (chain    │ │                 │
                │  USDC           │ │  ERC-8004        │ │   16602)   │ │  Workflow run   │
                │  ┌───────────┐  │ │  IdentityReg     │ │            │ │  (HTTP / MCP    │
                │  │ x402 USDC │  │ │  ReputationReg   │ │  Storage   │ │   trigger)      │
                │  │ payments  │  │ │  ValidationReg   │ │  (Merkle   │ │                 │
                │  │ → agent   │  │ │  + ENS           │ │   root +   │ │  Compute        │
                │  └───────────┘  │ │   ETHRegistrar   │ │   anchor   │ │  (TeeML —       │
                │                 │ │   PublicResolver │ │   pending  │ │   stretch)      │
                │  (Uniswap        │ │   (Public)       │ │   SDK fix) │ │                 │
                │   Universal      │ │                  │ │            │ │  (account-      │
                │   Router —       │ │  agentlab.eth    │ │  Compute   │ │   gated; key    │
                │   stretch)       │ │  └─ tradewise    │ │  (TeeML —  │ │   provisioned)  │
                │                 │ │      .agentlab   │ │   stretch) │ │                 │
                │                 │ │      .eth        │ │            │ │                 │
                │                 │ │  └─ ENSIP-25     │ │            │ │                 │
                │                 │ │     text record  │ │            │ │                 │
                │                 │ │     points at    │ │            │ │                 │
                │                 │ │     IdentityReg  │ │            │ │                 │
                │                 │ │     entry #1     │ │            │ │                 │
                └─────────────────┘ └──────────────────┘ └────────────┘ └─────────────────┘

                                   ┌──────────────────────┐
                                   │  Uniswap Trading API │
                                   │  (mainnet read-only  │
                                   │   for /quote)        │
                                   └──────────────────────┘
                                              ▲
                                              │ HTTPS (read)
                                              │
                       agent server quotes via mainnet, settles via Base Sepolia
```

## The paid-job lifecycle (one tick)

```
client-tick cron (every 2-5 min, per id)
    │
    │ 1. picks intent, signs EIP-3009 USDC auth via @x402/fetch
    ▼
POST /api/a2a/jobs   (server)
    │
    │ 2. @x402/next verifies signature, calls facilitator,
    │    facilitator submits transferWithAuthorization on Base Sepolia
    │ 3. handler quotes via Uniswap mainnet Trading API
    │ 4. waitUntil(pushJob)            → Upstash Redis
    │ 5. waitUntil(appendJobLog)       → 0G Storage (Merkle root computed)
    ▼
client-tick continues
    │
    │ 6. ReputationRegistry.giveFeedback() from CLIENT_n on Sepolia
    ▼
DONE   (response to cron with paymentTx + feedbackTx + jobId)


validator-tick cron (every 10 min)
    │
    │ a. reads Redis last 20 jobs
    │ b. picks first un-validated jobId
    │ c. ValidationRegistry.requestValidation()  (validator EOA)
    │ d. waits for receipt
    │ e. ValidationRegistry.postResponse(score, …)
    ▼
DONE
```

## Wallet roles

| role        | EOA                                       | network                | purpose                                |
|-------------|-------------------------------------------|------------------------|----------------------------------------|
| agent       | `0x7a83…20A3`                            | Sepolia + Base + 0G    | x402 receive, registry deploys, ENS    |
| client1/2/3 | `0xBDEA…5fe8` / `0x2842…D93A` / `0x240E…Cf88` | Base + Sepolia    | x402 pay, post feedback                |
| validator   | `0x0134…83F6`                            | Sepolia                | post validation responses              |

## Deployed contracts (Sepolia)

| contract             | address                                        |
|----------------------|------------------------------------------------|
| IdentityRegistry     | `0x6aF06f682A7Ba7Db32587FDedF51B9190EF738fA`  |
| ReputationRegistry   | `0x477D6FeFCE87B627a7B2215ee62a4E21fc102BbA`  |
| ValidationRegistry   | `0x5dD006711262904653d05a611deD7A2015C0f27A`  |
| (registered) agentId | `1`                                            |

## ENS (Sepolia)

| name                       | resolver record       | value                                                                                          |
|----------------------------|-----------------------|------------------------------------------------------------------------------------------------|
| `tradewise.agentlab.eth`   | `addr()`              | `0x7a83678e330a0C565e6272498FFDF421621820A3`                                                  |
| `tradewise.agentlab.eth`   | `agent-registration[eip155:11155111:0x6aF06f…E738fA][1]` | `"1"` (ENSIP-25 binding)                          |
| `tradewise.agentlab.eth`   | `text("agent-card")`  | `https://hackagent-nine.vercel.app/.well-known/agent-card.json`                                |
```
