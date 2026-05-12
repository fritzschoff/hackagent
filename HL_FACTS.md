# HL_FACTS

Compact reference for Hyperliquid integration. Every number here was pulled in the V0 research pass and cited to its source. Anything still labeled VERIFY is what V0's empirical test must cover.

## 1. Networks & endpoints

| | Mainnet | Testnet |
|---|---|---|
| REST | `https://api.hyperliquid.xyz` | `https://api.hyperliquid-testnet.xyz` |
| WebSocket | `wss://api.hyperliquid.xyz/ws` | `wss://api.hyperliquid-testnet.xyz/ws` |
| HyperEVM RPC | `https://rpc.hyperliquid.xyz/evm` | `https://rpc.hyperliquid-testnet.xyz/evm` (VERIFY) |
| HyperEVM chainId | **999** | VERIFY |
| Bridge (Arbitrum) | `0x2df1c51e09aecf9cacb7bc98cb1742757f163df7` | `0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89` |
| `signatureChainId` literal in SDK | `0x66eee` (421614 = Arbitrum Sepolia) — same value on both, the `hyperliquidChain` field is what segregates env | |

## 2. Bridge mechanics (USDC ↔ HL)

**Deposit** — send native USDC (Arbitrum) directly to the bridge contract.
- Minimum: **5 USDC** (smaller is lost)
- Credited to HL account in ~1 minute (VERIFY p99 under load)
- `batchedDepositWithPermit(...)` available for permit-based flows (EIP-712 typed data)

**Withdraw** — sign EIP-712 typed data on HL; validators handle the Arbitrum settle.
- No on-chain user tx required from the user side
- Funds arrive in 3–4 minutes (VERIFY p99)
- Flat **$1 withdrawal fee**, no per-tx gas
- Withdrawal action nonce must equal the `time` field
- No fraud-proof window documented

## 3. HyperEVM ↔ HyperCore interface

HyperEVM is a Cancun EVM with EIP-1559 (both base and priority fees burned because HyperBFT consensus). Native gas: **HYPE** (18 decimals).

**Read precompiles** — addresses starting at `0x0000000000000000000000000000000000000800`.
- Gas cost: `2000 + 65 × (input_len + output_len)`
- Confirmed example: `0x...0807` returns the perp oracle price; input is the asset index as `bytes32`
- Other precompiles (per docs index): perp positions, spot balances, vault equity, staking delegations, L1 block number
- ⚠ Full address map: VERIFY against `L1Read.sol` reference (need to fetch from HL repo)

**Write system contract** — `0x3333333333333333333333333333333333333333`
- Single entrypoint: `sendRawAction(bytes data)`
- Burns ~25k gas + emits a log; HyperCore picks the log up next block
- Action encoding:
  ```
  byte 0:      version    (currently 0x01)
  bytes 1..3:  action ID  (big-endian uint24)
  bytes 4..:   ABI-encoded params
  ```
- 15 action IDs documented (limit order, cancel, vault transfer, USD class transfer, staking ops, token sends, …). Need the full table for V1.

This is the **decisive** finding for the architecture choice: a Solidity treasury on HyperEVM can call `sendRawAction(...)` to place / cancel orders and read state via precompiles. The "oracle pattern" in the original brief is no longer required.

## 4. Fees (perpetuals)

| Tier | 14d volume | Taker | Maker |
|---|---|---|---|
| **0 (us)** | base | **0.045%** | **0.015%** |
| 1 | >$5M | 0.040% | 0.012% |
| 2 | >$25M | 0.035% | 0.008% |
| 3 | >$100M | 0.030% | 0.004% |
| 4 | >$500M | 0.028% | 0% |
| 5 | >$2B | 0.026% | 0% |
| 6 | >$7B | 0.024% | 0% |

- HYPE staking discounts: 5% (10 HYPE Wood) → 40% (500k HYPE Diamond). **Wood tier is effectively free insurance at our scale.**
- Maker rebates: −0.001% to −0.003% paid continuously per trade
- Spot volume counts double for tier determination

## 5. Funding mechanics

- **Settles hourly**, at 1/8 of the computed 8h rate
- Cap: **4% / hour** (very loose vs CEX)
- Interest-rate floor: 0.01% / 8h ≈ **11.6% APR**
- Positive funding → longs pay shorts
- Payment = `position_size × oracle_price × funding_rate` (oracle, not mark)
- Where to read: VERIFY (likely `meta` or `metaAndAssetCtxs` info endpoint)

## 6. Signing scheme

Two distinct flows. Both ultimately use `eth_account.encode_typed_data` (standard EIP-712), so **viem's `signTypedData` is sufficient** — no Python SDK in subprocess.

### 6.1 L1 actions (orders, cancels, vault ops)
1. msgpack-encode the action dict (canonical ordering)
2. Append `vault_address` (or 0x0 if none), `nonce` (uint64, ms timestamp), and `expires_after` (or sentinel)
3. `keccak256` the encoded blob → `connectionId` (bytes32)
4. Build a phantom-agent EIP-712:
   - Domain: `{ name: "Exchange", version: "1", chainId: 1337 mainnet / VERIFY testnet, verifyingContract: 0x0 }`
   - PrimaryType: `Agent` with `{ source: string, connectionId: bytes32 }`
   - `source = "a" mainnet / "b" testnet`
5. Sign

### 6.2 User-signed actions (withdraw, USD send, spot transfer, class transfer)
- Domain: `{ name: "HyperliquidSignTransaction", version: "1", chainId: <signatureChainId>, verifyingContract: 0x0 }`
- `signatureChainId = "0x66eee"` (421614) literal in the SDK on both envs
- `hyperliquidChain = "Mainnet" | "Testnet"` field separates environments
- PrimaryType varies per action — fields are flat strings + uint64 `time`/`nonce`

Withdraw types (confirmed from SDK):
```
{name: "hyperliquidChain", type: "string"}
{name: "destination",     type: "string"}
{name: "amount",          type: "string"}
{name: "time",            type: "uint64"}
```

## 7. Rate limits

**Per-IP:** 1200 weighted requests / minute, shared across all endpoints.
- Exchange (writes): weight = `1 + floor(batch_length / 40)` — almost free
- Cheap info (l2Book, allMids): weight 2
- Heavy info (userRole): weight 60
- Other info: weight 20
- Explorer: weight 40

**Per-address:** 1 request per 1 USDC of cumulative volume + **10 000 initial buffer**.
- Batched orders count as N requests against this (not for IP).

**Open-order cap:** 1000 + 1 per 5M USDC volume, capped at 5000.

⚠ HTTP status on overage: not documented. VERIFY empirically.

For our M2 strategy cron firing every 15 min and the funding-poll every 5 min (= 17 reads/hr), the 10k buffer alone covers >24 days of inactivity. Comfortable.

## 8. HYPE for gas

Per the read-precompile gas formula and write contract's ~25k gas overhead, a typical perp order costs ~30–50k gas on HyperEVM. With EIP-1559 burning all fees, gas cost is real.

⚠ Acquisition path: VERIFY. Candidates:
- (mainnet) buy HYPE on HL spot via USDC → spot transfer to EVM
- (testnet) HyperEVM faucet (URL VERIFY)

Plan a one-time HYPE prefund of $50 equivalent on V2; refill cron if balance drops below a floor.

## 9. Master vs agent wallet

**Important pattern to get right early:**
- Master wallet = the address that owns the HL account (and signs withdraws / user-signed actions)
- Agent wallet (a.k.a. "API wallet" / "approved trading wallet") = a delegated key that can place orders but cannot withdraw

Query info endpoints with the master address only — passing the agent wallet returns empty.

For M2: use the existing `AGENT_PK` EOA as the master wallet. Generate a separate API wallet for the strategy cron (cheaper to rotate; cannot withdraw).

## 10. Still-open items going into V1

| Item | Status | How to close |
|---|---|---|
| Precompile address map (full) | VERIFY | Read `L1Read.sol` reference from hyperliquid repo |
| Action ID table (1–15) | VERIFY | Read HyperEVM docs sub-page |
| Withdrawal latency p99 | VERIFY | Empirical test: 5× $20 deposit + immediate withdraw, measure |
| HYPE gas acquisition path | VERIFY | Open a HL account on testnet, check for faucet; otherwise document mainnet spot route |
| HTTP code on rate-limit overage | VERIFY | Probe with a hot loop on a testnet API wallet |
| HyperEVM testnet chainId + RPC | VERIFY | Wallet support pages or `hyperliquid-testnet` docs |
| `Exchange` domain chainId (testnet vs mainnet) | VERIFY | Inspect Python SDK constants module |

Of these, the empirical bridge+withdraw test costs ~$5 in withdrawal fees + bridge time but gives us the latency p99 we need before V3 capital decision.

---

## V0 takeaway

The most consequential finding: **the oracle-pattern detour in §4 of the M2 brief is no longer required.** HyperEVM precompiles + `0x3333...` write contract are enough to keep `TradingTreasury` fully on-chain on HyperEVM, with HyperCore as the venue. Trust model upgrades from "trust the pusher" to "trust the chain" without us writing any oracle code.

Recommend:
1. Skip option-A (off-chain oracle on Base) entirely; jump straight to **HyperEVM-native treasury (option B)**.
2. V1 builds the TS HL client + precompile bindings against **testnet** with the API-wallet pattern. Zero real risk.
3. V2 redeploys `TradingTreasury` to HyperEVM with the `IPerpExchange` interface backed by `0x3333...` writes + `0x0800+` reads, instead of the mock.

Two questions for the owner are still open from the M2 brief (capital cap, Wood-tier staking) — answers shape V2 deploy params but don't block V1 work.
