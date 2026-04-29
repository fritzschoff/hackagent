import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseAbiItem } from "viem";
import { getRedis } from "@/lib/redis";
import { sepoliaPublicClient } from "@/lib/wallets";
import { getSepoliaAddresses } from "@/lib/edge-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 30; // requests per minute per IP

const Body = z.object({
  tokenId: z.string().regex(/^\d+$/),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  sellerNonce: z.string().regex(/^0x[a-fA-F0-9]{96}$/),
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
  if (!redis) return true;
  const key = `limit:inft:transfer:confirm:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 60);
  }
  return count <= RATE_LIMIT;
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

  const { tokenId: tokenIdStr, txHash, sellerNonce } = parsed.data;
  const tokenId = BigInt(tokenIdStr);
  const hash = txHash as `0x${string}`;

  // Belt-and-suspenders: verify tx server-side before proxying
  const addrs = await getSepoliaAddresses();
  const inftAddress = addrs.inftAddress;
  if (!inftAddress) {
    return NextResponse.json({ error: "inft_not_deployed" }, { status: 503 });
  }
  const client = sepoliaPublicClient();

  const receipt = await client.getTransactionReceipt({ hash });
  if (!receipt) {
    return NextResponse.json({ error: "tx not found" }, { status: 400 });
  }
  if (receipt.status !== "success") {
    return NextResponse.json({ error: "tx reverted" }, { status: 400 });
  }

  // Verify Transferred event
  const transferredEvent = parseAbiItem(
    "event Transferred(uint256 indexed tokenId, address indexed from, address indexed to)",
  );
  const logs = await client.getLogs({
    address: inftAddress,
    event: transferredEvent,
    args: { tokenId },
    blockHash: receipt.blockHash,
  });
  if (logs.length === 0) {
    return NextResponse.json(
      { error: "Transferred event not found" },
      { status: 400 },
    );
  }

  // Proxy to internal oracle endpoint
  const oracleApiKey = process.env.INFT_ORACLE_API_KEY;
  if (!oracleApiKey) {
    return NextResponse.json({ error: "oracle not configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const internalUrl = `${url.protocol}//${url.host}/api/inft/oracle/confirm-transfer`;
  const oracleRes = await fetch(internalUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${oracleApiKey}`,
    },
    body: JSON.stringify({ tokenId: tokenIdStr, txHash, sellerNonce }),
  });

  const data = await oracleRes.json() as Record<string, unknown>;
  return NextResponse.json(data, { status: oracleRes.status });
}
