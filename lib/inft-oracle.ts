import { gcm } from "@noble/ciphers/aes.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { hexToBytes } from "@noble/curves/utils.js";
import { Wallet } from "ethers";
import { writeBytes } from "@/lib/zg-storage";

export type OraclePlaintext = Record<string, unknown>;

function oracleSk(): Uint8Array {
  const pk = process.env.INFT_ORACLE_PK;
  if (!pk) throw new Error("INFT_ORACLE_PK missing");
  return hexToBytes(pk.startsWith("0x") ? pk.slice(2) : pk);
}

export function oracleAddress(): `0x${string}` {
  const pk = process.env.INFT_ORACLE_PK;
  if (!pk) throw new Error("INFT_ORACLE_PK missing");
  return new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`).address as `0x${string}`;
}

export function aesKeyFresh(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export function encryptBlob(
  plaintext: OraclePlaintext,
  key: Uint8Array,
): Uint8Array {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const json = new TextEncoder().encode(JSON.stringify(plaintext));
  const ct = gcm(key, iv).encrypt(json);
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return out;
}

export function decryptBlob(
  ciphertext: Uint8Array,
  key: Uint8Array,
): OraclePlaintext {
  const iv = ciphertext.slice(0, 12);
  const ct = ciphertext.slice(12);
  const pt = gcm(key, iv).decrypt(ct);
  return JSON.parse(new TextDecoder().decode(pt)) as OraclePlaintext;
}

export function eciesWrap(
  aesKey: Uint8Array,
  recipientPubkey: Uint8Array,
): {
  ephemeralPub: Uint8Array;
  iv: Uint8Array;
  sealedKey: Uint8Array;
  tag: Uint8Array;
} {
  const ephSk = secp256k1.utils.randomSecretKey();
  const ephPub = secp256k1.getPublicKey(ephSk, true); // compressed 33B
  const shared = secp256k1.getSharedSecret(ephSk, recipientPubkey, true); // 33B
  const km = hkdf(
    sha256,
    shared.slice(1), // strip 0x02/0x03 prefix
    new Uint8Array(),
    new TextEncoder().encode("inft-key-wrap-v1"),
    32,
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctTag = gcm(km.slice(0, 16), iv).encrypt(aesKey);
  const sealedKey = ctTag.slice(0, 16); // first 16B of ct
  const tag = ctTag.slice(16); // last 16B (GCM auth tag)
  return { ephemeralPub: ephPub, iv, sealedKey, tag };
}

function eip191Digest(messageHash: Uint8Array): Uint8Array {
  return keccak_256(
    new Uint8Array([
      ...new TextEncoder().encode("\x19Ethereum Signed Message:\n32"),
      ...messageHash,
    ]),
  );
}

export function signEip191(messageHash: Uint8Array): Uint8Array {
  const sk = oracleSk();
  const digest = eip191Digest(messageHash);
  // prehash:false — we pass the already-hashed digest; secp256k1.sign
  // in @noble/curves v2 applies sha256 by default, so we opt out.
  const sigBytes = secp256k1.sign(digest, sk, { prehash: false });
  // sigBytes is a 64-byte compact sig (r||s). Brute-force recovery bit.
  const pub = secp256k1.getPublicKey(sk, true);
  for (let rec = 0; rec <= 1; rec++) {
    const sigObj = secp256k1.Signature.fromBytes(sigBytes).addRecoveryBit(rec);
    try {
      const recovered = sigObj.recoverPublicKey(digest).toBytes(true);
      if (
        recovered.length === pub.length &&
        recovered.every((b, i) => b === pub[i])
      ) {
        const v = rec + 27;
        return new Uint8Array([...sigBytes, v]);
      }
    } catch {
      // try next rec
    }
  }
  throw new Error("signEip191: could not determine recovery bit");
}

export function recoverPubkeyFromEip191(
  messageHash: Uint8Array,
  sigHex: `0x${string}`,
): Uint8Array {
  const sig = hexToBytes(sigHex.slice(2));
  const compact = sig.slice(0, 64);
  const v = sig[64]!;
  const rec = v === 27 ? 0 : v === 28 ? 1 : v;
  const digest = eip191Digest(messageHash);
  const point = secp256k1.Signature.fromBytes(compact)
    .addRecoveryBit(rec)
    .recoverPublicKey(digest);
  return point.toBytes(true);
}

export function buildMintProof(
  dataHash: Uint8Array,
  nonce: Uint8Array,
): Uint8Array {
  // Layout: flags(1) | sig(65) | dataHash(32) | nonce(48) = 146 bytes
  if (dataHash.length !== 32) throw new Error("dataHash must be 32 bytes");
  if (nonce.length !== 48) throw new Error("nonce must be 48 bytes");
  const messageHash = keccak_256(
    new Uint8Array([
      ...new TextEncoder().encode("inft-mint-v1"),
      ...dataHash,
      ...nonce,
    ]),
  );
  const sig = signEip191(messageHash);
  return new Uint8Array([0x00, ...sig, ...dataHash, ...nonce]);
}

export type TransferProofInput = {
  tokenId: bigint;
  oldRoot: Uint8Array; // 32B
  newRoot: Uint8Array; // 32B
  sealedKey: Uint8Array; // 16B (from eciesWrap)
  ephemeralPub: Uint8Array; // 33B
  ivWrap: Uint8Array; // 12B
  wrapTag: Uint8Array; // 16B
  newUri: string; // UTF-8
  nonce: Uint8Array; // 48B
  receiverSig: Uint8Array; // 65B (oracle signs in delegation path)
};

export function buildTransferProof(i: TransferProofInput): Uint8Array {
  const uriBytes = new TextEncoder().encode(i.newUri);
  if (uriBytes.length > 0xffff) throw new Error("newUri too long");
  const uriLen = new Uint8Array([uriBytes.length >> 8, uriBytes.length & 0xff]);

  const tokenIdBytes = new Uint8Array(32);
  let n = i.tokenId;
  for (let j = 31; j >= 0; j--) {
    tokenIdBytes[j] = Number(n & 0xffn);
    n >>= 8n;
  }

  // Oracle attestation: keccak256(tokenId || oldRoot || newRoot || sealedKey || keccak256(uri) || nonce)
  const attestMsg = keccak_256(
    new Uint8Array([
      ...tokenIdBytes,
      ...i.oldRoot,
      ...i.newRoot,
      ...i.sealedKey,
      ...keccak_256(uriBytes),
      ...i.nonce,
    ]),
  );
  const oracleSig = signEip191(attestMsg);

  // Layout per spec (post-tokenId amendment):
  // flags(1) | tokenId(32) | receiverSig(65) | nonce(48) | newRoot(32) |
  // oldRoot(32) | sealedKey(16) | ephemeralPub(33) | ivWrap(12) | wrapTag(16) |
  // uriLen(2) | uri(L) | oracleAttest(65)
  return new Uint8Array([
    0x40, // flags
    ...tokenIdBytes, // 32
    ...i.receiverSig, // 65
    ...i.nonce, // 48
    ...i.newRoot, // 32
    ...i.oldRoot, // 32
    ...i.sealedKey, // 16
    ...i.ephemeralPub, // 33
    ...i.ivWrap, // 12
    ...i.wrapTag, // 16
    ...uriLen, // 2
    ...uriBytes, // L
    ...oracleSig, // 65
  ]);
}

export function buildAccessSig(
  newRoot: Uint8Array,
  oldRoot: Uint8Array,
  nonce: Uint8Array,
): Uint8Array {
  const msg = keccak_256(
    new Uint8Array([...newRoot, ...oldRoot, ...nonce]),
  );
  return signEip191(msg);
}

export async function anchorBlob(ciphertext: Uint8Array): Promise<{
  root: `0x${string}`;
  uri: string;
  txHash: `0x${string}`;
}> {
  const res = await writeBytes(ciphertext);
  if (!res || !res.anchored) throw new Error("0G anchor failed");
  return {
    root: res.rootHash as `0x${string}`,
    uri: `og://${res.rootHash}`,
    txHash: res.txHash as `0x${string}`,
  };
}
