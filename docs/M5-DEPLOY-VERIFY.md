# Milestone 5 — Production deploy + round-trip verification

Estimated time: ~5–10 minutes (most of it waiting for the next cron tick).

This is the final step of [Bootstrap Combo D — Phases 0+1](../PLAN.md). After
this passes you'll have an autonomous on-chain agent earning x402 USDC every
2 minutes on Base Sepolia, with proof on a public block explorer.

## 0. Pre-flight

Confirm Checkpoints 1 + 2 are green:

```bash
vercel env ls production
# expect: AGENT_PK, CLIENT1_PK, CLIENT2_PK, CLIENT3_PK, VALIDATOR_PK,
#         CRON_SECRET, NEXT_PUBLIC_APP_URL,
#         REDIS_URL, EDGE_CONFIG,
#         SEPOLIA_RPC_URL, BASE_SEPOLIA_RPC_URL,
#         UNISWAP_API_KEY (optional)
```

## 1. Promote to production

```bash
git add .
git commit -m "feat: bootstrap Phase 1 (x402 paying flow on Base Sepolia)"
git push origin main         # auto-deploys to production
```

Or manually:

```bash
vercel deploy --prod
```

## 2. Watch the first cron tick

The simulated clients run on these crons:

- `client-tick?id=1` — every 2 minutes
- `client-tick?id=2` — every 3 minutes
- `client-tick?id=3` — every 5 minutes

Once production is live, wait up to 2 minutes. Then:

```bash
vercel logs --prod | grep client-tick
```

You should see exactly one of these per tick:

```
GET 200 /api/cron/client-tick?id=1
```

…with no `error_` lines in the body. The handler returns a JSON body with
`{ ok: true, payer, intent, response }` — copy the `paymentResponse` base64
and verify the tx hash inside.

## 3. Verify on BaseScan

The settlement tx is broadcast by the Coinbase x402 facilitator from the
client's wallet. Find it:

```bash
open "https://sepolia.basescan.org/address/<client1_address>"
```

You should see a `transferWithAuthorization` call to the USDC contract
`0x036CbD53842c5426634e7929541eC2318f3dCF7e`, transferring `100000`
(=$0.10) to the agent address.

## 4. Verify on the dashboard

```bash
open https://<your-project>.vercel.app
```

Within 30 seconds (Page revalidate), you'll see:

- **lifetime earnings**: $0.10 (and climbing every 2 min).
- **quotes served**: 1 (and climbing).
- **cron heartbeat** table: at least `client-tick` showing a recent tick.
- **recent jobs**: a row with the swap pair and `+1 USDC` (well, $0.10 for now).

## 5. Verify the agent card

```bash
curl https://<your-project>.vercel.app/.well-known/agent-card.json | jq
```

You should see:

- `services[0].endpoint` pointing to `/api/a2a/jobs`.
- `agentWallet` equal to your `agent` address.
- `x402Support: true`.

## 6. Capture the deliverable

For the hackathon submission you'll want:

- The production dashboard URL.
- One BaseScan transaction hash showing a USDC payment to the agent.
- The `/.well-known/agent-card.json` URL.
- The Vercel logs URL showing a successful `client-tick` round-trip.

This satisfies P1 success criteria 1 + 2 from `PLAN.md §0`. From here you
move to P2 — `agentlab.eth` registration + ERC-8004 deploys, which is the
next plan.

## Common failure modes

### `agent_not_configured`

The agent route returns `{ "error": "agent_not_configured" }`. Cause:
`AGENT_PK` is missing or blank in production env. Fix in Vercel dashboard
and redeploy.

### `client_not_configured`

The cron returns `{ "error": "client_not_configured", "walletId": "client2" }`.
Same root cause: `CLIENT2_PK` is missing. Fix and redeploy.

### Crons run, but tx never lands

Check `vercel logs --prod` for the `client-tick` body. If you see
`facilitator verify` errors, the most common cause is the client wallet
running out of Base Sepolia USDC. Re-fund from `https://faucet.circle.com/`.

### `revalidate` doesn't pick up new jobs

The dashboard caches for 30 seconds. Hard refresh (Shift+R) or wait.

### x402 facilitator timeouts

If `https://facilitator.x402.org` is slow, set
`X402_FACILITATOR_URL=https://x402.org/facilitator` (legacy v1 endpoint with
v2 fallback). Both are operated by the same team.
