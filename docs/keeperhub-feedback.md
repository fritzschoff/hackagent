# KeeperHub — bugs, friction, and asks

Consolidated feedback from building tradewise.agentlab.eth on KeeperHub.
Four workflows shipped (heartbeat, reputation-cache, compliance-attest,
swap-mirror), every one of them hit at least one of the issues below.

> Companion to `docs/dx-notes.md` (cross sponsor DX notes). This file is
> KeeperHub specific.

---

## 1. Workflow editor UX

### 1.1 Naming workflows is not obvious
There is no clear "name" field at the top of the editor when you create
a new workflow. You end up with auto generated names that all look
identical in the workflow list. Once we had four workflows it was hard
to tell them apart at a glance. The workflow id itself is also buried —
you have to dig through the URL or the JSON.

**Asks:**
- Editable title at the top of the workflow editor
- Show the name in the list view (not just the id)
- One click copy button next to the workflow id

### 1.2 You cannot type into the manual ABI text area
Pasting a full ABI works, but typing or editing inline is impossible
because the editor auto saves on every keystroke and the input loses
focus mid word, so you get cut off after one or two characters and have
to click back into the field again. We ended up doing all ABI edits in
a separate text editor and pasting the whole thing in one shot.

**Ask:** debounce the auto save (500ms is plenty) instead of firing on
every keystroke, so the field stays focused while the user types.

### 1.3 Bad input silently disappears
When something is malformed in a node input (we hit it on the args
field of a web3 read node, but it may be more general), the value just
vanishes from the field with no error toast and no inline validation
message. The only signal is in the browser devtools:

```
0uriybgyo-qmg.js:2 Uncaught TypeError: g.match is not a function
```

So you fill the field, click away, the field is empty, and unless you
happen to have devtools open you have no idea why.

**Asks:**
- Catch the type error and surface it as an inline validation message
  under the field
- Keep the user input in the field (do not clear it) so they can fix
  the typo instead of retyping from scratch

### 1.4 Two `enabled` flags per workflow, only one is visible
Our workflow was `enabled: true` at the workflow level and the
`execute_workflow` call came back `success` with `completedSteps: 1` —
but only the trigger node ran. The action node was silently skipped.
Pulling `get_execution_logs` revealed an additional `enabled: false`
field on the action node itself (`nodes[1].data.enabled`). Flipping
that via PATCH made the action fire and the on-chain transfer landed.

**Asks:**
- Surface the action-node `enabled` flag in the dashboard, or remove
  it as a separate flag if it's redundant with workflow-level enable
- When `execute_workflow` finishes with action nodes skipped, return
  `status: "partial"` (or include a warning array), not
  `status: "success"`

### 1.5 `workflowType` doesn't auto-flip when the workflow contains a write
Our workflow has a `web3/transfer-token` action (clearly a write), but
`workflowType` stays `"read"` until manually changed. We could not find
the toggle in the UI. PATCHing `workflowType: "write"` returned 200 but
the field did not update. Computed-from-actions seems more correct
here.

---

## 2. Templating / variable references

### 2.1 No documentation of the actual template syntax in the UI
We initially tried `{{$trigger.input.ts}}` based on conventions from
other workflow tools (n8n, Temporal, Make, etc.). KeeperHub uses
`{{@<nodeId>:<Label>.<field>}}` exclusively. The hint is buried in
`tools_documentation` (MCP) but not surfaced in the workflow editor at
all. Our heartbeat workflow ran for two iterations with the literal
string `{{$trigger.input.ts}}` being written to the ENS text record
on chain before we figured this out.

**Asks:**
- Inline template hints in the field UI ("use `{{@nodeId:Label.field}}`")
- A live "template helper" that lets you click a previous node's
  output and inserts the right reference

### 2.2 Failed template substitution silently emits the literal string
When a template fails to resolve, KeeperHub does not error. It sends
the literal string with `{{...}}` braces to the destination — to the
contract calldata for web3 writes, to the body for webhooks. The
on-chain transaction landed with `value = "{{$trigger.input.ts}}"`
written into a public ENS text record. That is a public, permanent
mistake the user has no way to know happened.

**Asks:**
- Pre-execution dry run that flags unresolved templates
- Or at minimum: fail the step with a clear "template not resolved"
  error instead of falling through with the literal text

### 2.3 Bracket notation is not allowed on action outputs
For a tuple-returning view function (`getManifest(uint256) returns
(address, bytes32, string, ...)`), the natural reference is
`$step2[1]` (second return value). KeeperHub rejects this with:

```
Failed to evaluate condition expression: Condition expression
validation failed: Bracket notation is only allowed on workflow
variables. Found: "step2[...]". Original: "$step2[1] === ..."
```

Workaround: the read output IS keyed by ABI output names if you have
named outputs in the ABI (`outputs: [{ name: "manifestRoot", ... }]`).
But this is undocumented in the UI; we only discovered it by reading
the raw execution logs. And even then, **you cannot use the named field
in a Conditional node** — only in webhook payloads and in functionArgs
templates of downstream actions. The conditional expression validator
seems to have a different, more restrictive grammar.

**Asks:**
- Allow `{{@nodeId:Label.fieldName}}` references inside Conditional
  expressions, the same way they work in webhook payloads
- Or, allow `result[N]` bracket access on action outputs

### 2.4 The Run-Code transform node silently exits on bad expressions
Our reputation-cache workflow had a Run-Code transform between two
reads. With a slightly malformed expression (one wrong template
reference), the transform did not error — it just stopped the entire
workflow without logging anything for the transform step.
`completedSteps` showed 2 (trigger + read), trace showed only those
two nodes, status was `success`. The five remaining nodes were never
attempted and never logged.

**Asks:**
- A failed transform should set `status: "error"` with the specific
  expression evaluation error
- Or at minimum log the transform step as `status: "failed"` so it
  shows up in `get_execution_logs`

### 2.5 Tuple-returning view functions are accessible by ABI output name, but only undocumented
For a function like `getManifest(uint256) returns (address agent, bytes32 manifestRoot, string manifestUri, ...)`, the read output looks like:

```json
{
  "result": {
    "agent": "0xBf5df...",
    "manifestRoot": "0x6b67...",
    "manifestUri": "og://...",
    "bond": "0",
    ...
  },
  "success": true,
  "addressLink": "..."
}
```

So `{{@web3-read:Web3 Read.result.manifestRoot}}` works in webhook
payloads and in functionArgs templates. We only discovered this by
dumping `get_execution_logs` and reading the raw output blob. The
workflow editor never tells you that named ABI outputs become object
keys.

**Asks:**
- Document this in the manual ABI text area help text
- Show the named output schema next to the read node after it runs
  once, so the user knows what fields are addressable

### 2.6 Inline template substitution inside functionArgs strings works, but is undocumented
Setting `functionArgs: ["0x6d81…", "reputation-summary", "feedback={{@read-web3-1:Web3 Read - ReputationRegistry.result}} ts={{@trigger-cron:Cron Trigger.data.ts}}"]` correctly substitutes both templates inline, producing `"feedback=263 ts=1777321952625"` in the calldata. This is a great feature — it lets you avoid a separate transform node entirely. But it is not documented anywhere we could find.

**Ask:** document inline template substitution as a first-class
feature. It is the cleanest way to compose strings without a Run-Code
transform.

### 2.7 `workflowRunId` template returns empty string
Our webhook payload included `workflowRunId: "{{@__run.id}}"` (and
several variants — `{{$run.id}}`, `{{$execution.id}}`,
`{{$workflow.runId}}`). All of them produce an empty string. We had to
fall back to synthesizing a run id on the receiver side.

**Ask:** document and stabilize the run id template variable so
webhooks can correlate back to a KeeperHub run.

---

## 3. Wallet integration

### 3.1 Turnkey wallet sends invalid EIP-1559 transactions
Our swap-mirror workflow consistently fails with:

```
priorityFee cannot be more than maxFee
maxFeePerGas: 56368058 (~56 gwei)
maxPriorityFeePerGas: 100000000 (100 gwei)
```

The Turnkey-managed wallet is generating EIP-1559 transactions with a
priority fee higher than the max fee — a structural protocol violation
that the Sepolia node correctly refuses. This happens on every run, so
it is not network jitter. We never get an on-chain attempt; the call
fails at the gas estimation stage.

**Ask:** clamp `maxPriorityFeePerGas <= maxFeePerGas` in the wallet
signing code. Or use a sane default like
`maxPriorityFeePerGas = min(2 gwei, maxFeePerGas)`.

### 3.2 Turnkey wallet has no faucet onramp
The wallet is created automatically when you "+ Add Web3 Connection",
but there is no clear next step pointing the user at a faucet. We had
the wallet, the workflow, and the contract permissions all wired up,
but nothing fired because the wallet had 0 Sepolia ETH and we did not
realize until tx simulation failed with `insufficient funds for gas`.

**Asks:**
- Show the wallet's native balance in the integration card
- Add a "Top up" button per chain that links to the canonical faucet
  (Circle USDC, Sepolia ETH from Alchemy / sepoliafaucet.com)

### 3.3 Wallet integration name is not used in the workflow editor
Our wallet integration was named `test`. In the workflow editor's
signer dropdown for web3 write nodes, the value showed as the
integration's id (`i2ywfgrbbmtpr0hf1xh80`), not the name. When we have
multiple wallet integrations across different chains, this becomes
unreadable.

**Ask:** show `<name> · <walletAddress>` in the signer dropdown.

---

## 4. Runtime / API

### 4.1 The runtime API is MCP-only
Every REST guess we tried — `POST /api/workflows/:id/run`, `…/runs`,
`…/execute`, `…/trigger`, `…/invoke`, `/api/v1/…` — returns either 404
(HTML page) or 405 (Method Not Allowed). The only way to actually
trigger a workflow is via the MCP endpoint at
`https://app.keeperhub.com/mcp` using the `execute_workflow` JSON-RPC
tool.

This is fine for agent integrations (we are plugged into MCP anyway),
but it surprised us — every other workflow-as-a-service product has a
`POST .../runs` endpoint, and the docs we hit did not call out that
REST is missing.

**Ask:** either add a thin REST wrapper around `execute_workflow`, or
surface "use MCP for runtime" prominently in the API docs.

### 4.2 No public block explorer for workflow runs
We log a `workflowRunId` and an `executionId`, then have to poll
`get_execution_logs` to find the action node's `transactionHash`. An
`https://app.keeperhub.com/runs/<id>` page that shows the underlying
tx hash + the trigger payload + the action payload (similar to a
GitHub Actions run page) would make KeeperHub feel like infrastructure
rather than a black box.

### 4.3 Workflow-as-x402-resource is a missing primitive
The agentic wallet *consumes* x402-priced workflows. The inverse —
your workflow charging external agents x402 USDC for execution — is
the obvious next step and would close the loop with the rest of the
agent economy. We would build this if it shipped.

---

## 5. Onboarding / faucets

### 5.1 Account creation is the bottleneck for hackathon teams
Every other sponsor in this hackathon let us start writing code in
five minutes with public docs + faucets + RPCs. KeeperHub requires
sign up, email verify, dashboard click through to mint a workflow,
then an API key, then the per-node enable footgun above. At the
~8 hour into the hackathon mark, that flow is a tax that actively
pushes teams to defer KeeperHub integration.

**Ask:** a "test mode" API key generated from `kh auth login` (or
even just from the signup email confirmation) plus a starter workflow
template would unblock anyone trying to ship in 48 hours.

---

## 6. What worked

Not everything is broken — a fair amount of this works very well.

- **The MCP-first surface** is genuinely refreshing. Once we found it,
  `initialize` → `tools/list` → `tools/call execute_workflow` gave us
  a working integration in under an hour. Putting agent builders ahead
  of human dashboard users is the right call for this product.
- **The agentic wallet's three-tier `PreToolUse` hook**
  (`auto / ask / block`) is the kind of safety primitive that has been
  missing in every "agent has a wallet" demo we have seen. Server-side
  hard limits (USDC caps, chain + contract allowlists) are exactly the
  shape of guardrail you would want before an autonomous agent has its
  own purse.
- **The Turnkey-managed wallet flow inside the workflow editor**
  ("+ Add Web3 connection" → spins up a fresh sub org wallet) is great
  UX. We funded it with a single tx and the workflow was ready to run
  (modulo the EIP-1559 bug above).
- **`update_workflow` over MCP** is the killer feature. Once we knew
  the right template syntax, we could fix all four of our workflows
  programmatically (`scripts/patch-keeperhub-workflows.ts`) instead of
  clicking through the UI. That alone makes KeeperHub feel like real
  infrastructure.

---

## 7. Score

- MCP integration: **9/10** — fast, well shaped, the right product
  surface for agent builders.
- Workflow editor UX: **5/10** — the UI bugs (auto save, vanishing
  inputs, naming) are the biggest friction.
- Templating / variable system: **4/10** — undocumented in the UI,
  silent failures, restrictive validator that diverges from the rest
  of the platform.
- Turnkey wallet: **6/10** — great UX, blocked by the EIP-1559 gas
  pricing bug and the missing faucet onramp.
- Documentation: **6/10** — `tools_documentation` via MCP is good,
  but the product docs assume you already know the conventions.

Looking forward to the next iteration. Happy to pair on any of the
above.
