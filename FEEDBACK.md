# FEEDBACK — Uniswap Trading API + UniswapX

DX notes from building **tradewise.agentlab.eth** — an autonomous on-chain
agent whose paid product is *"reliable Uniswap quotes for other agents,
billed in x402 USDC on Base Sepolia"*. Real notes from shipping code,
not speculation.

> This file is scoped to the Uniswap prize gate. Cross-sponsor notes
> (KeeperHub, ENS, 0G, x402, Vercel) are kept in our internal notes.

---

## What worked

- **Trading API for read-only quoting on mainnet** is excellent. Latency is
  sub-second, the response is fully formed, and we can drive realistic
  agent behavior without ever touching mainnet liquidity. Our agent
  literally calls mainnet `/quote` for every paid request and returns the
  result to clients on Base Sepolia — clean separation between *pricing
  brain* (mainnet, free read) and *settlement* (Base Sepolia, x402).
- The **`uniswap/uniswap-ai` skill** install
  (`npx skills add uniswap/uniswap-ai`) is the right shape for this
  audience. It hits agent-developers exactly where they live — inside
  Cursor / Claude Code — instead of asking us to learn yet another SDK.
- **Permit2 + Universal Router** as the default path is the right call.
  We built around Permit2 being canonical and that paid off immediately
  when we wired x402 settlements (USDC's EIP-3009
  `transferWithAuthorization`) into the same flow — they slot together
  conceptually because both are signature-based authorizations.

## What didn't work / what we wish existed

- **The Trading API is mainnet-only at the moment.** This is the single
  biggest friction for any team trying to build a *demoable* agent on
  Base/Sepolia. We worked around it by:
  - calling the mainnet Trading API for quotes (read-only, harmless), and
  - mapping Base Sepolia tokens to mainnet equivalents *inside our own
    code* (see `lib/uniswap.ts` `BASE_SEPOLIA_TO_MAINNET`).
  - accepting that the actual `/swap` execution would have to go through
    Universal Router on Base Sepolia ourselves.

  That's two different code paths for what should be one. **Ask:** even
  an unguaranteed, no-SLA testnet endpoint at
  `trade-api-testnet.gateway.uniswap.org` would unblock 90% of hackathon
  swap-execution work.

- **`/quote` doesn't expose route stability under repeated calls.** We
  saw the same intent return slightly different `amountOut` between
  calls 30s apart, which is fine for humans but a source of "did the
  agent hallucinate?" anxiety for autonomous quoting. A `quoteId` you
  can pin for N seconds — like Coinbase's quote refs — would let us
  produce signed immutable quotes per agent job.

- **UniswapX minimum sizes (300 USDC mainnet, 1000 USDC L2) wreck
  hackathon demos.** Any swap below the minimum returns "no quotes
  available" and looks broken. We'd love an explicit error code (e.g.
  `MIN_NOTIONAL_NOT_MET`) plus a hint at the threshold so apps can
  show the right UX instead of "something went wrong".

- **Filler bot onboarding has no on-ramp.** The prize brief mentions
  "become a filler" as a credible angle, but the actual subscription
  to the order feed + the inventory model + the keeper integration
  aren't documented in one place. A `uniswap-x-filler-quickstart`
  skill would be the highest-leverage thing the foundation could
  ship for next year's hackathons.

- **Trading API errors come back as 400 with HTML bodies sometimes.**
  We caught a couple where the body was a Cloudflare challenge page
  instead of JSON, which broke our error-handling assumptions.
  Standardising on `application/json` for every non-200 (even
  rate-limit / WAF) would make agent code much more reliable.

## Concrete things we'd file as bug reports

- `route: "uniswap_api_400"` showed up in our internal job log when the
  API returned 400; we pass the route string through to the dashboard,
  and an opaque `_400` made it into our public agent metadata. The error
  case shouldn't masquerade as a route name (we caught this on our side,
  but the API shape leaves it ambiguous).
- The minimum-size error message string was inconsistent between
  mainnet and L2 calls.

## Why this still isn't a swap-execution submission

We *quote* via Uniswap on every paid request and return that quote to
clients (criterion #1 of our agent's contract). We did **not** wire a
full Universal Router execution on Base Sepolia in the 48-hour window —
the testnet gap above made it a much bigger lift than the hackathon
budget allowed. Our agent's downstream onchain action (criterion #8)
runs through KeeperHub instead. That's the most honest description of
where the integration lands.

If the Trading API picks up a testnet endpoint, our agent's
`callSwapWorkflow` codepath swaps in a real Trading API `/swap` call
behind a single feature flag.

## Score

- Trading API for quoting: **9/10** — sub-second, well-documented, just
  works.
- Trading API for swap execution on testnet: **5/10** — entirely
  because of the mainnet-only constraint, not the API itself. With a
  testnet endpoint or a documented "use these contracts on Base
  Sepolia and call them this way" pattern, this is a 9.

Thanks for the API. Looking forward to the testnet endpoint.
