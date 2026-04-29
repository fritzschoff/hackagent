import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";
import { hexToBytes, bytesToHex } from "@noble/curves/utils.js";
import { getRedis } from "@/lib/redis";

const KEK_SALT = new TextEncoder().encode("inft-kek-v1");

function kek(tokenId: bigint): Uint8Array {
  const pk = process.env.INFT_ORACLE_PK;
  if (!pk) throw new Error("INFT_ORACLE_PK missing");
  const skBytes = hexToBytes(pk.startsWith("0x") ? pk.slice(2) : pk);
  return hkdf(
    sha256,
    skBytes,
    KEK_SALT,
    new TextEncoder().encode(`tokenId:${tokenId.toString()}`),
    32,
  );
}

function redis() {
  const r = getRedis();
  if (!r) throw new Error("Redis not configured (REDIS_URL missing)");
  return r;
}

export async function storeKey(
  tokenId: bigint,
  aesKey: Uint8Array,
): Promise<void> {
  if (aesKey.length !== 16) throw new Error("aesKey must be 16 bytes");
  const k = kek(tokenId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = gcm(k, iv).encrypt(aesKey);
  const blob = new Uint8Array(iv.length + ct.length);
  blob.set(iv);
  blob.set(ct, iv.length);
  await redis().set(`inft:key:${tokenId}`, bytesToHex(blob));
}

export async function loadKey(tokenId: bigint): Promise<Uint8Array | null> {
  const hex = await redis().get(`inft:key:${tokenId}`);
  if (!hex) return null;
  const blob = hexToBytes(hex);
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  return gcm(kek(tokenId), iv).decrypt(ct);
}

export async function storePending(
  tokenId: bigint,
  nonceHex: string,
  aesKey: Uint8Array,
): Promise<void> {
  const k = kek(tokenId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = gcm(k, iv).encrypt(aesKey);
  const blob = new Uint8Array(iv.length + ct.length);
  blob.set(iv);
  blob.set(ct, iv.length);
  await redis().set(
    `inft:pending:${tokenId}:${nonceHex}`,
    bytesToHex(blob),
    "EX",
    86400,
  );
}

export async function commitPending(
  tokenId: bigint,
  nonceHex: string,
): Promise<boolean> {
  const r = redis();
  const blob = await r.get(`inft:pending:${tokenId}:${nonceHex}`);
  if (!blob) return false;
  await r.set(`inft:key:${tokenId}`, blob);
  await r.del(`inft:pending:${tokenId}:${nonceHex}`);
  await r.incr(`inft:meta:${tokenId}:rotations`);
  return true;
}

export async function rotations(tokenId: bigint): Promise<number> {
  const v = await redis().get(`inft:meta:${tokenId}:rotations`);
  return v ? Number(v) : 0;
}
