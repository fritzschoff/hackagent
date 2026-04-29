import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hexToBytes, bytesToHex } from "@noble/curves/utils.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  decryptBlob,
  recoverPubkeyFromEip191,
} from "@/lib/inft-oracle";
import { loadKey } from "@/lib/inft-redis";
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
  ownerSig: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
  nonce: z.string(),
  expiresAt: z.number(),
});

function checkApiKey(req: NextRequest): boolean {
  const key = process.env.INFT_ORACLE_API_KEY;
  if (!key) return false;
  return req.headers.get("authorization") === `Bearer ${key}`;
}

async function fetchFromZgStorage(rootHex: `0x${string}`): Promise<Uint8Array> {
  const indexer = new Indexer(ZG_INDEXER_URL);
  const [nodes, err] = await indexer.selectNodes(1);
  if (err || !nodes || nodes.length === 0) {
    throw new Error(
      `0G selectNodes failed: ${err?.message ?? "no nodes returned"}`,
    );
  }
  const root = rootHex.startsWith("0x") ? rootHex.slice(2) : rootHex;
  let lastError: unknown;
  for (const node of nodes) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (node as any).downloadFile(root, false);
      if (Array.isArray(result)) {
        const [data, dlErr] = result as [Uint8Array | null, Error | null];
        if (dlErr) { lastError = dlErr; continue; }
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

// Derive Ethereum address from 33-byte compressed secp256k1 pubkey
function pubkeyToAddress(pubkey: Uint8Array): `0x${string}` {
  // fromHex expects a hex string — convert bytes first
  const pubkeyHex = bytesToHex(pubkey);
  // Decompress to uncompressed bytes (isCompressed=false), skip 0x04 prefix
  const point = secp256k1.Point.fromHex(pubkeyHex);
  const uncompressed = point.toBytes(false).slice(1); // 64 bytes
  const hash = keccak_256(uncompressed);
  const addrBytes = hash.slice(12); // last 20 bytes
  const hex = Array.from(addrBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}` as `0x${string}`;
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

  const { ownerSig, nonce, expiresAt } = parsed.data;
  const tokenId = BigInt(parsed.data.tokenId);
  const now = Math.floor(Date.now() / 1000);

  // Validate expiresAt > now
  if (expiresAt <= now) {
    return NextResponse.json({ error: "signature expired" }, { status: 400 });
  }

  // Reconstruct keccak256("inft-reveal" || tokenId || nonce || expiresAt) EIP-191 digest
  const tokenIdBytes = new Uint8Array(32);
  let n = tokenId;
  for (let j = 31; j >= 0; j--) {
    tokenIdBytes[j] = Number(n & 0xffn);
    n >>= 8n;
  }
  const nonceBytes = new TextEncoder().encode(nonce);
  const expiresAtBytes = new Uint8Array(8);
  let ea = BigInt(expiresAt);
  for (let j = 7; j >= 0; j--) {
    expiresAtBytes[j] = Number(ea & 0xffn);
    ea >>= 8n;
  }

  const msgHash = keccak_256(
    new Uint8Array([
      ...new TextEncoder().encode("inft-reveal"),
      ...tokenIdBytes,
      ...nonceBytes,
      ...expiresAtBytes,
    ]),
  );

  const recoveredPubkey = recoverPubkeyFromEip191(msgHash, ownerSig as `0x${string}`);
  const recoveredAddress = pubkeyToAddress(recoveredPubkey);

  // Check INFT.ownerOf(tokenId) == recoveredAddress
  const addrs = await getSepoliaAddresses();
  const inftAddress = addrs.inftAddress;
  if (!inftAddress) {
    return NextResponse.json({ error: "inft_not_deployed" }, { status: 503 });
  }
  const client = sepoliaPublicClient();

  const owner = (await client.readContract({
    address: inftAddress,
    abi: AgentINFTAbi,
    functionName: "ownerOf",
    args: [tokenId],
  })) as `0x${string}`;

  if (owner.toLowerCase() !== recoveredAddress.toLowerCase()) {
    return NextResponse.json({ error: "not owner" }, { status: 403 });
  }

  // Nonce replay protection: mark used with 5m TTL
  const redis = getRedis();
  if (redis) {
    const nonceKey = `inft:reveal_nonce:${tokenId}:${nonce}`;
    const exists = await redis.get(nonceKey);
    if (exists) {
      return NextResponse.json({ error: "nonce already used" }, { status: 400 });
    }
    await redis.set(nonceKey, "1", "EX", 300); // 5 minutes
  }

  // Load AES key
  const aesKey = await loadKey(tokenId);
  if (!aesKey) {
    return NextResponse.json({ error: "no key for token" }, { status: 500 });
  }

  // Fetch ciphertext from 0G Storage
  const rootHex = (await client.readContract({
    address: inftAddress,
    abi: AgentINFTAbi,
    functionName: "encryptedMemoryRoot",
    args: [tokenId],
  })) as `0x${string}`;

  let ciphertext: Uint8Array;
  try {
    ciphertext = await fetchFromZgStorage(rootHex);
  } catch (err) {
    console.error("[reveal] fetchFromZgStorage failed:", err);
    return NextResponse.json(
      { error: "cannot fetch blob from 0G Storage" },
      { status: 502 },
    );
  }

  const plaintext = decryptBlob(ciphertext, aesKey);

  return NextResponse.json({ plaintext });
}
