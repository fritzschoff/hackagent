# Agent identity package: INFT re-encryption + dynamic ENS resolver + primary names

**Date:** 2026-04-28
**Issues covered:** [#9](https://github.com/fritzschoff/hackagent/issues/9) plan A · [#10](https://github.com/fritzschoff/hackagent/issues/10) plans A and B
**Author:** tradewise

## Goal

Three workstreams designed and shipped as one package because they cross-link strongly: the INFT's encryption state is exposed via ENS, the ENS gateway's authority story mirrors the INFT oracle's, and primary names tie all wallets in the system into a single legible identity surface.

- **W1 — ERC-7857 INFT oracle.** Today's `AgentINFT` clears the agent's payout wallet on transfer but never re-encrypts the encrypted-memory blob. We ship the missing primitive: the memory blob is re-encrypted to the new owner on every authorized transfer, with a verifier matching 0G's reference byte layout and an oracle service we run.
- **W2 — Dynamic CCIP-Read ENS resolver.** Today every `*.agentlab.eth` text record is a hand-written `setText` cron tx. We replace the static records with an EIP-3668 offchain resolver: live `last-seen-at`, `reputation-summary`, `outstanding-bids`, and INFT cross-links served from a signed Vercel gateway. ENSIP-10 wildcard means every new agent gets ENS records for free. Kills the hourly heartbeat tax.
- **W3 — Reverse resolution + ENSIP-19 multichain primary names.** Every wallet we own (agent EOA, pricewatch deployer, KeeperHub Turnkey, validator) gets a primary name on Sepolia + Base Sepolia. Etherscan, MetaMask, and the dashboard surface `tradewise.agentlab.eth` instead of `0x7a83…`.

The unified pitch: **a hackathon agent with on-chain memory provenance, live ENS telemetry, and legible identity in every UI** — built end to end on the standard tech (ERC-7857 + EIP-3668 + ENSIP-19), with KeeperHub orchestrating the multi-chain, multi-tx setup chores.

### Trust anchors (shared across W1/W2)

Both the INFT oracle (W1) and the CCIP-Read gateway (W2) are EOA-signing services we run. The INFT verifier checks the oracle's signature on-chain; the ENS offchain resolver checks the gateway's signature on-chain via the standard `OffchainLookup` callback. Same posture as 0G's reference verifier deploy script (`Verifier(0x0000…0000, VerifierType.TEE)` — its on-chain attestation contract is unset and a `// TODO: verify TEE's signature` comment sits in the verifier path) and `cb.id` / `uni.eth` (CCIP-Read trusted gateway flavor). Hardware-attested swap-in path is identical for both: replace the EOA, the contract config tracks the new pubkey, callers see no API change.

## Non-goals

- TEE attestation hardware (W1 oracle is EOA; W2 gateway is EOA).
- ERC-7857 `clone()` (forking an INFT to a new tokenId).
- ERC-7857 `authorizeUsage()` (rental).
- Cross-chain INFT transfers.
- Backfilling memory for the existing INFT at `0x245217…84EB6` — clean re-mint on the new contract.
- W2-β (Unruggable Gateways / storage proofs) — α-flavor (trusted signed gateway) only. Resolver designed so β can be a pure verifier swap later.
- ENS Namechain migration (issue #10 plan C). Post-hackathon.
- ENS NameWrapper / fuse-locked subnames.
- Selling subnames as NFTs in AgentBids (issue #10 side dish).

---

# W1 — ERC-7857 INFT oracle

## W1 architecture

```
                ┌──────────────────────────────────────────┐
                │    Oracle server                         │
                │    Vercel functions @                    │
                │    app/api/inft/oracle/*                 │
                │    + Redis-backed per-token AES-128 keys │
                │    + INFT_ORACLE_PK signing key          │
                └────────┬───────────────────┬─────────────┘
                         │ ECDH/ECIES        │ EIP-191 sig
                         │ + 0G Storage      │ over proof bytes
                         ▼                   ▼
   ┌─────────────────────────────────────────────────────────┐
   │  AgentINFTVerifier                                      │
   │   - implements 0G's IERC7857DataVerifier                │
   │   - byte-for-byte proof layout from reference Verifier  │
   │   - extends with TEE/oracle sig check (0G's TODO)       │
   └──────────────────────────┬──────────────────────────────┘
                              │ verifyTransferValidity / verifyPreimage
              ┌───────────────┼─────────────────┐
              ▼               ▼                 ▼
   ┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
   │ AgentINFT (new)  │ │AgentBids(new)│ │AgentMerger (new) │
   │  + transferWith  │ │  + delegation│ │  + dual proofs   │
   │    Proof()       │ │    forward   │ │    on recordMerge│
   │  + delegations[] │ │  + acceptBid │ │                  │
   │  + memReencrypted│ │    threads   │ │                  │
   └──────────────────┘ │    proofs    │ └──────────────────┘
                        └──────────────┘
```

**Trust model.** The verifier contract is the only on-chain validator. It accepts a proof bundle with two ECDSA signatures: one from the receiver (or their delegated oracle) committing to `(newRoot, oldRoot, nonce)`, and one from the configured oracle EOA committing to the full transfer context. Neither signature is hardware-attested. Hardware attestation is the swap-in path: replace `INFT_ORACLE_PK` with a TEE-bound key, the contract is unaware.

## W1 decisions

- **Q1 — Oracle posture:** track 0G's reference verifier byte-for-byte (`b′`) and ship its missing oracle counterpart. We extend the reference's transfer-validity verifier with an on-chain check of the oracle attestation tail (the reference leaves it as TODO).
- **Q2 — Direct `transferFrom`:** allow it, but flip a `memoryReencrypted[tokenId]` flag to `false` and emit `MemoryStaled`. UI surfaces a red "memory stale" badge. The badge is a feature: it demonstrates *why* the proof path matters.
- **Q3 — Bidder accessibility signature timing:** bidder pre-signs an EIP-712 `Delegation(tokenId, oracle, expiresAt)` at bid time. The oracle acts as receiver-proxy in the accessibility signature embedded in the transfer proof. The contract resolves the receiver: either `output.receiver == to` (direct, bidder live) or `delegations[to][tokenId].oracle == output.receiver && expiresAt > now` (delegation, primary path).

## W1 contract surface

### `AgentINFTVerifier.sol` (new)

Implements `IERC7857DataVerifier` matching 0G's reference layout. Proof byte layout for the **private-data, TEE-flavor** case (the only case we use):

| Offset | Length | Field |
|---|---|---|
| 0 | 1 | flags (bit 7 = isTEE = 0; bit 6 = isPrivate = 1) |
| 1 | 65 | accessibility proof (ECDSA sig over `keccak256(newDataHash \|\| oldDataHash \|\| nonce)` wrapped in EIP-191 `\x19Ethereum Signed Message:\n66`) |
| 66 | 48 | nonce (used as replay-protection key in `usedNonces`) |
| 114 | 32 | newDataHash |
| 146 | 32 | oldDataHash |
| 178 | 16 | sealedKey (first 16 bytes of ECIES ciphertext block) |
| 194 | 33 | ephemeralPubkey (compressed secp256k1) |
| 227 | 12 | wrap IV |
| 239 | 16 | wrap GCM tag |
| 255 | 2 | newUriLength (uint16, big-endian) |
| 257 | N | newUri (UTF-8) |
| 257+N | 65 | oracle attestation: ECDSA over `keccak256(tokenId \|\| oldDataHash \|\| newDataHash \|\| sealedKey \|\| keccak256(newUri) \|\| nonce)` wrapped in EIP-191 |

State:

```solidity
address public immutable expectedOracle;
mapping(bytes32 => bool) internal usedNonces;
```

`verifyTransferValidity(proofs[])`:
1. Parse fields per layout above.
2. ecrecover accessibility sig → `output.receiver`. Could be the bidder (direct) or the oracle (delegation). Caller decides.
3. ecrecover oracle attestation → must equal `expectedOracle`. **Reverts otherwise.** This is the part 0G's reference verifier left as TODO.
4. Mark `usedNonces[keccak256(nonce)] = true`. Reverts if already set.
5. Return `TransferValidityProofOutput { oldDataHash, newDataHash, receiver, sealedKey, isValid: true }`.

`verifyPreimage(proofs[])`: extend the reference's no-op shape for the mint path. Layout: `[1 byte flags | 65 bytes oracleSig | 32 bytes dataHash | 48 bytes nonce]` (146 bytes total). Verifier ecrecovers `oracleSig` over `keccak256("inft-mint-v1" || dataHash || nonce)` wrapped in EIP-191. Returns `PreimageProofOutput { dataHash, isValid }` where `isValid = (recoveredSigner == expectedOracle && !usedNonces[keccak256(nonce)])`. Marks nonce used.

Events: none. Verifier is stateless besides the nonce mapping.

### `AgentINFT.sol` (rewrite)

Keeps OZ ERC-721 base for marketplace compatibility. Adds the ERC-7857 `transferWithProof` path on top. Constructor takes `(identityRegistry, baseURI, verifier, oracle)`.

```solidity
IERC7857DataVerifier public immutable VERIFIER;
address public immutable ORACLE;                              // == VERIFIER.expectedOracle()
mapping(uint256 => bool) public memoryReencrypted;            // (Q2/ii) stale flag
mapping(address => mapping(uint256 => Delegation)) public delegations;

struct Delegation {
    address oracle;        // who is authorized to act as receiver-proxy
    uint64 expiresAt;
}

// EIP-712 typehash for Delegation
bytes32 public constant DELEGATION_TYPEHASH =
    keccak256("Delegation(uint256 tokenId,address oracle,uint64 expiresAt)");

// Mint takes a proof now
function mint(address to, uint256 agentId, bytes calldata mintProof)
    external returns (uint256 tokenId);

// New transfer entry point (the ERC-7857 transfer)
function transferWithProof(address to, uint256 tokenId, bytes calldata proof)
    external;

// Bidder's own delegation registration (msg.sender == receiver)
function setDelegation(uint256 tokenId, address oracle_, uint64 expiresAt)
    external;

// AgentBids forwards the bidder's EIP-712 sig (msg.sender == AgentBids)
// Verifies sig recovers to `receiver` — works only when receiver is an EOA.
function setDelegationFor(address receiver, uint256 tokenId, address oracle_,
    uint64 expiresAt, bytes calldata sig) external;

// Owner-authorized delegation: msg.sender is current owner of tokenId,
// authorizing some `receiver` (usually a contract like AgentMerger that
// can't sign). No EIP-712 sig — owner's tx is the authorization.
function setDelegationByOwner(address receiver, uint256 tokenId,
    address oracle_, uint64 expiresAt) external;

function clearDelegation(uint256 tokenId) external;            // receiver/owner cancels
function isDelegated(address receiver, uint256 tokenId)
    external view returns (bool);

// Existing kept
function updateMemory(uint256 tokenId, bytes32 newRoot, string calldata newUri)
    external;  // owner-self mutation, sets memoryReencrypted = true
```

Events:

```solidity
event Transferred(uint256 indexed tokenId, address indexed from,
    address indexed to);
event PublishedSealedKey(address indexed to, uint256 indexed tokenId,
    bytes16[] sealedKeys);
event MemoryReencrypted(uint256 indexed tokenId, bytes32 newRoot, string newUri);
event DelegationSet(address indexed bidder, uint256 indexed tokenId,
    address oracle, uint64 expiresAt);
event DelegationCleared(address indexed bidder, uint256 indexed tokenId);
event MemoryStaled(uint256 indexed tokenId);                   // raw transferFrom
```

`transferWithProof(to, tokenId, proof)`:

1. Call `VERIFIER.verifyTransferValidity([proof])`. Require `isValid`.
2. Require `output.oldDataHash == encryptedMemoryRoot[tokenId]` — proof must bind to current state.
3. Resolve receiver:
   - `output.receiver == to` → direct path (bidder signed live).
   - else `delegations[to][tokenId].oracle == output.receiver && delegations[to][tokenId].expiresAt > block.timestamp` → delegation path.
   - else revert.
4. Update storage: `encryptedMemoryRoot[tokenId] = output.newDataHash`; parse `newUri` from proof tail and store; `memoryReencrypted[tokenId] = true`.
5. Set transient flag (`tstore`-style) so `_update` knows this is the proof path.
6. Internal `_safeTransfer(_ownerOf(tokenId), to, tokenId)`. The OZ `_update` hook fires: clears agentWallet (existing behavior).
7. Emit `Transferred`, `MemoryReencrypted`, `PublishedSealedKey([sealedKey])`.
8. Clear transient flag.

`_update` override:

- Existing: if `from != 0 && to != 0 && agentId != 0`, call `IDENTITY.clearAgentWalletOnTransfer(agentId)`.
- **New:** also if transient `_proofPath` flag is **not** set and `from != 0 && to != 0`, set `memoryReencrypted[tokenId] = false` and emit `MemoryStaled`. (Mints, burns, and proof-path transfers leave the flag alone.)

`setDelegationFor(receiver, ...)`:

- Verify `sig` is `receiver`'s EIP-712 signature over `Delegation(tokenId, oracle_, expiresAt)`. Domain separator pinned to AgentINFT contract address + chainId.
- Store `delegations[receiver][tokenId] = Delegation(oracle_, expiresAt)`.
- No msg.sender check — the EIP-712 sig itself is the authorization. Anyone can broadcast (we expect AgentBids to be the broadcaster).
- Reject if `oracle_ != ORACLE`. Forces consistency: only one oracle is ever the configured target.
- Reject if `expiresAt <= block.timestamp` or `expiresAt > block.timestamp + 365 days` (sanity bounds).
- Used for receiver = EOA (the bidder).

`setDelegationByOwner(receiver, ...)`:

- Verify `msg.sender == _ownerOf(tokenId)` — only the current token owner authorizes a non-EOA receiver.
- Same `oracle_` and `expiresAt` validation as above.
- Store `delegations[receiver][tokenId] = Delegation(oracle_, expiresAt)`.
- Used for receiver = contract address (AgentMerger). The owner's transaction is the authorization; no EIP-712 sig from receiver because receivers like AgentMerger have no key.

Constructor consistency check: `require(VERIFIER.expectedOracle() == oracle_, "verifier/oracle mismatch")`. Prevents deploying an INFT bound to a verifier configured for a different oracle.

Preserved from existing AgentINFT (storage and behavior unchanged):

```solidity
mapping(uint256 => uint256) public agentIdOfToken;
mapping(uint256 => uint256) public tokenIdForAgent;
mapping(uint256 => bytes32) public encryptedMemoryRoot;
mapping(uint256 => string) public encryptedMemoryUri;
function updateMemory(uint256, bytes32, string) external;   // owner-self
function setBaseURI(string) external;                        // deployer
function _baseURI() internal view returns (string);
```

### `AgentBids.sol` (rewrite)

```solidity
struct Bid {
    address bidder;
    uint256 amount;
    uint64 createdAt;
    uint64 delegationExpiresAt;
    bool active;
}

function placeBid(
    uint256 tokenId,
    uint256 amount,
    uint64 expiresAt,
    bytes calldata delegationSig
) external nonReentrant;

function withdrawBid(uint256 tokenId) external nonReentrant;

function acceptBid(
    uint256 tokenId,
    address bidder,
    bytes calldata proof
) external nonReentrant;
```

`placeBid`:

1. `INFT.setDelegationFor(msg.sender, tokenId, ORACLE, expiresAt, delegationSig)` — forwards the EIP-712 sig. Reverts if invalid.
2. Existing escrow logic: pull USDC, store/top up bid.
3. Single tx for bidder's wallet — single mined transaction does delegation + escrow.

`acceptBid`:

1. `require(INFT.ownerOf(tokenId) == msg.sender, "not owner")`.
2. `require(b.active)`. Mark inactive, zero amount.
3. `INFT.transferWithProof(bidder, tokenId, proof)` — AgentINFT does the verifier + delegation check.
4. `USDC.safeTransfer(seller, amount)`.
5. Emit `BidAccepted`.

If `transferWithProof` reverts (bad proof, expired delegation, root mismatch), the whole tx reverts and USDC stays escrowed — bid remains active for retry.

### `AgentMerger.sol` (rewrite)

```solidity
function recordMerge(
    uint256 mergedAgentId,
    uint256 sourceAgentId1,
    uint256 sourceTokenId1,
    bytes calldata proof1,
    uint256 sourceAgentId2,
    uint256 sourceTokenId2,
    bytes calldata proof2,
    bytes32 sealedMemoryRoot,
    string calldata sealedMemoryUri
) external returns (uint256 mergerIdx);
```

Caller (the merged-agent owner) must:
- Hold both source INFTs.
- Have called `INFT.setDelegationFor(address(this), sourceTokenId1, ORACLE, expiresAt, sig)` for the merger contract — receiver = `address(MERGER)`, oracle delegated. Same for token 2.

Merger calls `INFT.transferWithProof(address(this), sourceTokenIdN, proofN)` for each source token. Both `proofN.newDataHash` must equal `sealedMemoryRoot`. The merged blob is anchored once in 0G Storage; both source tokens get rewritten to point at it before being held in custody.

Existing `mergerIndexOfAgent`, `effectiveFeedbackCount`, `getMerger`, `mergerCount` views unchanged.

## W1 oracle server

### Cryptographic primitives

| Layer | Algorithm | Why |
|---|---|---|
| Memory blob symmetric encryption | AES-128-GCM | `bytes16 sealedKey` in reference layout |
| Key wrap to receiver | ECIES-secp256k1 (ephemeral key + ECDH + HKDF-SHA256 + AES-128-GCM) | Bidder pubkey is recoverable from delegation sig — no extra registration |
| Oracle attestation sig | secp256k1 ECDSA + EIP-191 wrapper | Matches reference verifier's `\x19Ethereum Signed Message:\n66` style |
| Per-token key storage at rest | AES-256-GCM with KEK derived from `INFT_ORACLE_PK` via HKDF-SHA256(salt="inft-kek-v1", info=tokenId) | Per-token KEK derivation isolates compromise |

### Redis layout

```
inft:key:<tokenId>                  → AES-256-GCM(currentAESKey, KEK)         hex
inft:pending:<tokenId>:<nonce>      → AES-256-GCM(pendingAESKey, KEK)         TTL 24h
inft:nonce:<tokenId>:<nonce>        → "1"  TTL 1h, idempotency on prepare-*
inft:meta:<tokenId>                 → JSON { rotations, lastRoot, lastUri }   debug
inft:reveal_nonce:<tokenId>:<nonce> → "1"  TTL 5m, idempotency on /reveal
inft:bidder_pubkey:<address>        → compressed secp256k1 pubkey, 33B hex   permanent (cache)
```

### Endpoints

All under `app/api/inft/oracle/*`. Internal-only: gated by `INFT_ORACLE_API_KEY` header. The frontend hits `app/api/inft/transfer/*` (user-facing layer with rate limiting + session-sig validation), which proxies to oracle endpoints.

| Method · Path | Auth | Body / Returns |
|---|---|---|
| `GET /key` | public | `{ oracleAddress, verifierAddress, defaultExpiresAt }` (60s cache) |
| `POST /seal-blob` | API key | `{ tokenIdPredicted, plaintext: object }` → `{ root, uri, mintProof, anchorTx }`. Anchors blob, returns mint proof. Does **not** mint on-chain. |
| `POST /prepare-transfer` | API key | `{ tokenId, bidder, sellerNonce }` → `{ proof, root_new, uri_new, sealedKey, anchorTxNew, sellerNonce }` |
| `POST /confirm-transfer` | API key | `{ tokenId, txHash, sellerNonce }` → `{ ok, rotations }` |
| `POST /prepare-merge` | API key | `{ mergedAgentId, src1: {tokenId}, src2: {tokenId}, mergedPlaintext, ownerPubkeySig: { nonce, expiresAt, sig } }` → `{ proof1, proof2, mergedRoot, mergedUri, anchorTxMerged }`. `ownerPubkeySig` is M's EIP-191 sig over `keccak256("inft-pubkey-register" \|\| nonce \|\| expiresAt)`; oracle ecrecovers to obtain M's pubkey, caches in `inft:bidder_pubkey:<M>` |
| `POST /confirm-merge` | API key | `{ mergedAgentId, txHash }` → `{ ok }` |
| `POST /reveal` | bearer of owner sig | `{ tokenId, ownerSig, nonce, expiresAt }` → `{ plaintext }` |

`POST /reveal` auth: owner signs `keccak256("inft-reveal" || tokenId || nonce || expiresAt)` (EIP-191). Oracle ecrecovers, checks `INFT.ownerOf(tokenId) == recovered`, marks nonce used, returns plaintext. 60s response cache keyed on `(tokenId, currentRoot)`.

### `prepare-transfer` algorithm

1. Validate `sellerNonce` not used.
2. Read `INFT.delegations[bidder][tokenId]`. Require `oracle == ORACLE && expiresAt > now`.
3. Recover bidder's secp256k1 pubkey from the original `Delegation` EIP-712 signature. (The signature was emitted in a `DelegationSet` event when `setDelegationFor` was called — oracle reads the event and recovers the pubkey from the sig payload. Pubkey is cached per bidder.)
4. Read `INFT.encryptedMemoryRoot[tokenId]` → `root_old`. Read `INFT.encryptedMemoryUri[tokenId]` → `uri_old`.
5. Fetch ciphertext from 0G Storage at `uri_old`. Decrypt with `currentAESKey` (read from Redis, KEK-decrypted). If `currentAESKey` is missing, abort — token was minted outside our oracle.
6. Generate fresh `K_new = crypto.randomBytes(16)`.
7. AES-128-GCM-encrypt the plaintext (which was either provided in mint or just-decrypted from the existing blob) → `ciphertext_new`.
8. Anchor `ciphertext_new` to 0G Storage via `lib/zg-storage.writeBlob` — get `root_new`. `uri_new = "og://" + root_new`.
9. ECIES-wrap `K_new` to bidder pubkey:
   - `ephemeralKey = secp256k1.randomKey()`
   - `sharedSecret = HKDF-SHA256(ECDH(ephemeralKey.priv, bidderPubkey), salt="", info="inft-key-wrap-v1", L=32)`
   - `(ivWrap, ct, tag) = AES-128-GCM(K_new, sharedSecret[0:16], iv=randomBytes(12))`
10. Build proof bytes per layout in §"AgentINFTVerifier.sol":
    - `accessibilityProof` = oracle ECDSA sig over `keccak256(root_new || root_old || nonce)` wrapped in EIP-191 (delegation path: oracle plays receiver).
    - `oracleAttestation` = oracle ECDSA sig over `keccak256(tokenId || root_old || root_new || sealedKey || keccak256(uri_new) || nonce)` wrapped in EIP-191.
    - `nonce` = `sellerNonce` (48 bytes).
    - `sealedKey` = first 16 bytes of `ct`.
11. Store pending: `Redis SET inft:pending:<tokenId>:<sellerNonce> = KEK-wrap(K_new) TTL 24h`. **Do not** rotate `inft:key:<tokenId>` yet.
12. Return `{ proof, root_new, uri_new, sealedKey, anchorTxNew, sellerNonce }`.

### `confirm-transfer` algorithm

1. Read receipt for `txHash`. Require `status == 1`.
2. Parse `Transferred(tokenId, from, to)` event — must match input `tokenId`.
3. Atomically: `Redis SET inft:key:<tokenId> = pending`, `DEL inft:pending:<tokenId>:<nonce>`, bump rotations counter.
4. Return `{ ok, rotations }`.

If chain tx never lands (or reverts), pending entry expires after 24h. `inft:key:<tokenId>` was never rotated, so the chain-side `encryptedMemoryRoot` and the oracle's `currentAESKey` stay in sync.

### Failure recovery

| Failure | Effect | Recovery |
|---|---|---|
| Step 7-8 fails (anchor) | No chain or Redis state changed | Retry |
| Step 11 fails (Redis) | No chain state changed | Retry; oracle still holds `K_old` |
| Chain tx reverts after `prepare-transfer` returned | Verifier marked `nonce` as used; pending entry holds `K_new` for 24h | Re-call `prepare-transfer` with fresh nonce; old pending GC'd |
| Bidder lost private key between bid and accept | Sealed key wrapped to lost pubkey; bidder cannot decrypt | Out of scope (same risk as any signed-transfer scheme) |
| Oracle pubkey rotation | Required: redeploy verifier with new `expectedOracle`; redeploy AgentINFT with new verifier | Same posture as any immutable-config upgrade |

### Operational keys

| Env var | Purpose | Where |
|---|---|---|
| `INFT_ORACLE_PK` | secp256k1 sk for oracle ECDSA sigs + KEK derivation | Vercel env (Production + Preview), backed up offline |
| `INFT_ORACLE_API_KEY` | bearer auth on internal API | Vercel env |
| `INFT_VERIFIER_ADDRESS` | post-deploy contract addr | Edge Config |
| `REDIS_URL` | already present | Vercel env (Upstash) |
| `ZG_GALILEO_RPC_URL`, `AGENT_PK` | already present (anchoring) | Vercel env |
| `SEPOLIA_RPC_URL`, `PRICEWATCH_PK` | already present (deploy + mint) | Vercel env |

## W1 off-chain flows

### Mint (initial seal)

```
Deployer → POST /api/inft/oracle/seal-blob
           body: { tokenIdPredicted, plaintext }
       O:  gen K0; AES-GCM encrypt; anchor to 0G → root0, uri0
           Redis SET inft:key:<tokenIdPredicted> ← KEK-wrap(K0)
           sign mintProof (EIP-191 over keccak256("inft-mint-v1" || root0 || nonce))
       ←   { root0, uri0, mintProof, anchorTx0 }

Deployer → INFT.mint(mintTo, agentId, mintProof)
       INFT: VERIFIER.verifyPreimage([mintProof]) → recovers oracle sig
             encryptedMemoryRoot[tokenId] = root0; uri = uri0
             memoryReencrypted[tokenId] = true
             emit AgentMinted, PublishedSealedKey
```

`tokenIdPredicted` is read from `INFT._nextTokenId` before the seal call. Race-free: deployer is the only minter (constructor guard preserved).

### Place bid

```
Bidder → GET /api/inft/oracle/key  →  { oracleAddress, defaultExpiresAt }

Bidder → wallet.signTypedData (EIP-712)
            Domain: { name: "AgentINFT", version: "1", chainId, verifyingContract: INFT }
            Type: Delegation { tokenId, oracle, expiresAt }
       ← delegationSig

Bidder → USDC.approve(BIDS, amount)              [tx 1, only if not already approved]

Bidder → BIDS.placeBid(tokenId, amount, expiresAt, delegationSig)   [tx 2]
       BIDS: INFT.setDelegationFor(msg.sender, tokenId, ORACLE, expiresAt, delegationSig)
                INFT: ecrecover EIP-712 hash → require recovered == bidder
                      delegations[bidder][tokenId] = Delegation(ORACLE, expiresAt)
                      emit DelegationSet
             USDC pull
             bids[tokenId][bidder] = Bid(...)
             emit BidPlaced
```

### Accept bid

```
1. Seller → POST /api/inft/transfer/prepare
            body: { tokenId, bidder }
   API:  read INFT.ownerOf(tokenId) — must equal session wallet
         require fresh seller sig over (tokenId, bidder, nonce)
   API → POST /api/inft/oracle/prepare-transfer (internal)
   O:   per "prepare-transfer algorithm" §
   ←   { proof, root_new, uri_new, sealedKey, anchorTxNew }

2. Seller → BIDS.acceptBid(tokenId, bidder, proof)
   BIDS: existing escrow checks
         INFT.transferWithProof(bidder, tokenId, proof)
            INFT: VERIFIER.verifyTransferValidity([proof])
                  require output.oldDataHash == encryptedMemoryRoot[tokenId]
                  require delegations[bidder][tokenId].oracle == ORACLE
                       && delegations[bidder][tokenId].expiresAt > now
                  encryptedMemoryRoot[tokenId] = root_new; uri = uri_new
                  memoryReencrypted[tokenId] = true
                  set transient _proofPath = true
                  _safeTransfer(seller, bidder, tokenId)   # _update fires, clears agentWallet
                  emit Transferred, MemoryReencrypted, PublishedSealedKey
         USDC.safeTransfer(seller, amount)
         emit BidAccepted

3. Frontend → POST /api/inft/transfer/confirm
              body: { tokenId, txHash }
   O:   verify receipt; rotate Redis inft:key:<tokenId> ← K_new

4. (Optional) Bidder → POST /api/inft/transfer/reveal
                       body: { tokenId, ownerSig, nonce, expiresAt }
   O:   ecrecover ownerSig; check INFT.ownerOf == recovered
        decrypt with K_new; return plaintext
```

UI mitigation for the 30–60s 0G Storage anchor in step 1: precompute the proof on modal-open intent. By the time the seller clicks "confirm transfer," step 1 has already completed.

### Direct transferFrom (bypass)

```
Anyone → INFT.safeTransferFrom(from, to, tokenId)
       INFT: _update runs (transient _proofPath unset)
             from != 0 && to != 0 && agentId != 0:
               IDENTITY.clearAgentWalletOnTransfer(agentId)
               memoryReencrypted[tokenId] = false
               emit MemoryStaled(tokenId)
             standard ERC-721 transfer completes
```

`encryptedMemoryRoot` unchanged — new owner cannot decrypt. UI shows red "memory stale" badge with explanation. Recovery: previous owner volunteers `K_old` (off-chain), or transfers back via `transferWithProof`.

### Merge

```
Owner of both source INFTs (= merged-agent owner M):

M → INFT.setDelegation(srcToken1, ORACLE, expiresAt)        [tx 1, M as bidder for MERGER]
    Wait — receiver is MERGER, not M. Use the EIP-712 sig variant:

M → INFT.setDelegationByOwner(MERGER, srcToken1, ORACLE, expiresAt)     [tx 1]
M → INFT.setDelegationByOwner(MERGER, srcToken2, ORACLE, expiresAt)     [tx 2]
   (msg.sender == M == ownerOf(srcToken1) == ownerOf(srcToken2);
    no EIP-712 sig because MERGER is a contract with no key)

M → POST /api/inft/transfer/prepare-merge
    body: { mergedAgentId, src1, src2, mergedPlaintext }
   O: decrypt both blobs; gen K_m; encrypt mergedPlaintext; anchor → root_m, uri_m
      recover M's pubkey from ownerPubkeySig in body
      cache inft:bidder_pubkey:<M> for future use
      build proof1 (newDataHash = root_m, sealedKey = ECIES(K_m, M_pubkey))
      build proof2 (newDataHash = root_m, sealedKey = ECIES(K_m, M_pubkey))
        (proof.receiver recovers as ORACLE for both; receiver-of-key = M)
      pending stash both
   ← { proof1, proof2, root_m, uri_m, anchorTxMerged }

M → MERGER.recordMerge(mergedAgentId, srcAgent1, srcToken1, proof1,
                        srcAgent2, srcToken2, proof2, root_m, uri_m)        [tx 3]
   MERGER: INFT.transferWithProof(MERGER, srcToken1, proof1)
           INFT.transferWithProof(MERGER, srcToken2, proof2)
           require proof1.newDataHash == proof2.newDataHash == root_m
           record merge as before
           emit AgentsMerged

M → POST /api/inft/transfer/confirm-merge
   O: rotate K1, K2 → archive; mark MERGER as custodian of K_m
```

The "MERGER has no pubkey" problem is resolved by **path 2** from the brainstorm: M (the merged-agent owner) posts a fresh delegation specifically authorizing ORACLE to act as receiver-proxy for the MERGER contract. Oracle wraps the merged blob's `K_m` to **M's** pubkey (recovered from M's delegation sigs), even though the on-chain receiver field of the proof recovers as ORACLE. M can decrypt the merged blob post-merge via `/reveal`.

## W1 frontend changes

### `/inft` page (extend existing)

Three new blocks added to existing structure:

- **INFT card additions:** rotations counter, fresh/stale badge (`memoryReencrypted`), verifier address, oracle address.
- **Bid table additions:** delegation column (`✓ until <date>` or `✗ invalid`).
- **Reveal panel** (NEW): visible only to current owner. Single button, prompts wallet sig, displays plaintext JSON.

### `/inft` flows

- **Place bid (single user click):** wallet signs Delegation (EIP-712, free), then USDC approve (if needed), then `BIDS.placeBid(...)`. 1–2 wallet popups.
- **Accept bid (3-step modal):** prepare (precomputed on intent) → wallet confirm acceptBid → confirm-transfer (background). UI shows green ticks per step; modal closes on success.
- **Reveal (1 click + 1 sig):** wallet signs reveal payload → API call → JSON rendered.

### `/merger` page (extend existing)

Each "select source INFT" row gets an inline "delegate oracle" prompt. Both delegations completed → "prepare merge" enabled → 3-step modal identical to accept-bid but with proof1 + proof2 → final `MERGER.recordMerge`.

### New internal API routes

| Path | Purpose |
|---|---|
| `app/api/inft/transfer/prepare/route.ts` | Rate-limited proxy → oracle prepare-transfer; auth via session wallet sig |
| `app/api/inft/transfer/confirm/route.ts` | Proxy → oracle confirm; verifies tx receipt server-side too |
| `app/api/inft/transfer/reveal/route.ts` | Proxy → oracle reveal; checks `INFT.ownerOf` matches sig |
| `app/api/inft/transfer/prepare-merge/route.ts` | Merger flavor of prepare |
| `app/api/inft/transfer/confirm-merge/route.ts` | Merger flavor of confirm |
| `app/api/inft/oracle/key/route.ts` | Public proxy to internal oracle `/key` (60s cache) |

### New shared components

- `components/delegation-button.tsx` — wraps wallet sign-typed-data for the `Delegation` schema. Reused by bid + merger.
- `components/transfer-modal.tsx` — 3-step modal. Reused by accept-bid + merge.
- `components/memory-stale-badge.tsx` — small badge.
- `components/reveal-panel.tsx` — owner-only, fetches and displays plaintext.

### `lib/inft.ts` changes

- Extend `InftView` type with `memoryReencrypted: boolean`, `rotations: number` (read from `inft:meta:<tokenId>` via oracle GET, NOT from chain — chain doesn't track rotations), `verifierAddress: Address`, `oracleAddress: Address`.
- Add `mintInftWithProof` to call new `mint(to, agentId, proof)` shape.
- Add `transferWithProof` lib helper that orchestrates prepare → wallet → confirm.

---

# W2 — Dynamic CCIP-Read ENS resolver (issue #10 plan A)

## W2 architecture

```
                    Wallet / dApp / wagmi
                              │
                              │  resolve("tradewise.agentlab.eth", "text", "last-seen-at")
                              ▼
         L1 ENS Registry (Sepolia) — points agentlab.eth at our resolver
                              │
                              │  resolver.resolve(name, data) reverts:
                              │  OffchainLookup(this, [gatewayURL], callData, callback, extra)
                              ▼
       Wagmi/viem auto-handles the revert per EIP-3668; HTTPS GET to gateway
                              │
                              ▼
    ┌─────────────────────────────────────────────────────────────┐
    │  CCIP-Read gateway @ /api/ens-gateway/[sender]/[data].json  │
    │  - decode ABI-encoded resolve call                          │
    │  - look up agent + record key (last-seen-at, reputation, …) │
    │  - read data (Redis / on-chain / W1 oracle Redis)           │
    │  - sign keccak256(expires \|\| sender \|\| data \|\| result) │
    │    with INFT_GATEWAY_PK (W2-α posture)                      │
    │  - return { data: signedResponse }                          │
    └─────────────────────────────────────────────────────────────┘
                              │
                              │  signed response
                              ▼
        OffchainResolver.resolveWithProof(response, extraData)
        ecrecover signed payload → must equal expectedGatewaySigner
        decode the value, return to caller
```

ENSIP-10 wildcard: the resolver implements `resolve(bytes name, bytes data)` instead of per-record functions. **One resolver serves every `*.agentlab.eth` and every nested `*.*.agentlab.eth`** (e.g. `agent-eoa.tradewise.agentlab.eth` from W3) without registering each label in the L1 registry.

Trust posture: **W2-α (trusted gateway).** Compromise of `INFT_GATEWAY_PK` ⇒ malicious resolution. Worst-case impact: stale telemetry, never falsified ownership (ownership stays in the L1 registry which the resolver doesn't override). Future swap to β: replace resolver's `resolveWithProof` body with a storage-proof verifier, gateway becomes a pure relay. No client-side change.

## W2 contract surface

### `OffchainResolver.sol` (new)

Sepolia, deployed under `agentlab.eth` resolver slot.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IExtendedResolver {
    function resolve(bytes memory name, bytes memory data)
        external view returns (bytes memory);
}

interface ISupportsInterface {
    function supportsInterface(bytes4 interfaceID) external pure returns (bool);
}

contract OffchainResolver is IExtendedResolver, ISupportsInterface {
    string[] public urls;                       // gateway URLs (CCIP-Read array)
    address public expectedGatewaySigner;       // INFT_GATEWAY_PK address
    address public immutable owner;             // for setting urls / signer

    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );

    constructor(string[] memory _urls, address _signer) {
        urls = _urls;
        expectedGatewaySigner = _signer;
        owner = msg.sender;
    }

    function resolve(bytes calldata name, bytes calldata data)
        external view returns (bytes memory)
    {
        bytes memory callData = abi.encode(name, data);
        revert OffchainLookup(
            address(this),
            urls,
            callData,
            this.resolveWithProof.selector,
            callData
        );
    }

    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external view returns (bytes memory)
    {
        // response = abi.encode(uint64 expires, bytes result, bytes signature)
        (uint64 expires, bytes memory result, bytes memory sig)
            = abi.decode(response, (uint64, bytes, bytes));
        require(block.timestamp <= expires, "expired");

        bytes32 messageHash = keccak256(abi.encodePacked(
            hex"1900",                          // EIP-191 v0
            address(this),                      // resolver
            expires,
            keccak256(extraData),                // request fingerprint
            keccak256(result)                    // claimed result
        ));
        address signer = _ecrecover(messageHash, sig);
        require(signer == expectedGatewaySigner, "invalid signer");
        return result;
    }

    function setUrls(string[] calldata _urls) external {
        require(msg.sender == owner, "not owner");
        urls = _urls;
    }
    function setSigner(address _signer) external {
        require(msg.sender == owner, "not owner");
        expectedGatewaySigner = _signer;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IExtendedResolver).interfaceId
            || id == 0x9061b923   // ENSIP-10 wildcard
            || id == 0x01ffc9a7;  // ERC-165
    }

    function _ecrecover(bytes32 hash, bytes memory sig) private pure returns (address) {
        // standard r/s/v split, omitted for brevity
    }
}
```

Static records (`agent-card`, `description`, `url`) the gateway encodes from a mostly-immutable JSON in Edge Config; dynamic records are computed live (table below). Resolver itself doesn't care which is which.

### Wiring on agentlab.eth

After deploy: call `ENS.setResolver(namehash("agentlab.eth"), OFFCHAIN_RESOLVER_ADDR)` from the agentlab.eth owner wallet (one-shot; we run it from PRICEWATCH_PK if it owns agentlab.eth, else from our ENS-app session). The existing per-subname text records on `tradewise.agentlab.eth` and `pricewatch.agentlab.eth` become inert — wildcard resolver wins for descendants only if they don't have their own resolver set. To make them switch: clear their resolver via `ENS.setResolver(node, address(0))` or set to OFFCHAIN_RESOLVER_ADDR explicitly.

## W2 gateway server

Endpoint: `app/api/ens-gateway/[sender]/[data].json/route.ts` — matches the EIP-3668 GET URL pattern (`{gatewayURL}/{sender}/{data}.json`). POST also supported per spec.

### Records served

| Record key | Source | Static / Dynamic | Notes |
|---|---|---|---|
| `agent-card` | Edge Config `agentlab:cards:<label>` | Static (per-agent JSON) | Existing; migrated from setText |
| `description` | Edge Config | Static | Existing |
| `url` | Edge Config | Static | Existing |
| `last-seen-at` | Redis `agent:<id>:last-seen` (set by `/api/a2a/jobs`) | **Dynamic** | Replaces hourly heartbeat |
| `reputation-summary` | On-chain `ReputationRegistry.feedbackCount(agentId)` + 0G compute summary (cached 5min) | **Dynamic** | Replaces reputation-cache cron |
| `current-price-tier` | Edge Config (per-agent) | Static | New; sourced from x402 pricing config |
| `outstanding-bids` | On-chain `AgentBids.biddersCount + sum amounts` | **Dynamic** | New |
| `compliance-status` | On-chain `ComplianceManifest` event scan | **Dynamic** (5min cache) | New |
| `tvl` | Sum: AgentBids escrow + pricewatch deposits | **Dynamic** | New |
| `avatar` | Computed: `eip155:11155111/erc721:<INFT>/<tokenId>` from W1 INFT contract | **Dynamic** | Cross-link with W1 |
| `inft-tradeable` | On-chain `AgentINFT.memoryReencrypted(tokenId)` (W1 cross-link) | **Dynamic** | "1" or "0" — stale flag exposed via ENS |
| `memory-rotations` | W1 oracle's Redis `inft:meta:<tokenId>.rotations` (read via `/api/inft/oracle/key`-style internal route) | **Dynamic** | Cross-link with W1 |
| ENSIP-25 `agent-registration[eip155:11155111:0x…]` | Computed per-chain from agent's contract addresses | **Dynamic** | Existing; migrated dynamic |

### Gateway algorithm

```
1. Parse path /[sender]/[data].json — sender is the resolver address, data
   is hex-encoded callData = abi.encode(name, resolveCalldata).
2. Decode `name` (DNS wire format) → label like "tradewise.agentlab.eth".
3. Decode `resolveCalldata` selector + args:
     0x59d1d43c = text(bytes32 node, string key)
     0x3b3b57de = addr(bytes32 node)
     0xf1cb7e06 = addr(bytes32 node, uint256 coinType)   // ENSIP-9
     0xbc1c58d1 = contenthash(bytes32 node)
4. Look up agent by label:
     "tradewise.agentlab.eth" → agentId=1
     "pricewatch.agentlab.eth" → agentId=2
     "agent-eoa.tradewise.agentlab.eth" → wallet 0x7a83…20A3 (W3 cross-link)
   Cache the label→{agentId,wallet} resolution in Redis 30m.
5. Compute the result per the table above. For dynamic records that miss
   in cache, do the read; cache 30s–5min depending on volatility.
6. ABI-encode the result per the resolve function signature:
     text → string
     addr/addr(coinType) → bytes
     contenthash → bytes
7. Build the signed response:
     expires = now + 60s (response valid for 1 minute)
     extraData = the original callData (echoed back)
     messageHash = keccak256(0x1900 || sender || expires
                              || keccak256(extraData) || keccak256(result))
     sig = ECDSA-sign(messageHash, INFT_GATEWAY_PK)   // EIP-191
     responseBytes = abi.encode(expires, result, sig)
8. Return { data: "0x" + responseBytes }
```

### Failure modes

| Failure | Effect | Recovery |
|---|---|---|
| Underlying read fails (chain RPC, Redis) | 500; client retries via fallback gateway URL | Add a second gateway URL in `urls[]` |
| Signer key compromise | Malicious resolver responses | Rotate via `setSigner`; W2-α single-key risk, accepted |
| Gateway down | Wallet shows "name resolution failed" | Acceptable; static fallbacks via on-chain `setText` are out of scope (the whole point is to eliminate them) |
| Response expired between sign and verify | Client retries | 60s window covers normal latency |

### Operational keys

| Env var | Purpose | Where |
|---|---|---|
| `INFT_GATEWAY_PK` | secp256k1 sk for gateway response signing | Vercel env, backed up offline |
| `ENS_RESOLVER_ADDRESS` | the OffchainResolver address | Edge Config |
| `ENS_GATEWAY_URLS` | array of gateway URLs (the Vercel deployment URL + any fallbacks) | Edge Config |

## W2 frontend changes

The frontend mostly *gets simpler*, not bigger. Wagmi/viem already handle CCIP-Read transparently. Net changes:

- Replace direct fetches to `/api/agent/last-seen` and similar internal endpoints with `useEnsText({ name, key: "last-seen-at" })` hooks. Live data is now an ENS resolution.
- Add a `lib/ens-records.ts` helper that returns the parsed/cached record value with TypeScript types per record.
- The `/inft` page reads `inft-tradeable` and `memory-rotations` via ENS — proves the gateway works for the demo screenshot.
- Add a `/ens-debug` page (small, gated): shows the raw `OffchainLookup` revert + the fetched gateway URL + the signed response + ecrecovered signer. **Demo gold.** ~80 LOC.

---

# W3 — Reverse resolution + ENSIP-19 multichain primary names (issue #10 plan B)

## W3 wallets and labels

| Wallet | Label | Sepolia | Base Sepolia |
|---|---|---|---|
| Agent EOA `0x7a83…20A3` | `agent-eoa.tradewise.agentlab.eth` | primary + addr | ENSIP-19 primary |
| Pricewatch deployer `0xBf5d…2469` | `pricewatch-deployer.agentlab.eth` | primary + addr | ENSIP-19 primary |
| KeeperHub Turnkey `0xB28c…6539` (read from KH `get_wallet_integration`) | `keeperhub.agentlab.eth` | primary + addr | ENSIP-19 primary |
| Validator `0x0134…83F6` | `validator.agentlab.eth` | primary + addr | ENSIP-19 primary |

## W3 contracts touched

No new contracts. We use the existing ENS infrastructure on Sepolia:

- **PublicResolver** (Sepolia, standard) — sets the forward `addr` record per label. With W2's wildcard resolver in place, this might be unnecessary for forward resolution if W2 dynamically returns the wallet for `addr(...)`. **Cleaner: W2 gateway returns `addr` for `agent-eoa.tradewise.agentlab.eth` etc.; we don't need to write any forward records on-chain.**
- **ReverseRegistrar** (Sepolia + Base Sepolia) — sets the `name(address)` reverse record. Each wallet calls `setName(label)` from its own EOA. This requires each wallet has gas. KeeperHub helps here: a workflow can fund the wallet, then call `setName` from it via Turnkey.
- **L2 ReverseRegistrar** (Base Sepolia, ENSIP-19) — same flow, Base Sepolia chain.

## W3 setup flow (KeeperHub-driven)

KeeperHub workflow `ENSPrimaryNameSetter` does this for each `{wallet, label}` pair:

```
1. Read agentlab.eth subname registry. If `<label>.agentlab.eth` doesn't exist:
   call ENS.setSubnodeOwner(agentlab.eth, label, agentlabOwner) from PRICEWATCH_PK.
2. (forward addr) — skipped, W2 gateway handles it.
3. Reverse on Sepolia: from `<wallet>` (Turnkey signs if KH-managed wallet),
   call ReverseRegistrar.setName(`<label>.agentlab.eth`).
4. Reverse on Base Sepolia (ENSIP-19): from `<wallet>` on Base Sepolia,
   call L2ReverseRegistrar.setName(`<label>.agentlab.eth`).
5. Idempotency: if reverse record already matches, skip step 3/4.
```

For wallets we don't control via Turnkey (PRICEWATCH_PK on Vercel env), we run an equivalent script `scripts/setup-primary-names.ts` that does steps 3-4 from local with the env private key. The KeeperHub workflow is for the Turnkey-managed KeeperHub wallet specifically; everything else goes through scripts.

## W3 frontend impact

Zero. ENS reverse resolution is automatic — wagmi/MetaMask/Etherscan all just start showing the names. The only UI change is in the `/keeperhub` page: instead of rendering the raw Turnkey address, we render `useEnsName({ address: turnkeyAddress }).data` with the address as fallback.

---

# KeeperHub orchestration (cross-cutting)

## What KeeperHub adds (4 new workflows)

### 1. `ENSPrimaryNameSetter` (W3 workhorse)

- **Trigger:** webhook from `/api/dev/setup-primary-name` (manual button on /keeperhub) OR programmatic from the new-agent-onboarding flow.
- **Input:** `{ wallet: address, label: string, chains: ["sepolia", "base-sepolia"] }`
- **Steps:** Web3 Read (current reverse name), if mismatched then Web3 Write to ReverseRegistrar.setName per chain. Each chain a separate node.
- **Why KeeperHub:** Idempotent + cross-chain + retriggerable from the dashboard. Replaces ~120 LOC of TS.

### 2. `ENSAvatarSync` (W2 ↔ W1 cross-link)

- **Trigger:** webhook from `/api/inft/transfer/confirm` (W1) AND from oracle's `seal-blob` (initial mint).
- **Input:** `{ ensName, tokenId, contract, chainId }`
- **Steps:** Web3 Write `PublicResolver.setText(node, "avatar", "eip155:<chain>/erc721:<contract>/<tokenId>")`. Single tx, no branching.
- **Note:** The W2 gateway *also* computes `avatar` dynamically from chain reads, so this workflow is a belt-and-suspenders for clients that don't go through the gateway. Optional but cheap.

### 3. `GatewayCacheInvalidator` (W2 freshness)

- **Trigger:** chain event indexer (we add a small `app/api/dev/event-firehose/route.ts` that subscribes to chain events via viem and POSTs to KeeperHub on every relevant event).
  - Events: `AgentINFT.MemoryReencrypted`, `AgentINFT.MemoryStaled`, `AgentBids.BidPlaced/BidAccepted/BidWithdrawn`, `ReputationRegistry.FeedbackAccepted`, `ComplianceManifest.<events>`.
- **Input:** `{ event, agentId, tokenId? }`
- **Steps:** HTTP POST to gateway's `/api/ens-gateway/cache/invalidate` with the relevant cache keys. Gateway clears Redis entries.
- **Why KeeperHub:** debouncing + retry across flaky webhook attempts. We could do this from the indexer directly, but the workflow gives us logs and a UI to inspect.

### 4. `OnboardAgent` (W1 + W2 + W3 unified setup)

- **Trigger:** dashboard button "Onboard new agent."
- **Input:** `{ agentName, agentDomain, agentEoa, agentWallet, sealedMemoryPlaintext }`
- **Steps:**
  1. Call `IdentityRegistryV2-b.registerByDeployer(agentEoa, agentDomain, agentWallet)` from PRICEWATCH_PK
  2. POST `/api/inft/oracle/seal-blob` with `{ tokenIdPredicted, plaintext: sealedMemoryPlaintext }` → mintProof
  3. Call `AgentINFT.mint(agentEoa, agentId, mintProof)` from PRICEWATCH_PK
  4. Call `ENS.setSubnodeOwner(agentlab.eth, agentName, agentlabOwner)` if not present
  5. Trigger `ENSAvatarSync` for the new INFT
  6. Trigger `ENSPrimaryNameSetter` for `{agent-eoa.<agentName>.agentlab.eth, agentEoa}` if EOA is Turnkey-managed
- **Why KeeperHub:** orchestration of 6 cross-system steps with retry/logging. **This is the demo highlight workflow.** Click one button, see seven txs land in sequence with live status. Replaces ~250 LOC of bespoke onboarding code in `scripts/`.

## What KeeperHub deletes (2 existing workflows)

| Workflow ID | Old purpose | Why deleted |
|---|---|---|
| `KEEPERHUB_WORKFLOW_ID_HEARTBEAT` (env var, current `Heartbeat (webhook-triggered, push from x402)`) | setText `last-seen-at` on every paid x402 quote | W2 gateway serves `last-seen-at` live from Redis; setText is wasted gas |
| `KEEPERHUB_WORKFLOW_ID_REPUTATION_CACHE` | setText `reputation-summary` on diff | W2 gateway computes on-the-fly with 5min cache |

`KEEPERHUB_WORKFLOW_ID_SWAP` (the swap workflow) and `KEEPERHUB_WORKFLOW_ID_COMPLIANCE_ATTEST` are unaffected.

## Webhook trigger map

```
/api/a2a/jobs (paid quote)              ──▶  Redis SET agent:<id>:last-seen=now()
                                              (gateway picks up next request)
                                        ──▶  KeeperHub `KEEPERHUB_WORKFLOW_ID_SWAP` (existing)

/api/inft/oracle/seal-blob (mint)       ──▶  KeeperHub `ENSAvatarSync`

/api/inft/transfer/confirm (transfer)   ──▶  KeeperHub `ENSAvatarSync`
                                        ──▶  KeeperHub `GatewayCacheInvalidator`

/api/dev/event-firehose (chain events)  ──▶  KeeperHub `GatewayCacheInvalidator`

/api/dev/setup-primary-name (manual)    ──▶  KeeperHub `ENSPrimaryNameSetter`

/keeperhub Onboard button               ──▶  KeeperHub `OnboardAgent` (orchestrates 6 steps)
```

## Operational keys for KeeperHub additions

| Env var | Purpose | Where |
|---|---|---|
| `KEEPERHUB_WORKFLOW_ID_PRIMARY_NAME` | new workflow ID | Edge Config |
| `KEEPERHUB_WORKFLOW_ID_AVATAR_SYNC` | new workflow ID | Edge Config |
| `KEEPERHUB_WORKFLOW_ID_GATEWAY_INVALIDATE` | new workflow ID | Edge Config |
| `KEEPERHUB_WORKFLOW_ID_ONBOARD_AGENT` | new workflow ID | Edge Config |

(`KEEPERHUB_WORKFLOW_ID_HEARTBEAT` and `KEEPERHUB_WORKFLOW_ID_REPUTATION_CACHE` are removed from env.)

---

# Migration plan (package-wide)

## W1 existing on-chain state

| Contract | Address | Status |
|---|---|---|
| IdentityRegistryV2 (V2-a) | `0xe398…2056` | **keep**, but new INFT does **not** use it. Stays bound to the old INFT for wallet-clear callbacks (irrelevant going forward). Other downstream contracts (Reputation, Credit, IPO, SLA) keep using V2-a. |
| AgentINFT (old) | `0x2452…4EB6` | **abandon**. Stays callable but the dashboard points elsewhere. |
| AgentBids (old) | per `sepolia-bids.json` | **abandon**. |
| AgentMerger (old) | per `sepolia-merger.json` | **abandon**. |
| **IdentityRegistryV2-b** (new) | filled by `forge script` step 2 below | New deploy. Mirrors agentId=1 registration of `tradewise.agentlab.eth`. Bound only to new INFT. |
| **AgentINFTVerifier** (new) | filled by `forge script` step 3 | New deploy. |
| **AgentINFT** (new) | filled by `forge script` step 4 | New deploy. Constructor: (V2-b, baseURI, verifier, oracle). |
| **AgentBids** (new) | filled by `forge script` step 6 | New deploy. Constructor: (newINFT, sepoliaUSDC). |
| **AgentMerger** (new) | filled by `forge script` step 7 | New deploy. Constructor: (V2-b, ReputationRegistry, newINFT). |

**Rationale for V2-b vs reusing V2-a:** V2-a's `inft` field is one-shot (`require(inft == address(0), "already set")`) and already bound to the old INFT. Two clean paths: (1) deploy fresh V2-b, mirror agentId=1 registration; (2) skip the wallet-clear feature on the new INFT. Path (1) preserves the §4.4 anti-laundering story end-to-end. Reputation continuity is preserved by *coincidence*: ReputationRegistry stores `feedbackCount[agentId]` keyed on agentId, and agentId=1 has the same numeric value in V2-a and V2-b. ReputationRegistry's immutable binding to V2-a is irrelevant because no contract verifies "agent exists in registry X" at feedback-read time.

## W1 existing memory blob handling

The old `tokenId=1` was minted with a *plaintext* memory blob (not encrypted). It has no AES-128 key in Redis — it never went through an oracle. Path: re-mint clean on the new contract. The same plaintext (from `scripts/mint-inft.ts`) is fed to `seal-blob` to produce the initial encrypted blob + `K1`. New INFT is `tokenId=1` on the new address. Old INFT becomes a museum piece referenced from the spec.

## W2 existing ENS state

| Record | Today | After |
|---|---|---|
| `agentlab.eth` resolver | unset (defaults to ENS PublicResolver) | OffchainResolver address |
| `tradewise.agentlab.eth` resolver | PublicResolver, with text records set by hourly cron | OffchainResolver (set explicitly to win over the wildcard if needed); existing static text records become inert |
| `pricewatch.agentlab.eth` resolver | same | same |
| `<other>.agentlab.eth` (any subname registered) | none | resolved via wildcard, no per-subname registration needed |

**Risk:** if `agentlab.eth` is owned by a wallet we don't control end-to-end (it was registered for the hackathon — confirm ownership before deploy). Resolution: read `ENS.owner(namehash("agentlab.eth"))` and confirm equals one of our deployer wallets. If not, this becomes an out-of-scope blocker.

## W3 existing wallet state

No wallets currently have reverse names set. New wallet (KeeperHub Turnkey) needs gas on Sepolia + Base Sepolia for the reverse `setName` calls. Funding from `FUNDING_HUB_PK` per the existing distribute pattern.

## Deploy sequence (package-wide)

```
Pre-flight checks
0.  Verify agentlab.eth ownership:
       cast call $ENS_REGISTRY 'owner(bytes32)' $(cast namehash agentlab.eth)
    Result must equal a wallet whose private key is in our env (PRICEWATCH_PK or
    the agentlab.eth registrar wallet). If not, ABORT — escalate ownership before
    any contract deploy.

W1 contracts (Sepolia)
1.  forge build
2.  forge script DeployIdentityRegistryV2 --rpc-url $SEPOLIA_RPC_URL --broadcast
    → V2-b address; immediately call registerByDeployer(agentAddress, "tradewise.agentlab.eth", agentWallet)
3.  forge script DeployAgentINFTVerifier --rpc-url $SEPOLIA_RPC_URL --broadcast
    → constructor: (oracle = INFT_ORACLE_PK address)
4.  forge script DeployINFT --rpc-url $SEPOLIA_RPC_URL --broadcast
    → constructor: (V2-b, baseURI, verifier, oracle)
5.  V2-b.setInft(newINFT)
6.  forge script DeployAgentBids --rpc-url $SEPOLIA_RPC_URL --broadcast
7.  forge script DeployAgentMerger --rpc-url $SEPOLIA_RPC_URL --broadcast
    → constructor: (V2-b, ReputationRegistry, newINFT)

W2 contracts (Sepolia)
8.  forge script DeployOffchainResolver --rpc-url $SEPOLIA_RPC_URL --broadcast
    → constructor: (urls=["https://hackagent-nine.vercel.app/api/ens-gateway"], signer=INFT_GATEWAY_PK_addr)
9.  ENS.setResolver(namehash("agentlab.eth"), OFFCHAIN_RESOLVER) from agentlab.eth owner
10. (Optional) ENS.setResolver for tradewise/pricewatch subnames to OFFCHAIN_RESOLVER explicitly

Off-chain config
11. pnpm tsx scripts/sync-abis.ts
12. pnpm tsx scripts/write-edge-config.ts sepolia
13. Vercel env: set INFT_ORACLE_PK, INFT_ORACLE_API_KEY, INFT_GATEWAY_PK (production + preview)

W1 mint
14. pnpm tsx scripts/mint-inft.ts
    → calls oracle seal-blob, gets mintProof, mints under agentId=1 in V2-b

W3 KeeperHub workflows (one-time provisioning)
15. pnpm tsx scripts/setup-keeperhub-workflows.ts
    → creates ENSPrimaryNameSetter, ENSAvatarSync, GatewayCacheInvalidator, OnboardAgent
    → writes their IDs into Edge Config
    → deletes Heartbeat + ReputationCache workflows

W3 primary names
16. pnpm tsx scripts/setup-primary-names.ts
    → sets reverse for AGENT_PK / PRICEWATCH_PK / VALIDATOR_PK / PRICEWATCH_PK on Sepolia + Base Sepolia
17. KeeperHub trigger ENSPrimaryNameSetter for the Turnkey wallet

Smoke tests
18. /inft renders new memory root, badge "fresh", rotations=0
19. dig +short TXT tradewise.agentlab.eth (or wagmi useEnsText) returns LIVE last-seen-at from Redis
20. Etherscan shows "agent-eoa.tradewise.agentlab.eth" instead of 0x7a83…
```

## Rollout flag

None. The new INFT is at a new address; the old `/inft` simply points at the new contract via Edge Config. The W2 resolver flip is reversible by `ENS.setResolver(... )` back to the old PublicResolver if catastrophic. W3 reverse names are additive and don't break anything if wrong; just unset.

# Test plan (package-wide)

Three layers, in dependency order. Each layer must pass before the next.

## Forge unit tests

### W1

`AgentINFTVerifier.t.sol` (new):
- `test_verifyTransferValidity_validProof_recoversReceiver`
- `test_verifyTransferValidity_invalidOracleSig_reverts`
- `test_verifyTransferValidity_replayBlocked` (reuse nonce → revert)
- `test_verifyTransferValidity_wrongFlagBits_reverts`
- `test_verifyTransferValidity_truncatedProof_reverts`
- `test_verifyPreimage_mintFlow`
- `test_verifyPreimage_invalidOracleSig_reverts`

`AgentINFT.t.sol` (extend):
- `test_transferWithProof_happyPath_directReceiver`
- `test_transferWithProof_happyPath_delegationReceiver`
- `test_transferWithProof_oldRootMismatch_reverts`
- `test_transferWithProof_delegationExpired_reverts`
- `test_transferWithProof_undelegatedReceiver_reverts`
- `test_transferWithProof_notOwner_reverts` (front-running guard)
- `test_transferFrom_setsMemoryStale_emitsMemoryStaled`
- `test_setDelegation_byBidder`
- `test_setDelegationFor_validSigForwarded`
- `test_setDelegationFor_invalidSig_reverts`
- `test_setDelegationFor_expiresAtBoundsCheck`
- `test_setDelegationByOwner_onlyOwner`
- `test_setDelegationByOwner_storesDelegation_happyPath`

`AgentBids.t.sol` (extend):
- `test_placeBid_forwardsDelegation`
- `test_placeBid_invalidDelegationSig_reverts_USDCNotPulled`
- `test_acceptBid_threadsProofToInft_atomic`
- `test_acceptBid_invalidProof_reverts_USDCStaysEscrowed`
- `test_acceptBid_emits_correct_events`

`AgentMerger.t.sol` (extend):
- `test_recordMerge_requiresMatchingNewRoots`
- `test_recordMerge_dualProofs_happyPath`
- `test_recordMerge_invalidProof_reverts`

### W2

`OffchainResolver.t.sol` (new):
- `test_resolve_revertsWithOffchainLookup_correctParams`
- `test_resolveWithProof_validSignature_returnsResult`
- `test_resolveWithProof_invalidSignature_reverts`
- `test_resolveWithProof_expired_reverts`
- `test_resolveWithProof_extraDataMismatch_reverts`
- `test_supportsInterface_extendedResolverAndWildcard`
- `test_setSigner_onlyOwner`

### W3

No new contracts → no Forge tests for W3. Tested at the integration layer.

## Off-chain integration tests

### W1: `scripts/test-inft-oracle-e2e.ts` (new)

End-to-end against deployed Sepolia + real Galileo storage. Mirrors `scripts/zg-prod-lib-test.ts` posture. Steps:

1. seal-blob → mint
2. set delegation (bidder = test wallet 2)
3. place bid
4. prepare-transfer
5. acceptBid (chain tx, mined)
6. confirm
7. reveal (decrypt back to original plaintext) — assert `deepEqual(input, decrypted)`
8. Direct `transferFrom` to a third wallet, assert `memoryReencrypted == false` and reveal fails

Must print `ALL GREEN`.

### W2: `scripts/test-ens-gateway-e2e.ts` (new)

End-to-end CCIP-Read against deployed Sepolia + live gateway. Steps:

1. `viem.getEnsText({ name: "tradewise.agentlab.eth", key: "last-seen-at" })` — wagmi-style high-level call, exercises full CCIP-Read.
2. Manually decode the OffchainLookup revert from a low-level `eth_call`, verify `urls[]` and `callData`.
3. Call gateway URL directly, assert returned `{ data }` is well-formed.
4. Call resolver's `resolveWithProof(response, extraData)` via `eth_call`, assert it returns the expected result and doesn't revert.
5. Tamper signature (flip a byte) → assert revert "invalid signer."
6. Set `expires` to past → assert revert "expired."
7. Wildcard test: `getEnsText({ name: "agent-eoa.tradewise.agentlab.eth", key: "addr" })` resolves to wallet without that subname being registered.
8. Cross-link test: `getEnsText({ name: "tradewise.agentlab.eth", key: "inft-tradeable" })` returns "1" while `memoryReencrypted == true`, then "0" after a `transferFrom` bypass (W1 cross-link).

Must print `ALL GREEN`.

### W3: `scripts/test-primary-names-e2e.ts` (new)

After `setup-primary-names.ts` runs:

1. `viem.getEnsName({ address: AGENT_PK_ADDR, chainId: sepolia })` returns `agent-eoa.tradewise.agentlab.eth`.
2. Same for Base Sepolia (ENSIP-19).
3. `viem.getEnsAvatar({ name: "tradewise.agentlab.eth" })` returns the INFT URI (W2 cross-link).

## KeeperHub workflow tests

For each new workflow (`ENSPrimaryNameSetter`, `ENSAvatarSync`, `GatewayCacheInvalidator`, `OnboardAgent`):

1. `kh.execute_workflow` with valid input — assert `status: completed`, expected on-chain effects (e.g. reverse name set, text record updated).
2. Re-trigger with the same input — assert idempotent (no duplicate txs, status: completed).
3. Trigger with invalid input — assert clean failure with `error.message` populated.

Run via `scripts/test-keeperhub-e2e.ts` (new, mirrors existing `scripts/check-keeperhub.ts` posture).

## Manual UI walkthrough (Playwright MCP)

### W1
1. Connect wallet 1, view /inft (owner = wallet 1).
2. Connect wallet 2, place bid → see 1-tx UX, delegation event in Etherscan.
3. Reconnect wallet 1, accept bid → see 3-step modal, all checks tick.
4. After mining, reconnect wallet 2, click reveal → see plaintext.
5. Direct-transfer to wallet 3, see "stale" badge.

### W2
6. Visit `/ens-debug?name=tradewise.agentlab.eth&key=last-seen-at` → see OffchainLookup revert + gateway URL + signed response + ecrecovered signer matches `INFT_GATEWAY_PK_addr`.
7. /inft page reads `memory-rotations` via ENS lookup, value updates after a transfer (cache invalidation works).

### W3
8. Etherscan tx page for any AGENT_PK tx now displays `agent-eoa.tradewise.agentlab.eth`.
9. MetaMask account list shows ENS names for connected wallets that match.
10. /keeperhub page shows `keeperhub.agentlab.eth` instead of raw Turnkey hex.

# Open risks tracked, none unresolved

## W1
- **Oracle availability is single-point-of-failure for transfer flows.** If the Vercel function is down, no new transfers complete. Acceptable for a hackathon demo. Production answer: redundant oracle replicas with shared Redis.
- **Front-running on `transferWithProof`:** the proof's nonce + `usedNonces` mapping prevents replay, but a watcher could see the proof in mempool and submit it before the seller. The proof's accessibility sig binds to `(newRoot, oldRoot, nonce)` only — it does not bind to a `from` address. **Resolution:** add `require(_isAuthorized(_ownerOf(tokenId), msg.sender, tokenId), "not owner/approved")` to `transferWithProof`. (`AgentBids.acceptBid` already checks owner.)
- **Bidder pubkey recovery** depends on the Delegation EIP-712 signature being indexable. Oracle subscribes to `DelegationSet` events and persists `bidder → pubkey` cache. If oracle is bootstrapped fresh, backfills by reading event history.

## W2
- **`agentlab.eth` ownership.** Setup step requires owning the parent name. **Verify before deploy:** `cast call $ENS_REGISTRY 'owner(bytes32)' $(cast namehash agentlab.eth)` must equal a wallet we control. If not, blocker — escalate before any contract deploy.
- **Gateway downtime ⇒ resolution failure.** No on-chain fallback. Mitigations: (a) deploy gateway behind Vercel's auto-redundancy; (b) `urls[]` array supports multiple gateways — add a Cloudflare worker mirror as cheap fallback. Mark as v2 if time-pressed.
- **CCIP-Read isn't supported in every wallet.** wagmi/viem/ethers/MetaMask 11+ all do it; older wallets show "name resolution failed." Acceptable for a hackathon (judges run modern wallets).
- **Signed responses leak data the gateway should treat as private.** Records like `last-seen-at` reveal agent activity to anyone who can pay rate-limit costs. By design — ENS records are public. Don't put secrets in dynamic records.

## W3
- **ReverseRegistrar address differs per chain.** Need to look up correct address for Base Sepolia vs Sepolia. Resolution: hardcode in `scripts/setup-primary-names.ts` using the canonical addresses from ENS docs.
- **Turnkey wallet may not support arbitrary contract calls.** Verify `setName` works through KeeperHub's wallet integration before scoping the workflow. Resolution: do a one-off test transfer via `kh.execute_contract_call` first (low risk).

## KeeperHub
- **Workflow definitions stored centrally on KeeperHub.** Re-creating workflows in a fresh org requires re-running `setup-keeperhub-workflows.ts`. Document the `scripts/setup-keeperhub-workflows.ts` as the source of truth; do not edit workflows manually in the dashboard.

# Out of scope tracked, none unresolved

- TEE attestation hardware (W1 oracle is EOA; W2 gateway is EOA).
- ERC-7857 `clone()`, `authorizeUsage()`.
- Cross-chain INFT transfers.
- W2-β (storage-proof verifier). Deferred.
- Namechain migration (issue #10 plan C).
- ENS NameWrapper / fuse-locked subnames.
- Selling subnames as NFTs in AgentBids.
- CI gating for forge tests (run locally only).
- Gas optimization beyond fitting the proof in one calldata blob.
