import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { bytesToHex, hexToBytes } from "@noble/curves/utils.js";
import {
  aesKeyFresh,
  encryptBlob,
  anchorBlob,
  buildMintProof,
} from "@/lib/inft-oracle";
import { storeKey } from "@/lib/inft-redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tokenIdPredicted: z.string().regex(/^\d+$/),
  plaintext: z.record(z.unknown()),
});

function checkApiKey(req: NextRequest): boolean {
  const key = process.env.INFT_ORACLE_API_KEY;
  if (!key) return false;
  return req.headers.get("authorization") === `Bearer ${key}`;
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
    return NextResponse.json(
      { error: parsed.error.message },
      { status: 400 },
    );
  }

  const tokenId = BigInt(parsed.data.tokenIdPredicted);

  const aesKey = aesKeyFresh();
  const ct = encryptBlob(parsed.data.plaintext, aesKey);

  let anchored: Awaited<ReturnType<typeof anchorBlob>>;
  try {
    anchored = await anchorBlob(ct);
  } catch (err) {
    console.error("[seal-blob] anchorBlob failed:", err);
    return NextResponse.json({ error: "anchor failed" }, { status: 502 });
  }

  await storeKey(tokenId, aesKey);

  const root = hexToBytes(anchored.root.slice(2));
  const nonce = new Uint8Array(48);
  crypto.getRandomValues(nonce);
  const mintProof = buildMintProof(root, nonce);

  return NextResponse.json({
    root: anchored.root,
    uri: anchored.uri,
    mintProof: `0x${bytesToHex(mintProof)}`,
    anchorTx: anchored.txHash,
  });
}
