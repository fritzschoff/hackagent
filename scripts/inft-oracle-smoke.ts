/**
 * Smoke test for lib/inft-oracle.ts primitives.
 * Run with a synthetic oracle key — never the real one:
 *
 *   INFT_ORACLE_PK=0x$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
 *     pnpm exec tsx scripts/inft-oracle-smoke.ts
 *
 * Expected output: ✓ all checks passed
 */

import {
  aesKeyFresh,
  encryptBlob,
  decryptBlob,
  eciesWrap,
  oracleAddress,
  buildMintProof,
  buildTransferProof,
  buildAccessSig,
} from "../lib/inft-oracle";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hexToBytes } from "@noble/curves/utils.js";

async function main() {
  console.log("oracle address:", oracleAddress());

  // 1. Round-trip AES-128-GCM encrypt/decrypt
  const k = aesKeyFresh();
  const pt = { hello: "world", n: 42 };
  const ct = encryptBlob(pt, k);
  const back = decryptBlob(ct, k);
  const encOk =
    JSON.stringify(back) === JSON.stringify(pt) && ct.length > 12 + 16;
  console.log("✓ encrypt/decrypt:", encOk);
  if (!encOk) {
    console.error("FAIL: encrypt/decrypt round-trip mismatch");
    process.exit(1);
  }

  // 2. ECIES wrap — sealedKey must be 16 bytes
  const recipientSk = secp256k1.utils.randomSecretKey();
  const recipientPub = secp256k1.getPublicKey(recipientSk, true);
  const wrap = eciesWrap(k, recipientPub);
  const eciesOk =
    wrap.sealedKey.length === 16 &&
    wrap.tag.length === 16 &&
    wrap.ephemeralPub.length === 33 &&
    wrap.iv.length === 12;
  console.log("✓ ECIES sealedKey 16B:", eciesOk);
  if (!eciesOk) {
    console.error("FAIL: ECIES wrap returned unexpected sizes");
    process.exit(1);
  }

  // 3. Mint proof — must be exactly 146 bytes
  const dataHash = hexToBytes(
    "ad8d07c9741d5b6ae5553e2250d22169deca27f16bb4a0ecec211967ec487321",
  );
  const nonce = new Uint8Array(48);
  crypto.getRandomValues(nonce);
  const mp = buildMintProof(dataHash, nonce);
  const mintOk = mp.length === 146 && mp[0] === 0x00;
  console.log("✓ mint proof bytes:", mp.length, "(expected 146)");
  if (!mintOk) {
    console.error("FAIL: mint proof length wrong, got", mp.length);
    process.exit(1);
  }

  // 4. Transfer proof — size must be 289 + uriLen bytes
  const oldRoot = new Uint8Array(32);
  oldRoot[0] = 0xab;
  const newRoot = new Uint8Array(32);
  newRoot[0] = 0xcd;
  const transferNonce = new Uint8Array(48);
  const newUri =
    "og://" +
    Array.from(newRoot)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const receiverSig = buildAccessSig(newRoot, oldRoot, transferNonce);
  const tp = buildTransferProof({
    tokenId: 1n,
    oldRoot,
    newRoot,
    sealedKey: wrap.sealedKey,
    ephemeralPub: wrap.ephemeralPub,
    ivWrap: wrap.iv,
    wrapTag: wrap.tag,
    newUri,
    nonce: transferNonce,
    receiverSig,
  });
  const uriLen = new TextEncoder().encode(newUri).length;
  const expectedTpLen = 289 + uriLen + 65; // fixed(289) + uri + oracleSig(65)
  const tpOk = tp.length === expectedTpLen && tp[0] === 0x40;
  console.log("✓ transfer proof bytes:", tp.length, `(expected ${expectedTpLen})`);
  if (!tpOk) {
    console.error(
      "FAIL: transfer proof length wrong, got",
      tp.length,
      "expected",
      expectedTpLen,
    );
    process.exit(1);
  }

  // 5. buildAccessSig returns 65 bytes
  const accessSig = buildAccessSig(newRoot, oldRoot, transferNonce);
  const accOk = accessSig.length === 65;
  console.log("✓ accessSig 65B:", accOk);
  if (!accOk) {
    console.error("FAIL: accessSig length wrong, got", accessSig.length);
    process.exit(1);
  }

  console.log("✓ all checks passed");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
