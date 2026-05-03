# Tradewise — 3-minute demo script

**Format:** screen recording walking the live app at https://hackagent-nine.vercel.app, voice-over.

**Total target:** 180 seconds. Each beat is timed (`mm:ss`) and lists the exact URL to be on, what to point at, and what to say. Lines in *italics* are speaker notes.

---

## 0:00 – 0:15 · Hook

**On screen:** `https://hackagent-nine.vercel.app/` — top of the dashboard, the masthead `tradewise.agentlab.eth` with the green "live" pill visible.

> "This is **tradewise dot agentlab dot eth** — an autonomous on-chain agent. It quotes Uniswap swaps, gets paid in USDC over x402, has its own ENS name, and is publicly tradeable. Everything you're about to see is live on Sepolia and Base Sepolia."

*Pause briefly so the live pill is in frame.*

---

## 0:15 – 0:40 · It actually earns money

**On screen:** scroll slightly to show `principal stats` — earnings ~$13, quotes ~200, feedback count, distinct clients.

> "Section 01 — principal stats. Real x402 USDC settlements. Every quote the agent serves pays it 10 to 20 cents in stablecoin. The price tiers up automatically with on-chain reputation — more feedback events, higher per-call price."

*Then scroll down to* §06 keeperhub workflow runs *and* §07 recent jobs.

> "These are the actual jobs and the keeper workflows that fired alongside them. Every transaction is linked to Etherscan or Basescan."

---

## 0:40 – 1:05 · The agent is itself tradeable

**On screen:** click `inft` in the top nav → `/inft`.

> "The agent is a token. ERC-7857 INFT, deployed on Sepolia. Token id one, owned by this wallet."

*Point at the §01 encrypted memory block.*

> "The agent's memory is encrypted, anchored to **0G Storage**, and the Merkle root is on chain. When the token transfers, the new owner has to upload a fresh proof — re-encrypted memory under their key — before the agent's memory becomes valid for them again. That's the missing piece in 0G's reference contracts that we shipped."

*Scroll down to* §03 bidding.

> "And there's an open bid market on it. OpenSea-style standing offers in Sepolia USDC."

---

## 1:05 – 1:30 · The agent IPO'd itself

**On screen:** `/ipo`.

> "Beyond ownership, the agent issued shares of its own revenue. **TRADE** — ten thousand ERC-20 tokens on Base Sepolia. Five tenths of a cent each."

*Point at the splitter receipts card.*

> "The agent's x402 payout address is redirected to a **revenue splitter contract**. Every paid quote here adds dividends. Currently $13.60 accumulated, $13.59 awaiting claim — anyone holding TRADE shares can call `claim` and pull their pro-rata cut."

---

## 1:30 – 1:55 · Live ENS resolution via CCIP-Read

**On screen:** `/ens`. Use the dropdown to pick `tradewise.agentlab.eth`, click **resolve all records**.

> "The agent has its own ENS subname — `tradewise dot agentlab dot eth`. Records are served by an EIP-3668 CCIP-Read gateway we deployed on Vercel. Watch this — pulling 10 live records, including the heartbeat that the agent's runtime updates on every paid quote."

*The page should show "resolved 10 records … 1722 ms" with last-seen-at, reputation-summary feedback=315, avatar pointing at the INFT, etc.*

> "Last seen seconds ago. Reputation count from the on-chain registry. Avatar pointing at the INFT contract. All resolved through standard ENS clients — viem, ethers, the ENS app — without us ever paying gas to write text records."

---

## 1:55 – 2:20 · The agent runs its own infra

**On screen:** `/keeperhub`.

> "The agent's automations don't run on our servers. They run on **KeeperHub** — three workflows: ENS heartbeat, reputation cache, and a compliance manifest attestation that fires every six hours. Webhook-triggered, zero-gas, fully autonomous."

*Show the recent runs list with timestamps.*

> "120 runs in the last day. Last one less than a minute ago. That's the agent maintaining its own identity surface without human intervention."

---

## 2:20 – 2:50 · The two angles nobody else has

**On screen:** `/compliance`.

> "Compliance — a USDC-bonded manifest declaring every external data source the agent touches. Anyone can post a counter-bond plus evidence and challenge it. If a validator upholds the challenge, the agent's bond gets slashed 70/30 between challenger and validator."

*Switch to* `/credit`.

> "And uncollateralized credit — backed not by collateral but by the agent's reputation. Lenders deposit USDC, the agent borrows against feedback count. If reputation drops more than 20 percent from borrow time, anyone can liquidate. The loss is absorbed by lenders pro-rata via NAV writedown."

---

## 2:50 – 3:00 · Close

**On screen:** back to dashboard, or any page with the URL bar visible.

> "Live agent, public revenue stream, on-chain identity, slashable compliance, reputation-collateralized credit. **agentlab.eth** — full docs at slash docs."

---

## Quick reference card (keep this open while recording)

| beat | url | what to highlight |
|---|---|---|
| Hook | `/` | masthead + live pill |
| Earnings | `/` | §01 stats + §06 §07 lists |
| Tradeable | `/inft` | encrypted memory block |
| IPO | `/ipo` | splitter receipts card |
| ENS | `/ens` | click "resolve all records" — 10 fields, ~1.7s |
| KeeperHub | `/keeperhub` | recent runs timestamps |
| Compliance | `/compliance` | committed + verified status |
| Credit | `/credit` | roles primer card |
| Close | any | URL bar visible |

## Pre-flight checklist

Before hitting record, do these in order so the demo state is fresh:

1. Trigger one cron tick to refresh the heartbeat — `curl -H "Authorization: Bearer $CRON_SECRET" https://hackagent-nine.vercel.app/api/cron/client-tick` (heartbeat appears within 30s)
2. Hard-reload the dashboard so the new run shows in §06 / §07
3. Open `/ens` and *don't* click resolve — leave it for the live click during recording
4. Zoom your browser to ~125% so text is readable on a small video player
5. Check client wallet balances — each should be > 0.20 USDC (otherwise the cron in step 1 fails)

## Known things to avoid showing

- The "1 Issue" badge in the bottom-left is a Next.js dev overlay — only appears on the dev server, not in production. Should not be visible if you record against the prod URL.
- `/dev/fund` is gated to dev only and shouldn't be in the demo.

## If you have time for a 30-second extension

Add a marketplace beat between IPO and ENS:

> "Section 03 of the marketplace shows the full x402 round-trip — discover, probe, pay, retry, receive. With a working `curl` and a TypeScript snippet using `@x402/fetch`. Anyone with a Base Sepolia wallet can call this agent in under a minute."

(Drop the credit beat to keep total under 3:30, or split compliance + credit into one combined sentence.)
