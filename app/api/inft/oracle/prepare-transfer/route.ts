import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hexToBytes, bytesToHex } from "@noble/curves/utils.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { parseAbiItem, decodeAbiParameters } from "viem";
import {
  aesKeyFresh,
  encryptBlob,
  decryptBlob,
  eciesWrap,
  buildTransferProof,
  buildAccessSig,
  anchorBlob,
  oracleAddress,
} from "@/lib/inft-oracle";
import { loadKey, storePending } from "@/lib/inft-redis";
import { getRedis } from "@/lib/redis";
import { sepoliaPublicClient } from "@/lib/wallets";
import { getSepoliaAddresses } from "@/lib/edge-config";
import AgentINFTAbi from "@/lib/abis/AgentINFT.json";
import { Indexer } from "@0glabs/0g-ts-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZG_INDEXER_URL =
  process.env.ZG_INDEXER_URL ?? "https://indexer-storage-testnet-turbo.0g.ai";

const Body = z.object({
  tokenId: z.string().regex(/^\d+$/),
  bidder: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  // 48 bytes = 96 hex chars
  sellerNonce: z.string().regex(/^0x[a-fA-F0-9]{96}$/),
});

function checkApiKey(req: NextRequest): boolean {
  const key = process.env.INFT_ORACLE_API_KEY;
  if (!key) return false;
  return req.headers.get("authorization") === `Bearer ${key}`;
}

// Recover bidder's secp256k1 compressed public key from the DelegationSet event
// that was produced when the bidder called setDelegationFor. We pull the tx
// input, decode the EIP-712 sig, reconstruct the digest, and ecrecover.
// Result is cached permanently in Redis under inft:bidder_pubkey:<address>.
async function recoverBidderPubkey(
  client: ReturnType<typeof sepoliaPublicClient>,
  inft: `0x${string}`,
  bidder: `0x${string}`,
  tokenId: bigint,
): Promise<Uint8Array> {
  // Cache lookup
  const redis = getRedis();
  const cacheKey = `inft:bidder_pubkey:${bidder.toLowerCase()}`;
  if (redis) {
    const cached = await redis.get(cacheKey);
    if (cached) return hexToBytes(cached);
  }

  // Fetch DelegationSet logs for this bidder+tokenId
  const delegationSetEvent = parseAbiItem(
    "event DelegationSet(address indexed bidder, uint256 indexed tokenId, address oracle, uint64 expiresAt)",
  );
  const logs = await client.getLogs({
    address: inft,
    event: delegationSetEvent,
    args: { bidder, tokenId },
    fromBlock: 0n,
    toBlock: "latest",
  });

  if (logs.length === 0) {
    throw new Error(
      `No DelegationSet event found for bidder=${bidder} tokenId=${tokenId}`,
    );
  }

  // Use the most recent DelegationSet log
  const log = logs[logs.length - 1]!;

  // Fetch the transaction to get the calldata
  const tx = await client.getTransaction({ hash: log.transactionHash });

  // Decode setDelegationFor calldata:
  // function setDelegationFor(address receiver, uint256 tokenId, address oracle, uint64 expiresAt, bytes sig)
  // selector = first 4 bytes, then ABI-decoded args
  const calldata = tx.input;
  if (!calldata || calldata.length < 10) {
    throw new Error("Transaction input too short to decode");
  }

  // Strip function selector (4 bytes = 8 hex chars + '0x')
  const argsHex = `0x${calldata.slice(10)}` as `0x${string}`;
  const decoded = decodeAbiParameters(
    [
      { name: "receiver", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "oracle", type: "address" },
      { name: "expiresAt", type: "uint64" },
      { name: "sig", type: "bytes" },
    ],
    argsHex,
  );

  const sigHex = decoded[4] as `0x${string}`;
  const sigBytes = hexToBytes(sigHex.slice(2));
  if (sigBytes.length < 65) {
    throw new Error("Decoded sig too short");
  }

  // Reconstruct the EIP-712 digest that was signed
  // We need the domain separator from the INFT contract
  const domainSeparator = (await client.readContract({
    address: inft,
    abi: AgentINFTAbi,
    functionName: "domainSeparator",
    args: [],
  })) as `0x${string}`;

  const delegationTypehash = (await client.readContract({
    address: inft,
    abi: AgentINFTAbi,
    functionName: "DELEGATION_TYPEHASH",
    args: [],
  })) as `0x${string}`;

  // Encode the struct hash: keccak256(DELEGATION_TYPEHASH || tokenId || oracle || expiresAt)
  // ABI encoding: (bytes32, uint256, address, uint64)
  const receiver = decoded[0] as `0x${string}`;
  const decodedTokenId = decoded[1] as bigint;
  const oracle = decoded[2] as `0x${string}`;
  const expiresAt = decoded[3] as bigint;

  void receiver; // receiver is the bidder who signed; not needed for digest

  // Build the EIP-712 struct hash manually
  const typeHashBytes = hexToBytes(delegationTypehash.slice(2));
  const tokenIdBytes = new Uint8Array(32);
  let n = decodedTokenId;
  for (let j = 31; j >= 0; j--) {
    tokenIdBytes[j] = Number(n & 0xffn);
    n >>= 8n;
  }
  const oracleBytes = new Uint8Array(32);
  const oracleRaw = hexToBytes(oracle.slice(2));
  oracleBytes.set(oracleRaw, 12);
  const expiresAtBytes = new Uint8Array(32);
  let e = expiresAt;
  for (let j = 31; j >= 0; j--) {
    expiresAtBytes[j] = Number(e & 0xffn);
    e >>= 8n;
  }

  const structHashInput = new Uint8Array([
    ...typeHashBytes,
    ...tokenIdBytes,
    ...oracleBytes,
    ...expiresAtBytes,
  ]);
  const structHash = keccak_256(structHashInput);

  // EIP-712 digest: keccak256("\x19\x01" || domainSeparator || structHash)
  const domainSepBytes = hexToBytes(domainSeparator.slice(2));
  const digestInput = new Uint8Array([
    0x19,
    0x01,
    ...domainSepBytes,
    ...structHash,
  ]);
  const digest = keccak_256(digestInput);

  // Recover pubkey from compact sig + recovery bit
  const compact = sigBytes.slice(0, 64);
  const v = sigBytes[64]!;
  const rec = v === 27 ? 0 : v === 28 ? 1 : v > 1 ? v - 27 : v;

  const point = secp256k1.Signature.fromBytes(compact)
    .addRecoveryBit(rec)
    .recoverPublicKey(digest);
  const pubkey = point.toBytes(true); // 33B compressed

  // Cache permanently
  if (redis) {
    await redis.set(cacheKey, bytesToHex(pubkey));
  }

  return pubkey;
}

// Download file bytes from 0G Storage by merkle root
async function fetchFromZgStorage(rootHex: `0x${string}`): Promise<Uint8Array> {
  const indexer = new Indexer(ZG_INDEXER_URL);
  const [nodes, err] = await indexer.selectNodes(1);
  if (err || !nodes || nodes.length === 0) {
    throw new Error(
      `0G selectNodes failed: ${err?.message ?? "no nodes returned"}`,
    );
  }

  // rootHex may be "0x..." — strip prefix for the SDK
  const root = rootHex.startsWith("0x") ? rootHex.slice(2) : rootHex;

  let lastError: unknown;
  for (const node of nodes) {
    try {
      // downloadFile returns [data, error]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (node as any).downloadFile(root, false);
      if (Array.isArray(result)) {
        const [data, dlErr] = result as [Uint8Array | null, Error | null];
        if (dlErr) {
          lastError = dlErr;
          continue;
        }
        if (data) return data;
      } else if (result instanceof Uint8Array) {
        return result;
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    `Failed to download from 0G Storage root=${root}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkApiKey(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const tokenId = BigInt(parsed.data.tokenId);
  const bidder = parsed.data.bidder as `0x${string}`;
  const nonce = hexToBytes(parsed.data.sellerNonce.slice(2));

  const addrs = await getSepoliaAddresses();
  const inftAddress = addrs.inftAddress;
  if (!inftAddress) {
    return NextResponse.json({ error: "inft_not_deployed" }, { status: 503 });
  }
  const client = sepoliaPublicClient();

  // 1. Read on-chain delegation
  const delegation = (await client.readContract({
    address: inftAddress,
    abi: AgentINFTAbi,
    functionName: "delegations",
    args: [bidder, tokenId],
  })) as [`0x${string}`, bigint];

  const [delOracle, delExp] = delegation;
  if (delOracle.toLowerCase() !== oracleAddress().toLowerCase()) {
    return NextResponse.json({ error: "no delegation" }, { status: 400 });
  }
  if (delExp <= BigInt(Math.floor(Date.now() / 1000))) {
    return NextResponse.json({ error: "delegation expired" }, { status: 400 });
  }

  // 2. Recover bidder pubkey from DelegationSet event sig (cached after first lookup)
  let bidderPubkey: Uint8Array;
  try {
    bidderPubkey = await recoverBidderPubkey(client, inftAddress, bidder, tokenId);
  } catch (err) {
    console.error("[prepare-transfer] recoverBidderPubkey failed:", err);
    return NextResponse.json(
      { error: "cannot recover bidder pubkey" },
      { status: 400 },
    );
  }

  // 3. Load current AES key
  const oldKey = await loadKey(tokenId);
  if (!oldKey) {
    return NextResponse.json({ error: "no key for token" }, { status: 500 });
  }

  // 4. Fetch + decrypt current blob from 0G Storage
  const oldRootHex = (await client.readContract({
    address: inftAddress,
    abi: AgentINFTAbi,
    functionName: "encryptedMemoryRoot",
    args: [tokenId],
  })) as `0x${string}`;

  let ciphertext: Uint8Array;
  try {
    ciphertext = await fetchFromZgStorage(oldRootHex);
  } catch (err) {
    console.error("[prepare-transfer] fetchFromZgStorage failed:", err);
    return NextResponse.json(
      { error: "cannot fetch blob from 0G Storage" },
      { status: 502 },
    );
  }

  const plaintext = decryptBlob(ciphertext, oldKey);

  // 5. Generate K_new, encrypt, anchor
  const newKey = aesKeyFresh();
  const newCt = encryptBlob(plaintext, newKey);
  let anchored: Awaited<ReturnType<typeof anchorBlob>>;
  try {
    anchored = await anchorBlob(newCt);
  } catch (err) {
    console.error("[prepare-transfer] anchorBlob failed:", err);
    return NextResponse.json({ error: "anchor failed" }, { status: 502 });
  }

  const newRoot = hexToBytes(anchored.root.slice(2));
  const oldRoot = hexToBytes(oldRootHex.slice(2));

  // 6. ECIES wrap K_new to bidder pubkey
  const wrap = eciesWrap(newKey, bidderPubkey);

  // 7. Build proof
  const accessSig = buildAccessSig(newRoot, oldRoot, nonce);
  const proof = buildTransferProof({
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

  // 8. Stash pending K_new (rotated only on confirm-transfer)
  await storePending(tokenId, parsed.data.sellerNonce, newKey);

  return NextResponse.json({
    proof: `0x${bytesToHex(proof)}`,
    root_new: anchored.root,
    uri_new: anchored.uri,
    sealedKey: `0x${bytesToHex(wrap.sealedKey)}`,
    anchorTxNew: anchored.txHash,
    sellerNonce: parsed.data.sellerNonce,
  });
}
