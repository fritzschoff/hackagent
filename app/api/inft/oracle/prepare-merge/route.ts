import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hexToBytes, bytesToHex } from "@noble/curves/utils.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  aesKeyFresh,
  encryptBlob,
  decryptBlob,
  eciesWrap,
  buildTransferProof,
  buildAccessSig,
  anchorBlob,
  recoverPubkeyFromEip191,
} from "@/lib/inft-oracle";
import { loadKey, storePending } from "@/lib/inft-redis";
import { sepoliaPublicClient } from "@/lib/wallets";
import { getSepoliaAddresses } from "@/lib/edge-config";
import AgentINFTAbi from "@/lib/abis/AgentINFT.json";
import { Indexer } from "@0glabs/0g-ts-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZG_INDEXER_URL =
  process.env.ZG_INDEXER_URL ?? "https://indexer-storage-testnet-turbo.0g.ai";

const OwnerPubkeySig = z.object({
  nonce: z.string(),
  expiresAt: z.number(),
  sig: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
});

const Body = z.object({
  mergedAgentId: z.number(),
  src1: z.object({ tokenId: z.string().regex(/^\d+$/) }),
  src2: z.object({ tokenId: z.string().regex(/^\d+$/) }),
  mergedPlaintext: z.record(z.unknown()),
  ownerPubkeySig: OwnerPubkeySig,
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

  const tokenId1 = BigInt(parsed.data.src1.tokenId);
  const tokenId2 = BigInt(parsed.data.src2.tokenId);
  const { mergedPlaintext, ownerPubkeySig } = parsed.data;

  // Validate expiresAt
  const now = Math.floor(Date.now() / 1000);
  if (ownerPubkeySig.expiresAt <= now) {
    return NextResponse.json({ error: "ownerPubkeySig expired" }, { status: 400 });
  }

  const addrs = await getSepoliaAddresses();
  const inftAddress = addrs.inftAddress;
  if (!inftAddress) {
    return NextResponse.json({ error: "inft_not_deployed" }, { status: 503 });
  }
  const client = sepoliaPublicClient();

  // Recover M's pubkey from ownerPubkeySig
  // EIP-191 over keccak256("inft-pubkey-register" || nonce || expiresAt)
  const nonceBytes = new TextEncoder().encode(ownerPubkeySig.nonce);
  const expiresAtBytes = new Uint8Array(8);
  let ea = BigInt(ownerPubkeySig.expiresAt);
  for (let j = 7; j >= 0; j--) {
    expiresAtBytes[j] = Number(ea & 0xffn);
    ea >>= 8n;
  }
  const pubkeyRegisterMsg = keccak_256(
    new Uint8Array([
      ...new TextEncoder().encode("inft-pubkey-register"),
      ...nonceBytes,
      ...expiresAtBytes,
    ]),
  );
  const ownerPubkey = recoverPubkeyFromEip191(
    pubkeyRegisterMsg,
    ownerPubkeySig.sig as `0x${string}`,
  );

  // Load keys for both source tokens
  const [key1, key2] = await Promise.all([
    loadKey(tokenId1),
    loadKey(tokenId2),
  ]);
  if (!key1) return NextResponse.json({ error: "no key for token 1" }, { status: 500 });
  if (!key2) return NextResponse.json({ error: "no key for token 2" }, { status: 500 });

  // Fetch + decrypt both blobs
  const [root1Hex, root2Hex] = await Promise.all([
    client.readContract({
      address: inftAddress,
      abi: AgentINFTAbi,
      functionName: "encryptedMemoryRoot",
      args: [tokenId1],
    }) as Promise<`0x${string}`>,
    client.readContract({
      address: inftAddress,
      abi: AgentINFTAbi,
      functionName: "encryptedMemoryRoot",
      args: [tokenId2],
    }) as Promise<`0x${string}`>,
  ]);

  let ct1: Uint8Array, ct2: Uint8Array;
  try {
    [ct1, ct2] = await Promise.all([
      fetchFromZgStorage(root1Hex),
      fetchFromZgStorage(root2Hex),
    ]);
  } catch (err) {
    console.error("[prepare-merge] fetchFromZgStorage failed:", err);
    return NextResponse.json({ error: "cannot fetch blobs from 0G Storage" }, { status: 502 });
  }

  // Decrypt both (validate keys are correct)
  decryptBlob(ct1, key1);
  decryptBlob(ct2, key2);

  // Encrypt mergedPlaintext under fresh K_m
  const km = aesKeyFresh();
  const mergedCt = encryptBlob(mergedPlaintext, km);

  let anchored: Awaited<ReturnType<typeof anchorBlob>>;
  try {
    anchored = await anchorBlob(mergedCt);
  } catch (err) {
    console.error("[prepare-merge] anchorBlob failed:", err);
    return NextResponse.json({ error: "anchor failed" }, { status: 502 });
  }

  const mergedRoot = hexToBytes(anchored.root.slice(2));
  const oldRoot1 = hexToBytes(root1Hex.slice(2));
  const oldRoot2 = hexToBytes(root2Hex.slice(2));

  // ECIES wrap K_m to owner pubkey
  const wrap = eciesWrap(km, ownerPubkey);

  // Build nonces for each proof
  const nonce1 = new Uint8Array(48);
  const nonce2 = new Uint8Array(48);
  crypto.getRandomValues(nonce1);
  crypto.getRandomValues(nonce2);

  // Both proofs encode transfer of each source token to the merged destination
  // with the same newDataHash = mergedRoot
  const accessSig1 = buildAccessSig(mergedRoot, oldRoot1, nonce1);
  const accessSig2 = buildAccessSig(mergedRoot, oldRoot2, nonce2);

  const proof1 = buildTransferProof({
    tokenId: tokenId1,
    oldRoot: oldRoot1,
    newRoot: mergedRoot,
    sealedKey: wrap.sealedKey,
    ephemeralPub: wrap.ephemeralPub,
    ivWrap: wrap.iv,
    wrapTag: wrap.tag,
    newUri: anchored.uri,
    nonce: nonce1,
    receiverSig: accessSig1,
  });

  const proof2 = buildTransferProof({
    tokenId: tokenId2,
    oldRoot: oldRoot2,
    newRoot: mergedRoot,
    sealedKey: wrap.sealedKey,
    ephemeralPub: wrap.ephemeralPub,
    ivWrap: wrap.iv,
    wrapTag: wrap.tag,
    newUri: anchored.uri,
    nonce: nonce2,
    receiverSig: accessSig2,
  });

  // Stash pending K_m for both source tokens
  const nonce1Hex = `0x${bytesToHex(nonce1)}`;
  const nonce2Hex = `0x${bytesToHex(nonce2)}`;
  await Promise.all([
    storePending(tokenId1, nonce1Hex, km),
    storePending(tokenId2, nonce2Hex, km),
  ]);

  return NextResponse.json({
    proof1: `0x${bytesToHex(proof1)}`,
    proof2: `0x${bytesToHex(proof2)}`,
    mergedRoot: anchored.root,
    mergedUri: anchored.uri,
    anchorTxMerged: anchored.txHash,
    nonce1: nonce1Hex,
    nonce2: nonce2Hex,
    sealedKey: `0x${bytesToHex(wrap.sealedKey)}`,
  });
}
