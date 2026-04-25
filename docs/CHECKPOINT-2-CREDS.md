# Checkpoint 2 — Wallets, faucets, sponsor accounts

Estimated time: ~30 minutes (mostly waiting on faucets to drip).

You'll generate 5 wallets, fund them on three testnets, and sign up for the
sponsor APIs we'll need for P1–P5.

## 1. Generate 5 wallets

```bash
cd /Users/maxfritz/code/hack-agent
pnpm gen-wallets
```

This prints to stdout only — the keys are **never written to disk**. Save the
output in a private password manager note while you work through the rest of
this checklist.

The script prints, for each role:

- The address (use this in faucets and to verify on-chain).
- The private key (paste this into Vercel env).
- The exact env var name to use.

Roles and their purpose:

| role        | env var       | purpose                                                              |
| ----------- | ------------- | -------------------------------------------------------------------- |
| `agent`     | `AGENT_PK`    | the agent EOA — receives x402 USDC, owns ENS subname, posts to ERC-8004 |
| `client1`   | `CLIENT1_PK`  | simulated client #1 — pays the agent every 2 minutes                |
| `client2`   | `CLIENT2_PK`  | simulated client #2 — pays the agent every 3 minutes                |
| `client3`   | `CLIENT3_PK`  | simulated client #3 — pays the agent every 5 minutes                |
| `validator` | `VALIDATOR_PK` | validator EOA — re-runs jobs and posts validation responses (P4)     |

## 2. Push wallet keys to Vercel

The script also prints ready-to-run commands. Execute them once:

```bash
printf '%s' '0x<agent_pk>'    | vercel env add AGENT_PK production preview development
printf '%s' '0x<client1_pk>'  | vercel env add CLIENT1_PK production preview development
printf '%s' '0x<client2_pk>'  | vercel env add CLIENT2_PK production preview development
printf '%s' '0x<client3_pk>'  | vercel env add CLIENT3_PK production preview development
printf '%s' '0x<validator_pk>' | vercel env add VALIDATOR_PK production preview development
```

(`vercel env add NAME` accepts piped stdin and applies to the listed
environments in one call.)

## 3. Fund the wallets — Sepolia ETH

Every role needs Sepolia ETH for gas (ENS writes + ERC-8004 deploys land in
P2; the validator and agent will be writing every few minutes).

Use whichever faucet has capacity:

- https://sepoliafaucet.com (Alchemy, requires login, 0.5 ETH / day)
- https://www.infura.io/faucet/sepolia
- https://faucet.quicknode.com/ethereum/sepolia
- https://www.alchemy.com/faucets/ethereum-sepolia

You only really need ~0.05 ETH per wallet for a hackathon's worth of writes.

## 4. Fund the wallets — Base Sepolia (clients only)

Clients pay the agent in **USDC on Base Sepolia**. They need:

1. **Base Sepolia ETH** for gas:
   - https://www.alchemy.com/faucets/base-sepolia
   - https://docs.base.org/docs/tools/network-faucets/

2. **Base Sepolia USDC** to actually pay:
   - https://faucet.circle.com/  → choose `Base Sepolia` network
   - drips 10 USDC per address per day, which is way more than we need
     (each quote costs $0.10)

Drain both faucets to all three client addresses.

## 5. Fund the agent — 0G Galileo (P3)

Only the agent wallet needs 0G Galileo testnet tokens (used in P3 for 0G
Storage and 0G Compute):

- https://faucet.0g.ai/
- alt: https://hub.0g.ai/faucet

Skip if you're not implementing P3.

## 6. Sponsor API keys

### Alchemy (or Infura) — RPC for Sepolia + Base Sepolia

1. Sign up at https://www.alchemy.com/
2. Create an app for **Ethereum Sepolia** → copy the HTTPS endpoint.
3. Create an app for **Base Sepolia** → copy the HTTPS endpoint.

```bash
vercel env add SEPOLIA_RPC_URL production preview development
# paste: https://eth-sepolia.g.alchemy.com/v2/<KEY>

vercel env add BASE_SEPOLIA_RPC_URL production preview development
# paste: https://base-sepolia.g.alchemy.com/v2/<KEY>
```

### Uniswap Trading API

1. Apply at https://hub.uniswap.org/  (free, instant approval).
2. Create an API key under **Trading API**.

```bash
vercel env add UNISWAP_API_KEY production preview development
# paste: <key>
```

If you skip this, the agent silently falls back to a deterministic mock quote.
Real Uniswap quoting is a nice signal for the Uniswap Foundation prize.

### KeeperHub (P4 only — can defer)

1. Sign up at https://keeperhub.io/
2. Create a Workflow that takes `{ intent, quote }` and returns a tx hash.
3. Copy the workflow id.

```bash
vercel env add KEEPERHUB_API_KEY production preview development
vercel env add KEEPERHUB_WORKFLOW_ID_SWAP production preview development
```

### 0G Builder Hub (P3 only — can defer)

1. Sign up at https://hub.0g.ai/
2. Create a Compute provider account → grab a broker URL.

```bash
vercel env add ZG_BROKER_URL production preview development
vercel env add ZG_PRIVATE_KEY production preview development   # = AGENT_PK
vercel env add ZG_GALILEO_RPC_URL production preview development
```

## 7. Pull env back locally

```bash
vercel env pull .env.local
```

## 8. Verify the round-trip locally

```bash
pnpm dev
```

In another terminal:

```bash
curl -i -H "Content-Type: application/json" \
  -d '{"task":"swap","tokenIn":"0x4200000000000000000000000000000000000006","tokenOut":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","amountIn":"1000000","maxSlippageBps":100}' \
  http://localhost:3000/api/a2a/jobs
```

You should see **HTTP 402** and a JSON body with `accepts[0].payTo` equal to
your agent address.

## ✅ Done if

1. `vercel env ls production | grep _PK | wc -l` → `5`.
2. The 402 challenge above shows the right `payTo` and `network: eip155:84532`.
3. `pnpm gen-wallets` output is **safely stored** somewhere private.

Once you confirm, we kick off **M5** — production deploy with crons enabled.
