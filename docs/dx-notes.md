# DX notes — KeeperHub, ENS, 0G, x402, Vercel

Bonus DX notes from the same build that produced
[`FEEDBACK.md`](../FEEDBACK.md). Not required by any single prize gate;
collected here as concrete signal for whichever team finds them useful.

> Uniswap-specific DX notes are in `FEEDBACK.md` (the prize-eligibility
> file).

---

## KeeperHub (main + $500 feedback bounty)

### What worked
- **The MCP-first surface** is genuinely refreshing. Once we found it,
  `initialize` → `tools/list` → `tools/call execute_workflow` gave us a
  working integration in under an hour. Putting agent-builders ahead of
  human dashboard users is the right call for this product.
- The **agentic wallet's three-tier `PreToolUse` hook**
  (`auto / ask / block`) is the kind of safety primitive that's been
  missing in every "agent has a wallet" demo we've seen. Server-side
  hard limits (100/200 USDC, chain + contract allowlists) are exactly
  the shape of guardrail you'd want before an autonomous agent has its
  own purse.
- **The Turnkey-managed wallet flow inside the workflow editor**
  ("+ Add Web3 connection" → spins up a fresh sub-org wallet) is great
  UX. We funded it with a single tx and the workflow ran.

### What didn't work / what we wish existed

- **The runtime API is MCP-only.** Every REST guess we tried —
  `POST /api/workflows/:id/run`, `…/runs`, `…/execute`, `…/trigger`,
  `…/invoke`, `/api/v1/…` — returns either 404 (HTML page) or 405
  (Method Not Allowed). The only way to actually trigger a workflow is
  via the MCP endpoint at `https://app.keeperhub.com/mcp` using the
  `execute_workflow` JSON-RPC tool.

  This is fine *for agent integrations* (we're plugged into MCP
  anyway), but it surprised us — every other workflow-as-a-service
  product has a `POST .../runs` endpoint, and the docs we hit didn't
  call out that REST is missing. **Ask:** either add a thin REST
  wrapper around `execute_workflow`, or surface "use MCP for runtime"
  prominently in the API docs.

- **Two `enabled` flags per workflow, only one is visible in the UI.**
  Our workflow was `enabled: true` at the workflow level and the
  `execute_workflow` call came back `success` with `completedSteps: 1` —
  but only the trigger node ran. The action node was silently skipped.
  Pulling `get_execution_logs`, the workflow JSON revealed an
  *additional* `enabled: false` field on the action node itself
  (`nodes[1].data.enabled`). Flipping that via PATCH made the action
  fire and the on-chain transfer landed.

  This is a footgun. The dashboard exposes an "enable" toggle for the
  workflow, but the per-node enable flag is set somewhere we couldn't
  see (or defaults to `false`?). The execution result `success` with
  the action skipped *should be* an explicit warning ("action node was
  disabled, transaction not sent"), not a silent pass.

  Concrete asks:
  1. Surface the action-node `enabled` flag in the dashboard, or remove
     it as a separate flag if it's redundant with workflow-level
     enable.
  2. When `execute_workflow` finishes with action nodes skipped, return
     `status: "partial"` (or include a warning array), not
     `status: "success"`.

- **`workflowType: "read"` doesn't auto-flip when the workflow contains
  a write action.** Our workflow has a `web3/transfer-token` action
  (clearly a write), but `workflowType` stays `"read"` until manually
  changed. We couldn't find the toggle in the UI. PATCH'ing
  `workflowType: "write"` returned 200 but the field didn't update.
  Computed-from-actions seems more correct here.

- **Account creation is the bottleneck for hackathon teams.** Every
  other sponsor in this hackathon let us start writing code in five
  minutes with public docs + faucets + RPCs. KeeperHub requires
  sign-up, email verify, dashboard click-through to mint a workflow,
  then an API key, then the per-node enable footgun above. At the
  ~8-hour-into-the-hackathon mark, that flow is a tax that actively
  pushes teams to defer KeeperHub integration. **Ask:** a "test mode"
  API key generated from `kh auth login` (or even just from the
  signup email confirmation) plus a starter workflow template would
  unblock anyone trying to ship in 48 hours.

- **No public block explorer on workflow runs.** We log a
  `workflowRunId` and an `executionId`, then poll
  `get_execution_logs` to find the action node's `transactionHash`.
  An `https://app.keeperhub.com/runs/<id>` page that shows the
  underlying tx hash + the trigger payload + the action payload
  (similar to a GitHub Actions run page) would make KeeperHub feel
  like infrastructure rather than a black box.

- **Workflow-as-x402-resource is a missing primitive.** The agentic
  wallet *consumes* x402-priced workflows. The inverse — your
  workflow charging external agents x402 USDC for execution — is the
  obvious next step and would close the loop with the rest of the
  agent economy. We'd build this if it shipped.

- **Naming workflows is not obvious.** When you create a new workflow
  there is no clear "name" field at the top of the editor, so you end
  up with auto generated names that all look identical in the
  workflow list. Once we had four workflows (heartbeat, reputation
  cache, compliance attest, swap mirror) it got hard to tell them
  apart at a glance. The workflow id you need to copy into the client
  app is also buried — you have to dig through the URL or the JSON.
  Concrete asks: (1) editable title at the top of the workflow
  editor, (2) show the name in the list view (not just the id),
  (3) one click copy button next to the workflow id.

- **You cannot type into the manual ABI text area.** Pasting a full
  ABI works, but typing or editing inline is impossible because the
  editor auto saves on every keystroke and the input loses focus mid
  word, so you get cut off after one or two characters and have to
  click back into the field again. We ended up doing all ABI edits in
  a separate text editor and pasting the whole thing in one shot.
  Concrete ask: debounce the auto save (500ms is plenty) instead of
  firing on every keystroke, so the field stays focused while the
  user types.

### Score
**6/10 for hackathon use, 9/10 for production.** The product is
genuinely strong — what hurts the score is two-and-a-half hours lost
to the "MCP only, two enable flags" puzzle. Once you know it, it's
delightful. The MCP surface plus agentic wallet is the right
architecture; the on-ramp friction is the only thing between this and
ubiquity.

---

## ENS

### What worked
- **`viem`'s ENS support** is excellent. `namehash` / `labelhash` /
  `getEnsAddress` / `getEnsResolver` / `setText` etc. all just work,
  and the type-level integration is a joy compared to going
  contract-by-contract.
- **Sepolia ENS is a real deployment** with the same contract
  addresses, not a half-implemented stub. We registered `agentlab.eth`,
  minted `tradewise.agentlab.eth`, and set five text records (including
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
  abstraction. It computes Merkle roots locally and selects shard
  nodes before submitting on-chain — exactly what you'd design from
  scratch.

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

  Then calls `Flow.submit(submission)` on
  `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296` and it reverts. We
  confirmed:
  - The Flow contract is a tiny proxy (~296 bytes of bytecode), so
    the implementation behind it has been upgraded since SDK 0.3.3
    was published.
  - Standard indexer (`indexer-storage-testnet-standard.0g.ai`)
    returns 503 — appears to be down.
  - The same code reverts identically from a local Node script and
    from Vercel Fluid Compute, so it's not an environment issue.

  **Ask:** publish `0.3.4+` of the TS SDK with whatever calldata
  change the new Flow proxy needs. We've shipped our integration
  with graceful degradation: every job already produces a
  deterministic 0G-format Merkle root in the function logs, and the
  on-chain anchor will start working transparently the moment the
  SDK ships a fix. Zero app code changes required.

- **`Indexer.upload` returns `[res, err]` where `res.rootHash` is set
  even when `err` is non-null.** Non-obvious from the type signature
  but actually a useful behavior — we use it to keep the Merkle root
  as a content-address even when on-chain submit fails. Worth
  documenting.

- **The "Turbo vs Standard" naming is misleading.** From a hackathon
  builder's perspective, "Turbo" sounds like an upgrade ($) and
  "Standard" sounds like the default — but Turbo is documented as
  recommended and Standard (during our session) returned 503.
  Renaming to `default` and `low-cost` (or whatever the actual
  product positioning is) would prevent newcomers from picking the
  wrong one.

### What we didn't get to (pure time)
- **0G Compute (TeeML / TeeTLS).** Worth a separate spike. The
  agent design assumes the OpenAI-compatible endpoint via
  `@0glabs/0g-serving-broker` is plug-and-play; if that's true we
  could light it up post-submission. The TEE attestation header
  pattern (`ZG-Res-Key` → `broker.inference.processResponse`) is
  the right design.

### Score
- 0G architecture: **9/10**. This is the most complete vision in the
  hackathon — TEE-verified inference + verifiable storage +
  transferable intelligence (INFTs) is the agent-economy stack we'd
  actually build on.
- 0G testnet stability today: **5/10**. Storage SDK ↔ contract drift
  is a hard blocker; one published SDK update would put this at
  9/10.

---

## x402 (cross-cutting, used in production)

### What worked
- **`@x402/next` middleware is a one-liner integration.** Wrapping
  our Route Handler in `withX402(handler, { accepts, …, server })`
  was the shortest sponsor integration in the entire build.
- **The hosted facilitator at `facilitator.x402.rs`** worked first
  try and continued to work for every settlement. We pay zero gas
  on Base Sepolia for the actual USDC transfer; the facilitator
  does it.
- **EIP-3009 `transferWithAuthorization`** is the right primitive.
  The client signs an off-chain authorization, the facilitator
  submits on chain, USDC moves. Zero ETH balance required on the
  client side. This is what makes agent-to-agent payments viable.

### What didn't work
- **`x402.org` had an NXDOMAIN at one point during our build** and
  we had to switch the facilitator URL to `x402.rs`. That's fine in
  hindsight but the docs still reference the .org domain in places.
  Worth a sweep.
- **The 402 challenge body shape isn't versioned in the response.**
  We built our client-side payment loop against the current shape;
  if it changes we'll silently break. A `version` field in the
  `accepts` body would let agents pin behavior.

---

## Vercel

### Things that surprised us positively
- **Vercel Cron Jobs replacing every `node --watch` / `pm2`** is the
  single biggest infrastructure simplification we made. The whole
  agent loop is `*/2 * * * *` on a Route Handler. No babysitting,
  no VPS, no systemd.
- **`waitUntil` from `@vercel/functions`** for "respond fast,
  persist in the background" is the exact primitive an agent server
  needs. Posting on-chain feedback (~12s Sepolia tx) and a
  KeeperHub workflow run (~5s settle) without blocking the x402
  response was a one-line refactor each.
- **Edge Config for "what's the contract address right now"** is a
  perfect fit. Update once via the dashboard or CLI, every Function
  worldwide reads it from local replicas. We deploy contracts →
  push to Edge Config → no redeploy needed.

### Things that surprised us negatively
- **Vercel Edge Config rejects keys with `.` in them**
  (`"addresses.sepolia"` fails with "Key may contain alphanumeric
  letters, `_` and `-` only"). We hit this twice (once for
  `addresses.sepolia`, once for `keeperhub.workflow.swap`). The
  error message is good but the constraint isn't surfaced in the
  docs we read.
- **`vercel env add <name> <env1> <env2> <env3>`** is rejected as
  "Invalid number of arguments" — only one env target per call. We
  wasted 10 minutes thinking the syntax was right.
