# W1 manual UI walkthrough — checklist

**Purpose:** verify the W1 INFT oracle pipeline end-to-end through the live `/inft` page after `feat/w1-inft-oracle` deploys to a Vercel preview (or production after merge).

**What this verifies:** every user-facing surface exposed by W1 — wallet flows, oracle latency, on-chain receipts, the reveal-plaintext money shot, and the stale-memory badge that proves why the proof path matters.

**Reference deployments (Sepolia):**

| Contract | Address |
|---|---|
| AgentINFT | [`0x103B…DeDA`](https://sepolia.etherscan.io/address/0x103B2F28480c57ba49efeF50379Ef674d805DeDA) |
| AgentINFTVerifier | [`0x6D7a…08d3`](https://sepolia.etherscan.io/address/0x6D7a819022b41879D82a5FA035F71F8461a608d3) |
| AgentBids | [`0x58C4…8453`](https://sepolia.etherscan.io/address/0x58C4F095474430314611D0784BeDF93bDB0b8453) |
| AgentMerger | [`0x809c…13D1`](https://sepolia.etherscan.io/address/0x809cA3DB368a7d29DB98e0520688705D3eB413D1) |
| INFT_ORACLE (off-chain signer) | `0x002d…7A70` |

INFT minted: agentId=1, tokenId=1, owner = `0x71226c538679eD4A72E803b3E2C93aD7403DA094` (demo wallet — you'll need its key OR a different bidder wallet to drive the bidding side).

---

## Pre-flight

- [ ] **Vercel preview URL is reachable.** Open `/inft` and confirm the page renders without errors.
- [ ] **Three wallets in MetaMask:**
    1. `OWNER` — current INFT holder (the demo wallet `0x7122…A094` if you have its key, otherwise transfer the INFT to a wallet you control via the deployer first).
    2. `BIDDER` — a wallet with ≥10 Sepolia USDC and some Sepolia ETH. If empty, run `pnpm tsx scripts/distribute.ts` or use [Circle's faucet](https://faucet.circle.com).
    3. `STRANGER` — any third wallet, just for the stale-memory step.
- [ ] **All three wallets have ≥0.01 Sepolia ETH** (cheap deploys: viem auto-estimates around 0.001 ETH per tx).
- [ ] **Sepolia is the active network in MetaMask.**

---

## §A — INFT card renders correctly (read-only)

- [ ] **Owner row** shows `0x71226c538679eD4A72E803b3E2C93aD7403DA094` (or whoever currently holds tokenId=1).
- [ ] **Memory root** displays as `0x3ed1812bac1c7c1424b86c8d2ce307b4b6a018ff8e8bb7b70035f0b80eb35ec6`. Click it → opens [storagescan-galileo.0g.ai](https://storagescan-galileo.0g.ai/file/0x3ed1812bac1c7c1424b86c8d2ce307b4b6a018ff8e8bb7b70035f0b80eb35ec6) and the file resolves with non-zero bytes.
- [ ] **Memory uri** shows `og://0x3ed1…5ec6`.
- [ ] **Rotations** counter displays `0` (oracle Redis state). If it shows blank/error, the meta endpoint is broken — check `/api/inft/oracle/meta?tokenId=1` directly.
- [ ] **Memory** badge shows green `● fresh` (the `memoryReencrypted` flag is `true` post-mint).
- [ ] **Verifier** address row shows `0x6D7a…08d3` and links to Sepolia etherscan.
- [ ] **Oracle** address row shows `0x002d…7A70`.

---

## §B — Place a bid (BIDDER wallet)

This validates the new single-tx delegation+escrow flow.

- [ ] Connect `BIDDER` wallet.
- [ ] Bid form is visible. Enter amount = `1` USDC (1e6).
- [ ] Click **Authorize oracle**. MetaMask shows a typed-data signature popup with:
    - Domain: `AgentINFT`, version `1`, chainId `11155111`, contract `0x103B…DeDA`
    - Message: `Delegation { tokenId: 1, oracle: 0x002d…7A70, expiresAt: <future timestamp> }`
- [ ] Sign. Frontend captures the sig (no chain tx yet).
- [ ] Click **Place bid**. If USDC isn't approved, MetaMask pops first for `USDC.approve(BIDS, 1e6)`. Confirm.
- [ ] MetaMask pops for `BIDS.placeBid(1, 1e6, expiresAt, sig)`. Confirm.
- [ ] After mining (~15-30s on Sepolia):
    - [ ] Bid table shows your row with `1.00 USDC` and `delegated ✓ until <date>`.
    - [ ] Sepolia etherscan: tx emits both `DelegationSet(BIDDER, 1, ORACLE, expiresAt)` AND `BidPlaced(1, BIDDER, 1000000)`.
    - [ ] `INFT.delegations(BIDDER, 1)` reads as `(0x002d…7A70, expiresAt)` via `cast call` or etherscan read.

**Failure modes to spot:**
- If you see two separate wallet popups for delegation and bid — that's the M5/M6 fallback path firing. Should be ONE bid tx for the new flow. Note in PR comments.
- If MetaMask shows raw hex for the typed data instead of human-readable fields — EIP-712 schema is broken. Halt.

---

## §C — Accept bid (OWNER wallet) — the load-bearing flow

- [ ] Switch to `OWNER` wallet.
- [ ] Reconnect dashboard if needed.
- [ ] On the bid row for BIDDER, click `[accept]`.
- [ ] **Modal opens with 3-step UI.** Watch each step:

**Step 1: oracle preparing transfer (~30-60s)**
- [ ] ✓ verifying delegation (≈100ms)
- [ ] ✓ decrypting current blob (≈400ms)
- [ ] ✓ re-encrypting to new owner (≈100ms)
- [ ] ⟳ anchoring new blob to 0G Storage (THIS IS THE LONG ONE — 30-60s)
- [ ] ✓ proof bundle ready

**Step 2: confirm in wallet**
- [ ] MetaMask pops with `BIDS.acceptBid(1, BIDDER, 0x40…)`. The data field starts with `0x40` (the proof byte layout's flags byte).
- [ ] Confirm. Modal shows tx hash with etherscan link.

**Step 3: rotating oracle key**
- [ ] After tx mines (~15-30s), modal advances.
- [ ] ✓ tx mined: `0x…` (etherscan link works)
- [ ] ✓ oracle key rotated: rotations=1
- [ ] Final state: ✓ transfer complete with `[reveal memory]` button

- [ ] **On-chain post-state:**
    - [ ] `INFT.ownerOf(1)` = BIDDER address (read via etherscan or `cast`).
    - [ ] `INFT.encryptedMemoryRoot(1)` = new root (different from `0x3ed1…5ec6`).
    - [ ] `INFT.memoryReencrypted(1)` = `true`.
    - [ ] BIDDER's Sepolia USDC balance dropped by 1, OWNER's increased by 1.
    - [ ] Sepolia etherscan: tx emits `Transferred`, `MemoryReencrypted`, `PublishedSealedKey` (with non-empty `sealedKeys[]`), `BidAccepted`.
- [ ] **Dashboard `/inft` reflects:**
    - [ ] Owner row = BIDDER address.
    - [ ] Memory root row = new root.
    - [ ] Rotations counter = `1`.
    - [ ] Memory badge = green `● fresh`.

---

## §D — Reveal flow (BIDDER, the demo money shot)

- [ ] Switch to `BIDDER` wallet (now the owner).
- [ ] Reload `/inft`. Reveal panel is now visible.
- [ ] Click **reveal memory**.
- [ ] MetaMask pops with an EIP-191 personal_sign of `keccak256("inft-reveal" || 1 || nonce || expiresAt)`. Confirm.
- [ ] Frontend POSTs `/api/inft/transfer/reveal`.
- [ ] After ~1s, JSON renders in a syntax-highlighted box. Should look like:

```json
{
  "agent": "tradewise.agentlab.eth",
  "role": "uniswap quote concierge",
  "skills": ["x402", "0g-compute", "keeperhub", "ens-ensip25"],
  "persona": "terse, signed, dated",
  "sealedBy": "agent-eoa-via-zg-broker",
  "sealedAt": "2026-04-29T..."
}
```

- [ ] Re-clicking reveal within the same minute returns the same plaintext (cached).
- [ ] Disconnect BIDDER, connect a non-owner wallet, refresh — reveal panel must NOT be visible (gated on `ownerOf` server-side).

---

## §E — Stale memory bypass (STRANGER wallet)

This validates the warning that proves *why* the proof path matters.

- [ ] Switch to `BIDDER` wallet.
- [ ] On Sepolia etherscan or direct via MetaMask, send a raw `INFT.transferFrom(BIDDER, STRANGER, 1)` — **NOT** the dashboard's accept-bid flow. The "Send NFT" button on etherscan, or `cast send` if you prefer:

  ```bash
  cast send 0x103B2F28480c57ba49efeF50379Ef674d805DeDA \
    "transferFrom(address,address,uint256)" \
    BIDDER STRANGER 1 \
    --private-key $BIDDER_PK --rpc-url $SEPOLIA_RPC_URL
  ```

- [ ] After tx mines, switch to `STRANGER` wallet. Visit `/inft`.
- [ ] **Owner row** = STRANGER address.
- [ ] **Memory** badge is now red: `⚠ memory is stale` with explanation.
- [ ] **Rotations** counter still reads `1` (Redis didn't rotate — chain bypass).
- [ ] Sepolia etherscan: tx emits `Transferred(1, BIDDER, STRANGER)` AND `MemoryStaled(1)` AND `AgentWalletCleared(1)`.
- [ ] `INFT.memoryReencrypted(1)` = `false`.
- [ ] **STRANGER cannot reveal**: even if the reveal panel renders, clicking it will fail because the AES key in Redis (still K_new from §C) doesn't decrypt anything STRANGER controls. Acceptable; documents the trust boundary.

---

## §F — Oracle health checks (background)

- [ ] `/api/inft/oracle/key` returns `{oracleAddress: "0x002d…7A70", verifierAddress: "0x6D7a…08d3", defaultExpiresAt: <future iso>}` and `Cache-Control` shows ~60s.
- [ ] `/api/inft/oracle/meta?tokenId=1` returns `{rotations: 1}` after §C lands. Cached 30s.
- [ ] **Internal routes are gated.** Hitting `/api/inft/oracle/seal-blob` without `Authorization: Bearer ...` returns 401.

---

## §G — Manual cleanup (optional)

- [ ] Move the secrets manifest at `/tmp/w1-secrets-and-addresses.md` to your password manager and `rm` it from `/tmp`.
- [ ] Same for `/tmp/inft-oracle-key.txt`.

---

## Sign-off

| Section | Result | Notes |
|---|---|---|
| §A read-only | ☐ pass / ☐ fail | |
| §B place bid | ☐ pass / ☐ fail | |
| §C accept bid | ☐ pass / ☐ fail | |
| §D reveal | ☐ pass / ☐ fail | |
| §E stale memory | ☐ pass / ☐ fail | |
| §F oracle health | ☐ pass / ☐ fail | |

**Verified by:** `____________________`
**Date:** `____________________`
**Vercel deployment URL:** `____________________`

If any section fails, comment on PR #12 with the failed step + console logs from the relevant Vercel function (oracle routes log `[zg-storage]`, `[zg-compute]`, `[inft-oracle]` prefixes).
