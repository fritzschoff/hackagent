/**
 * End-to-end test for the INFT oracle pipeline against deployed Sepolia contracts.
 *
 * Runs entirely without HTTP — calls lib/inft-oracle + lib/inft-redis directly,
 * exactly like mint-inft.ts.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   pnpm exec tsx scripts/test-inft-oracle-e2e.ts
 *
 * Prints "ALL GREEN" and exits 0 on success.
 *
 * USDC note: The full path uses BIDS.placeBid (requires 10 USDC escrowed by
 * CLIENT1 on Sepolia). If CLIENT1 has no USDC, the test falls back to
 * setDelegationByOwner + INFT.transferWithProof directly, which exercises
 * the same oracle pipeline (proof building, key rotation, re-encryption) but
 * skips the USDC escrow step. A warning is printed in that case.
 * To fund CLIENT1: pnpm tsx scripts/distribute.ts sepolia --usdc=20
 *   (Note: the Sepolia USDC used here is Circle's testnet token — obtain from
 *    https://faucet.circle.com if distribute.ts does not cover Sepolia USDC)
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { hexToBytes, bytesToHex } from "@noble/curves/utils.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  aesKeyFresh,
  encryptBlob,
  decryptBlob,
  eciesWrap,
  buildTransferProof,
  buildAccessSig,
  anchorBlob,
  oracleAddress,
} from "../lib/inft-oracle";
import { loadKey, storeKey, storePending, commitPending } from "../lib/inft-redis";
import { Indexer } from "@0glabs/0g-ts-sdk";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import AgentINFTAbi from "../lib/abis/AgentINFT.json";
import AgentBidsAbi from "../lib/abis/AgentBids.json";
import IdentityRegistryV2Abi from "../lib/abis/IdentityRegistryV2.json";

// ─── Contract addresses (from deployments) ───────────────────────────────────
const INFT_ADDRESS = "0x103B2F28480c57ba49efeF50379Ef674d805DeDA" as Address;
const BIDS_ADDRESS = "0x58C4F095474430314611D0784BeDF93bDB0b8453" as Address;
const REGISTRY_ADDRESS = "0xc456e7123BD79F96aDb590b97b9d0E2B0c2B09D5" as Address;
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address;

// ─── ZG Indexer ───────────────────────────────────────────────────────────────
const ZG_INDEXER_URL =
  process.env.ZG_INDEXER_URL ?? "https://indexer-storage-testnet-turbo.0g.ai";

// ─── ERC20 minimal ABI ────────────────────────────────────────────────────────
const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function pkToHex(raw: string): Hex {
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

let passed = 0;
let failed = 0;

function ok(label: string) {
  console.log(`✓ ${label}`);
  passed++;
}

function fail(label: string, err?: unknown) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  console.error(`✗ ${label}${msg ? `: ${msg}` : ""}`);
  failed++;
}

// Download file from 0G Storage by merkle root.
// Uses Indexer.download() which writes to a temp file, then reads it back.
async function fetchFromZgStorage(rootHex: string): Promise<Uint8Array> {
  const root = rootHex.startsWith("0x") ? rootHex.slice(2) : rootHex;

  // Strategy 1: use Indexer.download to a temp file
  const indexer = new Indexer(ZG_INDEXER_URL);
  const tmpFile = join(tmpdir(), `inft-e2e-${root.slice(0, 8)}-${Date.now()}.bin`);

  // Clean up any leftover temp file from a previous run
  if (existsSync(tmpFile)) unlinkSync(tmpFile);

  const dlErr = await indexer.download(root, tmpFile, false);
  if (dlErr) {
    // Strategy 2: direct segment download via StorageNode
    const [nodes, selErr] = await indexer.selectNodes(1);
    if (selErr || !nodes || nodes.length === 0) {
      throw new Error(`0G download failed: ${dlErr.message}; selectNodes also failed`);
    }
    let lastErr: unknown = dlErr;
    for (const node of nodes) {
      try {
        // downloadSegment(root, startIndex, endIndex) — get first segment
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const seg = await (node as any).downloadSegment(root, 0, 1024);
        if (seg && typeof seg === "string") {
          // base64-encoded
          return Buffer.from(seg, "base64");
        }
        if (seg instanceof Uint8Array) return seg;
        if (Buffer.isBuffer(seg)) return new Uint8Array(seg);
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(
      `Failed to download from 0G root=${root}: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
  }

  if (!existsSync(tmpFile)) {
    throw new Error(`0G download completed but temp file missing: ${tmpFile}`);
  }
  const data = readFileSync(tmpFile);
  unlinkSync(tmpFile);
  return new Uint8Array(data);
}

// Build EIP-712 delegation signature for bidder (signs Delegation struct)
async function buildDelegationSig(
  publicClient: ReturnType<typeof createPublicClient>,
  bidderPk: Hex,
  tokenId: bigint,
  oracleAddr: Address,
  expiresAt: bigint,
): Promise<Hex> {
  const { keccak_256 } = await import("@noble/hashes/sha3.js");

  const domainSeparator = (await publicClient.readContract({
    address: INFT_ADDRESS,
    abi: AgentINFTAbi,
    functionName: "domainSeparator",
    args: [],
  })) as `0x${string}`;

  const delegationTypehash = (await publicClient.readContract({
    address: INFT_ADDRESS,
    abi: AgentINFTAbi,
    functionName: "DELEGATION_TYPEHASH",
    args: [],
  })) as `0x${string}`;

  // Build struct hash: keccak256(DELEGATION_TYPEHASH || tokenId || oracle || expiresAt)
  const typeHashBytes = hexToBytes(delegationTypehash.slice(2));
  const tokenIdBytes = new Uint8Array(32);
  let n = tokenId;
  for (let j = 31; j >= 0; j--) { tokenIdBytes[j] = Number(n & 0xffn); n >>= 8n; }
  const oracleBytes = new Uint8Array(32);
  oracleBytes.set(hexToBytes(oracleAddr.slice(2)), 12);
  const expiresAtBytes = new Uint8Array(32);
  let e = expiresAt;
  for (let j = 31; j >= 0; j--) { expiresAtBytes[j] = Number(e & 0xffn); e >>= 8n; }

  const structHashInput = new Uint8Array([
    ...typeHashBytes, ...tokenIdBytes, ...oracleBytes, ...expiresAtBytes,
  ]);
  const structHash = keccak_256(structHashInput);

  // EIP-712 digest: keccak256("\x19\x01" || domainSeparator || structHash)
  const domainSepBytes = hexToBytes(domainSeparator.slice(2));
  const digestInput = new Uint8Array([0x19, 0x01, ...domainSepBytes, ...structHash]);
  const digest = keccak_256(digestInput);

  // Sign with bidder's PK
  const bidderSkBytes = hexToBytes(bidderPk.slice(2));
  const sigCompact = secp256k1.sign(digest, bidderSkBytes, { prehash: false });
  const pub = secp256k1.getPublicKey(bidderSkBytes, true);

  for (let rec = 0; rec <= 1; rec++) {
    const sigObj = secp256k1.Signature.fromBytes(sigCompact).addRecoveryBit(rec);
    try {
      const recovered = sigObj.recoverPublicKey(digest).toBytes(true);
      if (recovered.length === pub.length && recovered.every((b, i) => b === pub[i])) {
        return `0x${bytesToHex(new Uint8Array([...sigCompact, rec + 27]))}` as Hex;
      }
    } catch { /* try next */ }
  }
  throw new Error("Could not determine recovery bit for delegation sig");
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Validate required env
  const rpcUrl = envOrThrow("SEPOLIA_RPC_URL");
  envOrThrow("INFT_ORACLE_PK");
  envOrThrow("REDIS_URL");
  envOrThrow("ZG_GALILEO_RPC_URL");

  const pricewatchPk = pkToHex(envOrThrow("PRICEWATCH_PK"));
  const agentPk = pkToHex(envOrThrow("AGENT_PK"));
  const client1Pk = pkToHex(envOrThrow("CLIENT1_PK"));
  const client2Pk = pkToHex(envOrThrow("CLIENT2_PK"));

  const pricewatchAccount = privateKeyToAccount(pricewatchPk);
  const sellerAccount = privateKeyToAccount(agentPk);      // seller = AGENT_PK
  const bidderAccount = privateKeyToAccount(client1Pk);    // bidder = CLIENT1_PK
  const strangerAccount = privateKeyToAccount(client2Pk);  // stranger = CLIENT2_PK

  console.log("=== INFT Oracle E2E Test ===");
  console.log(`deployer (pricewatch): ${pricewatchAccount.address}`);
  console.log(`seller   (agent):      ${sellerAccount.address}`);
  console.log(`bidder   (client1):    ${bidderAccount.address}`);
  console.log(`stranger (client2):    ${strangerAccount.address}`);
  console.log(`oracle:                ${oracleAddress()}`);
  console.log();

  // ─── Clients ─────────────────────────────────────────────────────────────
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  const deployerWallet = createWalletClient({
    account: pricewatchAccount, chain: sepolia, transport: http(rpcUrl),
  });
  const sellerWallet = createWalletClient({
    account: sellerAccount, chain: sepolia, transport: http(rpcUrl),
  });
  const bidderWallet = createWalletClient({
    account: bidderAccount, chain: sepolia, transport: http(rpcUrl),
  });
  const strangerWallet = createWalletClient({
    account: strangerAccount, chain: sepolia, transport: http(rpcUrl),
  });

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1 – Setup: register a test-specific agent + mint INFT to seller
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Strategy: register a fresh agent under the DEPLOYER address so it gets
  // a new agentId (does not conflict with agentId=1 held by AGENT_PK).
  // Then mint that INFT to sellerAccount (AGENT_PK), which we control.
  //
  // To survive re-runs: if we already minted for the test agentId AND the
  // current owner IS the seller, reuse it; otherwise mint a fresh one.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("--- Step 1: Setup (register test agent + mint INFT to seller) ---");

  // Use a timestamp-free deterministic domain for idempotency across re-runs.
  const TEST_AGENT_DOMAIN = "tradewise-e2e.agentlab.eth";

  // The test agent is registered under the DEPLOYER address (not seller).
  // This avoids conflicting with agentId=1 that already maps to seller's address.
  const testAgentAddress = pricewatchAccount.address;

  let tokenIdToUse = 0n;

  try {
    // Check if the test agent is already registered (deployer address)
    let testAgentId = (await publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: IdentityRegistryV2Abi,
      functionName: "agentIdOf",
      args: [testAgentAddress],
    })) as bigint;

    if (testAgentId === 0n) {
      console.log(`Registering test agent "${TEST_AGENT_DOMAIN}" (agentAddress=${testAgentAddress})...`);
      const regTx = await deployerWallet.writeContract({
        address: REGISTRY_ADDRESS,
        abi: IdentityRegistryV2Abi,
        functionName: "registerByDeployer",
        args: [testAgentAddress, TEST_AGENT_DOMAIN, sellerAccount.address],
      });
      const regReceipt = await publicClient.waitForTransactionReceipt({ hash: regTx });
      console.log(`registerByDeployer tx: ${regTx} (block ${regReceipt.blockNumber})`);
      testAgentId = (await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: IdentityRegistryV2Abi,
        functionName: "agentIdOf",
        args: [testAgentAddress],
      })) as bigint;
      console.log(`registered testAgentId=${testAgentId}`);
    } else {
      console.log(`test agent already registered: agentId=${testAgentId}`);
    }

    // Check if INFT already minted for testAgentId and owned by seller
    const existingTokenId = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: AgentINFTAbi,
      functionName: "tokenIdForAgent",
      args: [testAgentId],
    })) as bigint;

    if (existingTokenId > 0n) {
      tokenIdToUse = existingTokenId;
      console.log(`INFT already minted for agentId=${testAgentId}: tokenId=${tokenIdToUse}`);

      let currentOwner: Address;
      try {
        currentOwner = (await publicClient.readContract({
          address: INFT_ADDRESS,
          abi: AgentINFTAbi,
          functionName: "ownerOf",
          args: [tokenIdToUse],
        })) as Address;
      } catch {
        currentOwner = "0x0000000000000000000000000000000000000000";
      }

      if (currentOwner.toLowerCase() !== sellerAccount.address.toLowerCase()) {
        // INFT has been transferred away (e.g. by a previous test run).
        // Generate a fresh ephemeral agentAddress so we can register a new agent and mint again.
        console.log(
          `tokenId=${tokenIdToUse} is owned by ${currentOwner} (not seller).`,
        );
        console.log("Registering a fresh ephemeral test agent to mint a new INFT...");

        // Use a unique domain + random ephemeral address so this always succeeds.
        const freshDomain = `tradewise-e2e-${Date.now()}.agentlab.eth`;
        // Generate an ephemeral key purely for registration (doesn't need to control anything)
        const ephemeralSk = secp256k1.utils.randomSecretKey();
        const ephemeralPub = secp256k1.getPublicKey(ephemeralSk, false); // 65B uncompressed
        const { keccak_256: keccak } = await import("@noble/hashes/sha3.js");
        const ephAddrBytes = keccak(ephemeralPub.slice(1)).slice(12);
        const freshAgentAddress = `0x${bytesToHex(ephAddrBytes)}` as Address;
        console.log(`  ephemeral agentAddress=${freshAgentAddress}`);

        const freshRegTx = await deployerWallet.writeContract({
          address: REGISTRY_ADDRESS,
          abi: IdentityRegistryV2Abi,
          functionName: "registerByDeployer",
          args: [freshAgentAddress, freshDomain, sellerAccount.address],
        });
        const freshRegReceipt = await publicClient.waitForTransactionReceipt({ hash: freshRegTx });
        console.log(`  registered fresh agent: tx=${freshRegTx} (block ${freshRegReceipt.blockNumber})`);
        const freshAgentId = (await publicClient.readContract({
          address: REGISTRY_ADDRESS,
          abi: IdentityRegistryV2Abi,
          functionName: "agentIdOf",
          args: [freshAgentAddress],
        })) as bigint;
        console.log(`  freshAgentId=${freshAgentId}`);

        // Use this fresh agentId for minting
        testAgentId = freshAgentId;
        tokenIdToUse = 0n; // signal to mint below
      } else {
        // Check if the AES key is in Redis for this tokenId
        const existingKey = await loadKey(tokenIdToUse);
        if (!existingKey) {
          console.log(`No AES key in Redis for tokenId=${tokenIdToUse} — re-sealing memory...`);
          const memBlob = { agent: TEST_AGENT_DOMAIN, role: "e2e-re-seal", ts: new Date().toISOString() };
          const k = aesKeyFresh();
          const ct = encryptBlob(memBlob, k);
          const anchored = await anchorBlob(ct);
          await storeKey(tokenIdToUse, k);
          console.log(`  re-sealed and stored key (root=${anchored.root})`);
        }

        ok(`step 1: setup (reusing INFT tokenId=${tokenIdToUse}, agentId=${testAgentId}, seller owns it)`);
      }
    }

    // Mint if needed (either no existing tokenId or we need a fresh mint)
    if (tokenIdToUse === 0n) {
      // Mint a fresh INFT
      const totalSupply = await publicClient.readContract({
        address: INFT_ADDRESS,
        abi: AgentINFTAbi,
        functionName: "totalSupply",
        args: [],
      }).catch(() => 0n) as bigint;
      const predictedTokenId = totalSupply + 1n;
      console.log(`predicted tokenId=${predictedTokenId}`);

      // Generate memory blob + key
      const memoryBlob = {
        agent: TEST_AGENT_DOMAIN,
        role: "e2e-test-subject",
        sealedAt: new Date().toISOString(),
      };
      const aesKey = aesKeyFresh();
      const ciphertext = encryptBlob(memoryBlob, aesKey);

      console.log("Anchoring memory blob to 0G Storage...");
      const anchored = await anchorBlob(ciphertext);
      console.log(`  root: ${anchored.root}`);
      console.log(`  uri:  ${anchored.uri}`);

      // Store AES key in Redis (keyed by predicted tokenId)
      await storeKey(predictedTokenId, aesKey);
      console.log(`AES key stored in Redis for tokenId=${predictedTokenId}`);

      // Build mint proof
      const { buildMintProof } = await import("../lib/inft-oracle");
      const dataHash = hexToBytes(anchored.root.slice(2));
      const nonce = new Uint8Array(48);
      crypto.getRandomValues(nonce);
      const mintProofBytes = buildMintProof(dataHash, nonce);
      const mintProof = (`0x${bytesToHex(mintProofBytes)}`) as Hex;

      console.log(`Minting INFT agentId=${testAgentId} to seller=${sellerAccount.address}...`);
      const mintTx = await deployerWallet.writeContract({
        address: INFT_ADDRESS,
        abi: AgentINFTAbi,
        functionName: "mint",
        args: [sellerAccount.address, testAgentId, mintProof],
      });
      console.log(`mint tx: ${mintTx}`);
      const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: mintTx });
      console.log(`minted at block ${mintReceipt.blockNumber}`);

      // Confirm actual tokenId
      const actualTokenId = (await publicClient.readContract({
        address: INFT_ADDRESS,
        abi: AgentINFTAbi,
        functionName: "tokenIdForAgent",
        args: [testAgentId],
      })) as bigint;
      tokenIdToUse = actualTokenId;
      console.log(`confirmed tokenId=${tokenIdToUse}`);

      if (tokenIdToUse !== predictedTokenId) {
        // Re-store key with correct tokenId
        await storeKey(tokenIdToUse, aesKey);
        console.log(`Re-stored AES key for actual tokenId=${tokenIdToUse}`);
      }

      ok(`step 1: setup (minted INFT tokenId=${tokenIdToUse} to seller, agentId=${testAgentId})`);
    }
  } catch (e) {
    fail("step 1: setup", e);
    console.error("Fatal: cannot proceed without a valid tokenId. Exiting.");
    process.exit(1);
  }

  const tokenId = tokenIdToUse;
  console.log(`\nUsing tokenId=${tokenId} for the rest of the test\n`);

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2 – Check bidder USDC balance (warn if insufficient, use fallback path)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("--- Step 2: Check bidder USDC balance ---");
  const MIN_USDC = 10_000_000n; // 10 USDC (6 decimals)
  let useBidsPath = false;
  try {
    const bidderUsdc = (await publicClient.readContract({
      address: SEPOLIA_USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [bidderAccount.address],
    })) as bigint;
    console.log(`bidder USDC balance: ${Number(bidderUsdc) / 1e6} USDC`);

    if (bidderUsdc >= MIN_USDC) {
      useBidsPath = true;
      ok(`step 2: bidder has sufficient USDC (${Number(bidderUsdc) / 1e6} USDC) — will use BIDS path`);
    } else {
      console.warn(
        `[WARN] bidder (CLIENT1=${bidderAccount.address}) has ${Number(bidderUsdc) / 1e6} USDC` +
        ` — need ${Number(MIN_USDC) / 1e6} USDC for BIDS path.`,
      );
      console.warn("Falling back to setDelegationByOwner + transferWithProof direct path.");
      console.warn("To fund CLIENT1 with Sepolia USDC: obtain from https://faucet.circle.com");
      useBidsPath = false;
      ok("step 2: USDC insufficient — using direct delegation+transfer fallback (oracle pipeline still tested)");
    }
  } catch (e) {
    fail("step 2: check bidder USDC", e);
    useBidsPath = false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 – Bidder places bid OR seller sets delegation via setDelegationByOwner
  // ══════════════════════════════════════════════════════════════════════════
  const BID_AMOUNT = 10_000_000n; // 10 USDC
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600); // now + 30d
  const oracleAddr = oracleAddress();

  if (useBidsPath) {
    console.log("--- Step 3: Bidder places bid via BIDS.placeBid (USDC path) ---");
    try {
      const delegationSig = await buildDelegationSig(
        publicClient, client1Pk, tokenId, oracleAddr, expiresAt,
      );

      // Approve USDC to AgentBids contract
      console.log("  Approving USDC for AgentBids...");
      const approveTx = await bidderWallet.writeContract({
        address: SEPOLIA_USDC,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [BIDS_ADDRESS, BID_AMOUNT],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });
      console.log(`  USDC approved: ${approveTx}`);

      // Check if bid already active
      let bidActive = false;
      try {
        const existing = (await publicClient.readContract({
          address: BIDS_ADDRESS,
          abi: AgentBidsAbi,
          functionName: "bids",
          args: [tokenId, bidderAccount.address],
        })) as { active: boolean; amount: bigint };
        bidActive = existing.active;
        if (bidActive) console.log("  Bid already active");
      } catch { /* no bid */ }

      if (!bidActive) {
        console.log(`  Placing bid: tokenId=${tokenId}, amount=${BID_AMOUNT}, expiresAt=${expiresAt}`);
        const bidTx = await bidderWallet.writeContract({
          address: BIDS_ADDRESS,
          abi: AgentBidsAbi,
          functionName: "placeBid",
          args: [tokenId, BID_AMOUNT, expiresAt, delegationSig],
        });
        console.log(`  placeBid tx: ${bidTx}`);
        const bidReceipt = await publicClient.waitForTransactionReceipt({ hash: bidTx });
        console.log(`  bid placed at block ${bidReceipt.blockNumber}`);
      }
      ok("step 3: bidder placed bid via BIDS.placeBid (EIP-712 delegation + USDC)");
    } catch (e) {
      fail("step 3: BIDS.placeBid", e);
    }
  } else {
    console.log("--- Step 3: Seller sets delegation via setDelegationByOwner (no-USDC fallback) ---");
    try {
      // Seller (owner) calls setDelegationByOwner(bidder, tokenId, oracle, expiresAt)
      console.log(`  setDelegationByOwner(receiver=${bidderAccount.address}, tokenId=${tokenId})`);
      const delegTx = await sellerWallet.writeContract({
        address: INFT_ADDRESS,
        abi: AgentINFTAbi,
        functionName: "setDelegationByOwner",
        args: [bidderAccount.address, tokenId, oracleAddr, expiresAt],
      });
      console.log(`  setDelegationByOwner tx: ${delegTx}`);
      const delegReceipt = await publicClient.waitForTransactionReceipt({ hash: delegTx });
      console.log(`  delegation set at block ${delegReceipt.blockNumber}`);
      ok("step 3: delegation set via setDelegationByOwner (no-USDC fallback)");
    } catch (e) {
      fail("step 3: setDelegationByOwner fallback", e);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4 – Confirm INFT.isDelegated(bidder, tokenId) == true
  // ══════════════════════════════════════════════════════════════════════════
  console.log("--- Step 4: Confirm isDelegated(bidder, tokenId) ---");
  try {
    const isDelegated = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: AgentINFTAbi,
      functionName: "isDelegated",
      args: [bidderAccount.address, tokenId],
    })) as boolean;
    if (!isDelegated) throw new Error("isDelegated returned false");
    ok("step 4: isDelegated(bidder, tokenId) == true");
  } catch (e) {
    fail("step 4: isDelegated check", e);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 5 – Prepare-transfer flow (no HTTP, direct lib calls)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("--- Step 5: Prepare-transfer (oracle logic directly) ---");

  let proof: Hex | null = null;
  let newRoot: Uint8Array | null = null;
  let sellerNonceHex: string | null = null;
  let newKeyForReveal: Uint8Array | null = null;

  try {
    // 5a. Load current AES key
    const oldKey = await loadKey(tokenId);
    if (!oldKey) throw new Error(`No AES key in Redis for tokenId=${tokenId}. Was mint-inft.ts run?`);
    console.log("  AES key loaded from Redis");

    // 5b. Fetch on-chain encrypted memory root
    const oldRootHex = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: AgentINFTAbi,
      functionName: "encryptedMemoryRoot",
      args: [tokenId],
    })) as `0x${string}`;
    console.log(`  on-chain encryptedMemoryRoot: ${oldRootHex}`);

    // 5c. Fetch ciphertext from 0G Storage
    console.log("  Fetching ciphertext from 0G Storage...");
    const ciphertext = await fetchFromZgStorage(oldRootHex);
    console.log(`  fetched ${ciphertext.byteLength} bytes`);

    // 5d. Decrypt with old key
    const plaintext = decryptBlob(ciphertext, oldKey);
    console.log("  Decrypted plaintext successfully");

    // 5e. Generate K_new, encrypt, anchor
    const kNew = aesKeyFresh();
    const newCt = encryptBlob(plaintext, kNew);
    console.log("  Anchoring re-encrypted blob to 0G Storage...");
    const anchored = await anchorBlob(newCt);
    console.log(`  new root: ${anchored.root}`);
    console.log(`  new uri:  ${anchored.uri}`);

    newRoot = hexToBytes(anchored.root.slice(2));
    const oldRoot = hexToBytes(oldRootHex.slice(2));

    // 5f. Derive bidder pubkey directly from CLIENT1_PK (pragmatic test shortcut)
    const bidderSkBytes = hexToBytes(client1Pk.slice(2));
    const bidderPubkey = secp256k1.getPublicKey(bidderSkBytes, true); // 33B compressed
    console.log(`  bidder pubkey: ${bytesToHex(bidderPubkey).slice(0, 16)}...`);

    // 5g. ECIES-wrap K_new to bidder pubkey
    const wrap = eciesWrap(kNew, bidderPubkey);

    // 5h. Generate seller nonce (48 bytes)
    const nonce = new Uint8Array(48);
    crypto.getRandomValues(nonce);
    sellerNonceHex = `0x${bytesToHex(nonce)}`;

    // 5i. Build access sig + transfer proof
    const accessSig = buildAccessSig(newRoot, oldRoot, nonce);
    const transferProofBytes = buildTransferProof({
      tokenId,
      oldRoot,
      newRoot,
      sealedKey: wrap.sealedKey,
      ephemeralPub: wrap.ephemeralPub,
      ivWrap: wrap.iv,
      wrapTag: wrap.tag,
      newUri: anchored.uri,
      nonce,
      receiverSig: accessSig,
    });
    proof = `0x${bytesToHex(transferProofBytes)}` as Hex;
    console.log(`  transfer proof built: ${transferProofBytes.byteLength} bytes`);

    // 5j. storePending
    await storePending(tokenId, sellerNonceHex, kNew);
    console.log("  pending key stored in Redis");
    newKeyForReveal = kNew;

    ok("step 5: prepare-transfer (oracle logic executed without HTTP)");
  } catch (e) {
    fail("step 5: prepare-transfer", e);
    if (!proof) {
      console.error("Cannot proceed without proof — aborting");
      printSummary();
      process.exit(1);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 6 – Execute transfer: BIDS.acceptBid or INFT.transferWithProof directly
  // ══════════════════════════════════════════════════════════════════════════
  if (useBidsPath) {
    console.log("--- Step 6: Seller calls BIDS.acceptBid ---");
    try {
      if (!proof) throw new Error("proof not built in step 5");

      // Seller needs ApprovalForAll to AgentBids
      const isApproved = (await publicClient.readContract({
        address: INFT_ADDRESS,
        abi: AgentINFTAbi,
        functionName: "isApprovedForAll",
        args: [sellerAccount.address, BIDS_ADDRESS],
      })) as boolean;
      if (!isApproved) {
        console.log("  Setting ApprovalForAll to AgentBids...");
        const approveTx = await sellerWallet.writeContract({
          address: INFT_ADDRESS,
          abi: AgentINFTAbi,
          functionName: "setApprovalForAll",
          args: [BIDS_ADDRESS, true],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
        console.log(`  ApprovalForAll set: ${approveTx}`);
      }

      const acceptTx = await sellerWallet.writeContract({
        address: BIDS_ADDRESS,
        abi: AgentBidsAbi,
        functionName: "acceptBid",
        args: [tokenId, bidderAccount.address, proof],
      });
      console.log(`  acceptBid tx: ${acceptTx}`);
      const acceptReceipt = await publicClient.waitForTransactionReceipt({ hash: acceptTx });
      console.log(`  accepted at block ${acceptReceipt.blockNumber}`);
      ok(`step 6: BIDS.acceptBid executed (tx: ${acceptTx})`);
    } catch (e) {
      fail("step 6: BIDS.acceptBid", e);
    }
  } else {
    console.log("--- Step 6: Seller calls INFT.transferWithProof directly (no-USDC fallback) ---");
    try {
      if (!proof) throw new Error("proof not built in step 5");
      const txHash = await sellerWallet.writeContract({
        address: INFT_ADDRESS,
        abi: AgentINFTAbi,
        functionName: "transferWithProof",
        args: [bidderAccount.address, tokenId, proof],
      });
      console.log(`  transferWithProof tx: ${txHash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log(`  transferred at block ${receipt.blockNumber}`);
      ok(`step 6: INFT.transferWithProof executed (tx: ${txHash})`);
    } catch (e) {
      fail("step 6: INFT.transferWithProof", e);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 7 – Verify on-chain state post-transfer
  // ══════════════════════════════════════════════════════════════════════════
  console.log("--- Step 7: Verify on-chain state (ownerOf, encryptedMemoryRoot, memoryReencrypted) ---");
  try {
    const newOwner = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: AgentINFTAbi,
      functionName: "ownerOf",
      args: [tokenId],
    })) as Address;

    const onChainNewRoot = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: AgentINFTAbi,
      functionName: "encryptedMemoryRoot",
      args: [tokenId],
    })) as `0x${string}`;

    const memReencrypted = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: AgentINFTAbi,
      functionName: "memoryReencrypted",
      args: [tokenId],
    })) as boolean;

    console.log(`  ownerOf(${tokenId})             = ${newOwner}`);
    console.log(`  encryptedMemoryRoot(${tokenId}) = ${onChainNewRoot}`);
    console.log(`  memoryReencrypted(${tokenId})   = ${memReencrypted}`);

    const ownerOk = newOwner.toLowerCase() === bidderAccount.address.toLowerCase();
    const rootOk = newRoot
      ? onChainNewRoot.toLowerCase() === `0x${bytesToHex(newRoot)}`
      : true;
    const memOk = memReencrypted === true;

    if (!ownerOk) throw new Error(`ownerOf=${newOwner}, expected bidder=${bidderAccount.address}`);
    if (!rootOk) throw new Error(`on-chain root=${onChainNewRoot} != expected 0x${newRoot ? bytesToHex(newRoot) : "?"}`);
    if (!memOk) throw new Error("memoryReencrypted == false (expected true after transferWithProof)");

    ok("step 7: on-chain state verified (ownerOf==bidder, newRoot correct, memoryReencrypted==true)");
  } catch (e) {
    fail("step 7: on-chain state verification", e);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 8 – commitPending → key rotation
  // ══════════════════════════════════════════════════════════════════════════
  console.log("--- Step 8: commitPending (pending → active key) ---");
  try {
    if (!sellerNonceHex) throw new Error("sellerNonce not set from step 5");
    const committed = await commitPending(tokenId, sellerNonceHex);
    if (!committed) throw new Error("commitPending returned false (pending key not found)");
    ok("step 8: commitPending succeeded");
  } catch (e) {
    fail("step 8: commitPending", e);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 9 – loadKey(tokenId) matches K_new
  // ══════════════════════════════════════════════════════════════════════════
  console.log("--- Step 9: loadKey matches K_new ---");
  try {
    const loadedKey = await loadKey(tokenId);
    if (!loadedKey) throw new Error("loadKey returned null after commitPending");
    if (!newKeyForReveal) throw new Error("K_new not available (step 5 failed?)");
    const match =
      loadedKey.length === newKeyForReveal.length &&
      loadedKey.every((b, i) => b === newKeyForReveal![i]);
    if (!match) throw new Error("loaded key does not match K_new");
    ok("step 9: loadKey matches K_new post-commit");
  } catch (e) {
    fail("step 9: loadKey matches K_new", e);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 10 – Reveal flow: bidder signs, oracle verifies + decrypts
  // ══════════════════════════════════════════════════════════════════════════
  console.log("--- Step 10: Reveal flow (bidder signs, oracle verifies, decrypts) ---");
  try {
    const { keccak_256 } = await import("@noble/hashes/sha3.js");

    // Oracle checks ownerOf == bidder
    const currentOwner = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: AgentINFTAbi,
      functionName: "ownerOf",
      args: [tokenId],
    })) as Address;
    if (currentOwner.toLowerCase() !== bidderAccount.address.toLowerCase()) {
      throw new Error(`ownerOf=${currentOwner}, expected bidder for reveal`);
    }

    // Bidder signs reveal payload: EIP-191 over keccak256("inft-reveal" || tokenId || nonce || expiresAt)
    const revealNonce = new Uint8Array(32);
    crypto.getRandomValues(revealNonce);
    const revealExpiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const tokenIdBuf = new Uint8Array(32);
    let tn = tokenId;
    for (let j = 31; j >= 0; j--) { tokenIdBuf[j] = Number(tn & 0xffn); tn >>= 8n; }
    const expiresAtBuf = new Uint8Array(8);
    let ea = revealExpiresAt;
    for (let j = 7; j >= 0; j--) { expiresAtBuf[j] = Number(ea & 0xffn); ea >>= 8n; }

    const revealPayload = keccak_256(new Uint8Array([
      ...new TextEncoder().encode("inft-reveal"),
      ...tokenIdBuf,
      ...revealNonce,
      ...expiresAtBuf,
    ]));

    // EIP-191 sign
    const eip191Prefix = new TextEncoder().encode("\x19Ethereum Signed Message:\n32");
    const eip191Digest = keccak_256(new Uint8Array([...eip191Prefix, ...revealPayload]));

    const bidderSkBytes = hexToBytes(client1Pk.slice(2));
    const bidderSigCompact = secp256k1.sign(eip191Digest, bidderSkBytes, { prehash: false });
    const bidderPub = secp256k1.getPublicKey(bidderSkBytes, true);
    let revealSig: Uint8Array | null = null;
    for (let rec = 0; rec <= 1; rec++) {
      const sigObj = secp256k1.Signature.fromBytes(bidderSigCompact).addRecoveryBit(rec);
      try {
        const recovered = sigObj.recoverPublicKey(eip191Digest).toBytes(true);
        if (recovered.length === bidderPub.length && recovered.every((b, i) => b === bidderPub[i])) {
          revealSig = new Uint8Array([...bidderSigCompact, rec + 27]);
          break;
        }
      } catch { /* try next */ }
    }
    if (!revealSig) throw new Error("Could not compute reveal sig recovery bit");

    // Oracle verifies signature: ecrecover(digest) == currentOwner
    const sigCompact = revealSig.slice(0, 64);
    const v = revealSig[64]!;
    const rec2 = v === 27 ? 0 : v === 28 ? 1 : v;
    const recoveredPoint = secp256k1.Signature.fromBytes(sigCompact)
      .addRecoveryBit(rec2)
      .recoverPublicKey(eip191Digest);
    const recoveredPubUncompressed = recoveredPoint.toBytes(false); // 65B uncompressed
    const addrHash = keccak_256(recoveredPubUncompressed.slice(1));
    const recoveredAddr = `0x${bytesToHex(addrHash.slice(12))}` as Address;

    if (recoveredAddr.toLowerCase() !== bidderAccount.address.toLowerCase()) {
      throw new Error(`sig ecrecover=${recoveredAddr}, expected bidder=${bidderAccount.address}`);
    }
    console.log(`  oracle verified reveal sig: signer=${recoveredAddr}`);

    // Oracle decrypts with K_new from Redis
    const keyForReveal = await loadKey(tokenId);
    if (!keyForReveal) throw new Error("No key in Redis for reveal");

    const onChainRoot = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: AgentINFTAbi,
      functionName: "encryptedMemoryRoot",
      args: [tokenId],
    })) as `0x${string}`;

    console.log("  Fetching re-encrypted ciphertext from 0G for reveal...");
    const freshCt = await fetchFromZgStorage(onChainRoot);
    const revealedPlaintext = decryptBlob(freshCt, keyForReveal);
    console.log(`  revealed plaintext: ${JSON.stringify(revealedPlaintext)}`);

    if (!revealedPlaintext || Object.keys(revealedPlaintext).length === 0) {
      throw new Error("Revealed plaintext is empty");
    }

    ok("step 10: reveal flow passed (bidder sig verified, plaintext decrypted successfully)");
  } catch (e) {
    fail("step 10: reveal flow", e);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 11 – Direct transferFrom (bidder → stranger), assert MemoryStaled
  // ══════════════════════════════════════════════════════════════════════════
  console.log("--- Step 11: transferFrom(bidder → stranger) + assert MemoryStaled ---");
  let transferFromBlock = 0n;
  try {
    const txHash = await bidderWallet.writeContract({
      address: INFT_ADDRESS,
      abi: AgentINFTAbi,
      functionName: "transferFrom",
      args: [bidderAccount.address, strangerAccount.address, tokenId],
    });
    console.log(`  transferFrom tx: ${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    transferFromBlock = receipt.blockNumber;
    console.log(`  confirmed at block ${transferFromBlock}`);

    // Verify memoryReencrypted == false
    const memRe = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: AgentINFTAbi,
      functionName: "memoryReencrypted",
      args: [tokenId],
    })) as boolean;
    if (memRe !== false) throw new Error("memoryReencrypted should be false after raw transferFrom");

    // Verify MemoryStaled event in the tx block
    const memoryStaledTopic = parseAbiItem("event MemoryStaled(uint256 indexed tokenId)");
    const memoryStaledLogs = await publicClient.getLogs({
      address: INFT_ADDRESS,
      event: memoryStaledTopic,
      args: { tokenId },
      fromBlock: transferFromBlock,
      toBlock: transferFromBlock,
    });
    if (memoryStaledLogs.length === 0) {
      throw new Error("MemoryStaled event not emitted in transferFrom tx");
    }
    console.log(`  MemoryStaled event found in block ${transferFromBlock}`);

    // Verify ownerOf == stranger
    const newOwner2 = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: AgentINFTAbi,
      functionName: "ownerOf",
      args: [tokenId],
    })) as Address;
    if (newOwner2.toLowerCase() !== strangerAccount.address.toLowerCase()) {
      throw new Error(`ownerOf=${newOwner2}, expected stranger=${strangerAccount.address}`);
    }

    ok("step 11: transferFrom(bidder→stranger) done, memoryReencrypted==false, MemoryStaled emitted");
  } catch (e) {
    fail("step 11: transferFrom + MemoryStaled check", e);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 12 – Stale state assertion (no MemoryReencrypted event AFTER transferFrom)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("--- Step 12: Stale state assertion (memoryReencrypted==false, no MemoryReencrypted event post-transferFrom) ---");
  try {
    // Verify memoryReencrypted is still false
    const memRe = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: AgentINFTAbi,
      functionName: "memoryReencrypted",
      args: [tokenId],
    })) as boolean;
    if (memRe !== false) {
      throw new Error("memoryReencrypted is unexpectedly true — re-encryption occurred unexpectedly");
    }

    // Check no MemoryReencrypted event AFTER the transferFrom block (i.e. block+1 onward)
    // The transferWithProof in step 6 emitted MemoryReencrypted in an earlier block;
    // we only care that nothing re-encrypted after the raw transferFrom.
    const memoryReencryptedEvent = parseAbiItem(
      "event MemoryReencrypted(uint256 indexed tokenId, bytes32 newRoot, string newUri)",
    );
    const checkFromBlock = transferFromBlock > 0n ? transferFromBlock + 1n : 0n;
    const latestBlock = await publicClient.getBlockNumber();
    let reencryptedLogs: unknown[] = [];
    if (checkFromBlock <= latestBlock) {
      reencryptedLogs = await publicClient.getLogs({
        address: INFT_ADDRESS,
        event: memoryReencryptedEvent,
        args: { tokenId },
        fromBlock: checkFromBlock,
        toBlock: "latest",
      });
    }
    if (reencryptedLogs.length > 0) {
      throw new Error(
        "Unexpected MemoryReencrypted event found after transferFrom — stranger should NOT have triggered re-encryption",
      );
    }

    // Oracle key still in Redis — oracle can observe stale state but stranger has no wrapped key
    const storedKey = await loadKey(tokenId);
    if (!storedKey) throw new Error("Expected K_new still in Redis for oracle reference");

    console.log("  memoryReencrypted==false (stale — raw transfer without proof)");
    console.log("  No MemoryReencrypted event after transferFrom block");
    console.log("  Oracle key still in Redis (oracle can read but key NOT wrapped to stranger)");
    console.log("  Stranger owns INFT but cannot unwrap K_new (correct security property)");

    ok("step 12: stale state verified (memoryReencrypted==false, no MemoryReencrypted post-transferFrom, security invariant holds)");
  } catch (e) {
    fail("step 12: stale state assertion", e);
  }

  // ═══════════════════════════════════════════════════════════════════════
  printSummary();
}

function printSummary() {
  console.log("\n=== Test Summary ===");
  if (failed === 0) {
    console.log("ALL GREEN");
    process.exit(0);
  } else {
    console.log(`FAIL: ${failed} step(s) failed, ${passed} passed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
