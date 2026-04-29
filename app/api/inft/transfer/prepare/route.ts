import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/curves/utils.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { recoverPubkeyFromEip191 } from "@/lib/inft-oracle";
import { getRedis } from "@/lib/redis";
import { sepoliaPublicClient } from "@/lib/wallets";
import { getSepoliaAddresses } from "@/lib/edge-config";
import AgentINFTAbi from "@/lib/abis/AgentINFT.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 10; // requests per minute per IP

const Body = z.object({
  tokenId: z.string().regex(/^\d+$/),
  bidder: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  sellerSig: z.object({
    signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
    expiresAt: z.number(),
    nonce: z.string().regex(/^0x[a-fA-F0-9]{96}$/),
  }),
});

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

async function checkRateLimit(ip: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true; // no Redis = no rate limiting in dev
  const key = `limit:inft:transfer:prepare:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 60);
  }
  return count <= RATE_LIMIT;
}

// Derive Ethereum address from 33-byte compressed secp256k1 pubkey
function pubkeyToAddress(pubkey: Uint8Array): `0x${string}` {
  const pubkeyHex = bytesToHex(pubkey);
  const point = secp256k1.Point.fromHex(pubkeyHex);
  const uncompressed = point.toBytes(false).slice(1); // 64 bytes
  const hash = keccak_256(uncompressed);
  const addrBytes = hash.slice(12);
  const hex = Array.from(addrBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}` as `0x${string}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  if (!(await checkRateLimit(ip))) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
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

  const { tokenId: tokenIdStr, bidder, sellerSig } = parsed.data;
  const tokenId = BigInt(tokenIdStr);
  const now = Math.floor(Date.now() / 1000);

  // Validate sellerSig expiresAt
  if (sellerSig.expiresAt <= now) {
    return NextResponse.json({ error: "sellerSig expired" }, { status: 400 });
  }

  // Reconstruct keccak256("inft-prepare-transfer" || tokenId || bidder || expiresAt)
  const tokenIdBytes = new Uint8Array(32);
  let n = tokenId;
  for (let j = 31; j >= 0; j--) {
    tokenIdBytes[j] = Number(n & 0xffn);
    n >>= 8n;
  }
  const bidderBytes = Uint8Array.from(
    Buffer.from(bidder.slice(2), "hex"),
  );
  const expiresAtBytes = new Uint8Array(8);
  let ea = BigInt(sellerSig.expiresAt);
  for (let j = 7; j >= 0; j--) {
    expiresAtBytes[j] = Number(ea & 0xffn);
    ea >>= 8n;
  }
  const msgHash = keccak_256(
    new Uint8Array([
      ...new TextEncoder().encode("inft-prepare-transfer"),
      ...tokenIdBytes,
      ...bidderBytes,
      ...expiresAtBytes,
    ]),
  );

  const recoveredPubkey = recoverPubkeyFromEip191(
    msgHash,
    sellerSig.signature as `0x${string}`,
  );
  const recoveredAddress = pubkeyToAddress(recoveredPubkey);

  // Validate seller actually owns the token
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
    return NextResponse.json({ error: "not token owner" }, { status: 403 });
  }

  // Proxy to internal oracle endpoint
  const oracleApiKey = process.env.INFT_ORACLE_API_KEY;
  if (!oracleApiKey) {
    return NextResponse.json({ error: "oracle not configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const internalUrl = `${url.protocol}//${url.host}/api/inft/oracle/prepare-transfer`;
  const oracleRes = await fetch(internalUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${oracleApiKey}`,
    },
    body: JSON.stringify({
      tokenId: tokenIdStr,
      bidder,
      sellerNonce: sellerSig.nonce,
    }),
  });

  const data = await oracleRes.json() as Record<string, unknown>;
  return NextResponse.json(data, { status: oracleRes.status });
}
