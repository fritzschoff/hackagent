# FEEDBACK

Real DX notes from building **tradewise.agentlab.eth** — an autonomous on-chain
agent that earns x402 USDC for Uniswap quotes and accumulates ERC-8004
reputation. One coherent submission targeting four sponsors. All feedback below
is from actually shipping code, not speculation.

---

## Uniswap (hard eligibility gate — Trading API + UniswapX)

### What worked
- **Trading API for read-only quoting on mainnet** is excellent. Latency is
  sub-second, the response is fully formed, and we can drive realistic agent
  behavior without ever touching mainnet liquidity.
- The **`uniswap/uniswap-ai` skill** install (`npx skills add uniswap/uniswap-ai`)
  is the right shape. It hits the agent-developer audience exactly where they
  live — inside Cursor / Claude Code — instead of asking us to learn yet
  another SDK.
- **Permit2 + Universal Router** as the default path is the right call. We
  built around the assumption that Permit2 is canonical and that paid the off
  immediately when we wired x402 settlements (EIP-3009 on USDC) into the same
  flow.

### What didn't work / what we wish existed
- **The Trading API is mainnet-only at the moment.** This is the single
  biggest friction for any team trying to build a *demoable* agent on
  Base/Sepolia. We worked around it by: (a) calling the mainnet Trading API
  for quotes (read-only, harmless), and (b) accepting that the actual
  `/swap` execution would have to go through Universal Router on Base
  Sepolia ourselves. That's two different code paths for what should be one.
  **Ask:** even an unguaranteed, no-SLA testnet endpoint at
  `trade-api-testnet.gateway.uniswap.org` would unblock 90% of hackathon
  swap-execution work.
- **`/quote` doesn't expose route stability under repeated calls.** We saw
  the same intent return slightly different `amountOut` between calls 30s
  apart, which is fine for humans but a source of "did the agent
  hallucinate?" anxiety for autonomous quoting. A `quoteId` you can pin for
  N seconds — like Coinbase's quote refs — would let us produce signed
  immutable quotes per agent job.
- **UniswapX minimum sizes (300 USDC mainnet, 1000 USDC L2) wreck
  hackathon demos.** Any swap below the minimum returns "no quotes
  available" and looks broken. We'd love an explicit error code (e.g.
  `MIN_NOTIONAL_NOT_MET`) plus a hint at the threshold so apps can show
  the right UX instead of "something went wrong".
- **Filler bot onboarding has no on-ramp.** The prize brief mentions
  "become a filler" as a credible angle, but the actual subscription to
  the order feed + the inventory model + the keeper integration aren't
  documented in one place. A `uniswap-x-filler-quickstart` skill would be
  the highest-leverage thing the foundation could ship for next year's
  hackathons.
- **Trading API errors come back as 400 with HTML bodies sometimes.** We
  caught a couple where the body was a Cloudflare challenge page instead
  of JSON, which broke our error-handling assumptions. Standardising on
  `application/json` for every non-200 (even rate-limit / WAF) would make
  agent code much more reliable.

### Concrete things we'd file as bug reports
- `route: "uniswap_api_400"` showed up in our internal job log when the
  API returned 400; we pass the route string through to the dashboard,
  and an opaque `_400` made it into our public agent metadata. The error
  case shouldn't masquerade as a route name.
- The minimum-size error message string was inconsistent between mainnet
  and L2 calls.

### Score
Trading API: **8/10** for read-only quoting, **5/10** for swap execution
on testnet (entirely because of the mainnet-only constraint, not the API
itself). With a testnet endpoint or a documented "use these contracts on
Base Sepolia and call them this way" pattern, this is a 9/10.

---

## KeeperHub (main + feedback bounty)

### What worked
- **The MCP-first surface** is genuinely refreshing. `claude mcp add` →
  `search_workflows` → `call_workflow` from inside an agent's loop is the
  right shape for this product, and it puts agent-builders ahead of human
  dashboard users on day one.
- The **agentic wallet's three-tier `PreToolUse` hook** (`auto / ask / block`)
  is the kind of safety primitive that's been missing in every "agent has
  a wallet" demo we've seen. Server-side hard limits (100/200 USDC, chain
  + contract allowlists) are exactly the shape of guardrail you'd want
  before an autonomous agent has its own purse.

### What didn't work / what we wish existed
- **Account creation is the bottleneck for hackathon teams.** Every other
  sponsor in this hackathon let us start writing code in five minutes
  with public docs + faucets + RPCs. KeeperHub requires sign-up, email
  verify, dashboard click-through to mint a workflow, then an API key.
  At the ~6-hour-into-the-hackathon mark, that flow is a tax that
  actively pushes teams to defer KeeperHub integration. **Ask:** a
  "test mode" API key generated automatically from `kh auth login` with
  hard testnet-only sandboxing would unblock anyone trying to ship in
  48 hours.
- **The deprecation of local `kh` MCP in favor of the hosted endpoint**
  is fine, but we hit it as a "wait, this used to work, why is the docs
  page now half stale?" moment. Making the deprecation banner louder
  (and pointing directly at the new HTTP transport command) would have
  saved us 20 minutes.
- **Workflow-as-x402-resource is a missing primitive.** Right now the
  agentic wallet *consumes* x402-priced workflows. The inverse — your
  workflow charging external agents x402 USDC for execution — is the
  obvious next step and would close the loop with the rest of the
  agent economy. We'd build this if it shipped.
- **No public block explorer on workflow runs.** We log a `workflowRunId`
  internally and have to trust that the real on-chain action happened.
  A `https://app.keeperhub.com/runs/<id>` page that shows the underlying
  tx hash + the trigger payload + the action payload would make
  KeeperHub feel like infrastructure rather than a black box.

### Score
**6/10 for hackathon use, 9/10 for production.** The product is genuinely
strong — what hurts the score is that we couldn't fully integrate in 48h.
The MCP surface plus agentic wallet is the right architecture; the
on-ramp friction is the only thing between this and ubiquity.

---

## ENS

### What worked
- **`viem`'s ENS support** is excellent. `namehash` / `labelhash` /
  `getEnsAddress` / `getEnsResolver` / `setText` etc. all just work, and
  the type-level integration is a joy compared to going contract-by-contract.
- **Sepolia ENS is a real deployment** with the same contract addresses,
  not a half-implemented stub. We registered `agentlab.eth`, minted
  `tradewise.agentlab.eth`, and set five text records (including
  ENSIP-25) end-to-end programmatically in one script.
- **ENSIP-25 as a text-record-only convention** is a beautiful piece of
  protocol design. No new contracts, no resolver upgrades — and it
  gives you "this ENS name → this ERC-8004 entry" with cryptographic
  attribution. Every agent should have one.

### What didn't work
- **The ETHRegistrarController on Sepolia (`0xfb3c…f968`) uses a newer
  `Registration` struct** (8 fields incl. `uint8 reverseRecord` and
  `bytes32 referrer`) that no docs page we found documents in this
  shape. The older 8-arg flat-param form is what every guide on the
  internet shows. We had to fetch the ABI from Sepolia Etherscan to
  decode the `makeCommitment` reverts. **Ask:** update the
  "Register a name programmatically" docs to show the current struct.
- **NameWrapper is a footgun for subnames** when the parent isn't
  wrapped. Our parent was registered without going through the wrap
  flow (because `data: []` and `reverseRecord: 0` skipped it), and
  `NameWrapper.setSubnodeRecord` reverted with the obscure
  `Unauthorised(node, addr)` error. The fix was using
  `Registry.setSubnodeRecord` directly. The docs imply NameWrapper is
  the canonical path, but for hackathon-style "register, then create
  subnames" flows, plain ENS Registry is easier.
- **Subname creation requires picking the right contract** — Registry
  vs NameWrapper — based on whether the parent is wrapped. There's no
  `ens.createSubname(parentName, label, ...)` helper that handles both
  cases. This is the single biggest place a viem-level helper would
  pay off.
- **CCIP-Read for "agent reputation summary" would be killer.** We
  store our ERC-8004 reputation events on Sepolia; they could be
  exposed as a CCIP-Read text record on the ENS name (e.g.
  `text("reputation-summary")`) so any client resolving the ENS name
  gets the agent's live score for free. We didn't build this in the
  48h window but we wanted to.

### Score
**9/10.** This was the smoothest sponsor stack we touched. The only
deduction is the controller ABI drift — once you know the right struct
shape, everything else is delightful.

---

## 0G Labs (Storage + Compute)

### What worked
- **Galileo testnet faucet was painless.** Got 0.5 OG dripped without
  fuss. Chain ID, RPC, and basic EVM read calls all just work.
- **0G Storage SDK is genuinely well-thought-through architecturally.**
  `Indexer` + `MemData` + `upload(file, rpc, signer)` is the right
  abstraction. It computes Merkle roots locally and selects shard nodes
  before submitting on-chain — exactly what you'd design from scratch.

### What didn't work — and this one is load-bearing
- **The published SDK (`@0glabs/0g-ts-sdk@0.3.3`, latest on npm) is
  out-of-sync with the deployed Galileo Flow contract.** Every
  `Flow.submit(...)` call reverts with `require(false)` at gas
  estimation. The SDK successfully:
  1. Connects to the Turbo indexer.
  2. Selects shard nodes (we saw real connected peers, real
     `logSyncHeight`).
  3. Computes the Merkle root locally — confirmed identical roots
     between Vercel runs and a local node script.
  4. Calculates the storage fee from the market contract.
  Then calls `Flow.submit(submission)` on `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296`
  and it reverts. We confirmed:
  - The Flow contract is a tiny proxy (~296 bytes of bytecode), so the
    implementation behind it has been upgraded since SDK 0.3.3 was
    published.
  - Standard indexer (`indexer-storage-testnet-standard.0g.ai`) returns
    503 — appears to be down.
  - The same code reverts identically from a local Node script and from
    Vercel Fluid Compute, so it's not an environment issue.
  
  **Ask:** publish `0.3.4+` of the TS SDK with whatever calldata change
  the new Flow proxy needs. We've shipped our integration with graceful
  degradation: every job already produces a deterministic 0G-format
  Merkle root in the function logs, and the on-chain anchor will start
  working transparently the moment the SDK ships a fix. Zero app code
  changes required.

- **`Indexer.upload` returns `[res, err]` where `res.rootHash` is set
  even when `err` is non-null.** This is non-obvious from the type
  signature but actually a useful behavior — we use it to keep the
  Merkle root as a content-address even when the on-chain submit fails.
  Worth documenting.

- **The "Turbo vs Standard" naming is misleading.** From a hackathon
  builder's perspective, "Turbo" sounds like an upgrade ($) and
  "Standard" sounds like the default — but Turbo is documented as
  recommended and Standard (during our session) returned 503. Renaming
  to `default` and `low-cost` (or whatever the actual product
  positioning is) would prevent newcomers from picking the wrong one.

### What we didn't get to (pure time)
- **0G Compute (TeeML / TeeTLS).** We ran into the storage SDK drift and
  decided to invest the remaining time in higher-leverage shipping
  (ENS, dashboard, FEEDBACK.md). The agent design assumes the OpenAI-
  compatible endpoint via `@0glabs/0g-serving-broker` is plug-and-play;
  if that's true we could light it up post-submission. The TEE
  attestation header pattern (`ZG-Res-Key` →
  `broker.inference.processResponse`) is the right design.

### Score
- 0G architecture: **9/10**. This is the most complete vision in the
  hackathon — TEE-verified inference + verifiable storage + transferable
  intelligence (INFTs) is the agent-economy stack we'd actually build
  on.
- 0G testnet stability today: **5/10**. Storage SDK ↔ contract drift
  is a hard blocker; one published SDK update would put this at 9/10.

---

## x402 (cross-cutting, used in production)

### What worked
- **`@x402/next` middleware is a one-liner integration.** Wrapping our
  Route Handler in `withX402(handler, { accepts, …, server })` was the
  shortest sponsor integration in the entire build.
- **The hosted facilitator at `facilitator.x402.rs`** worked first try
  and continued to work for every settlement. We pay zero gas on Base
  Sepolia for the actual USDC transfer; the facilitator does it.
- **EIP-3009 `transferWithAuthorization`** is the right primitive. The
  client signs an off-chain authorization, the facilitator submits on
  chain, USDC moves. Zero ETH balance required on the client side.
  This is what makes agent-to-agent payments viable.

### What didn't work
- **`x402.org` had an NXDOMAIN at one point during our build** and we
  had to switch the facilitator URL to `x402.rs`. That's fine in
  hindsight but the docs still reference the .org domain in places.
  Worth a sweep.
- **The 402 challenge body shape isn't versioned in the response.** We
  built our client-side payment loop against the current shape; if it
  changes we'll silently break. A `version` field in the `accepts`
  body would let agents pin behavior.

---

## Cross-cutting / general dev experience

### Things that surprised us positively
- **Vercel Cron Jobs replacing every `node --watch` / `pm2`** is the
  single biggest infrastructure simplification we made. The whole agent
  loop is `*/2 * * * *` on a Route Handler. No babysitting, no VPS, no
  systemd.
- **`waitUntil` from `@vercel/functions`** for "respond fast, persist
  in the background" is the exact primitive an agent server needs.
  Posting on-chain feedback (12s Sepolia tx) without blocking the x402
  response was a one-line refactor.
- **Edge Config for "what's the contract address right now"** is a
  perfect fit. Update once via the dashboard or CLI, every Function
  worldwide reads it from local replicas. We deploy contracts → push
  to Edge Config → no redeploy needed.

### Things that surprised us negatively
- **Vercel Edge Config rejects keys with `.` in them** (`"addresses.sepolia"`
  fails with "Key may contain alphanumeric letters, `_` and `-` only").
  We hit this twice (once for `addresses.sepolia`, once for
  `keeperhub.workflow.swap`). The error message is good but the
  constraint isn't surfaced in the docs we read.
- **`vercel env add <name> <env1> <env2> <env3>`** is rejected as
  "Invalid number of arguments" — only one env target per call. We
  wasted 10 minutes thinking the syntax was right.
- **The Turnkey-backed agentic wallet behind KeeperHub** uses AWS Nitro
  Enclaves. We didn't see this called out anywhere as a concrete
  security claim. "Your private key never leaves the enclave" is a
  selling point worth surfacing.

---

## TL;DR for prize judges

We built **one coherent project** that exercises:

- **x402** (settled real USDC payments from 3 client wallets — visible on
  BaseScan).
- **ENS** (registered `agentlab.eth` and minted
  `tradewise.agentlab.eth` programmatically with a real ENSIP-25 record
  pointing at our ERC-8004 entry).
- **ERC-8004** (deployed our own Identity / Reputation / Validation
  registries on Sepolia, currently 10+ feedback events from 3 distinct
  EOAs and 9+ validation responses, all auto-firing every 2-5 min via
  Vercel Cron).
- **Uniswap Trading API** (live mainnet quotes returned to every paid
  request).
- **0G Storage** (Merkle root computed for every job; on-chain anchor
  awaiting an SDK update — see above).

The 48h-shaped friction we hit was concentrated in three places:
(1) **Trading API testnet** would unblock half the hackathon teams,
(2) **0G SDK ↔ contract drift** is a fixable infrastructure problem,
(3) **KeeperHub account on-ramp** is the single thing slowing
production-grade integration.

Everything else was a delight. Thanks for the excellent stack.
