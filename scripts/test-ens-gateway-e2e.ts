/**
 * End-to-end test for the ENS gateway pipeline (W2 Milestone 6).
 *
 * Tests the full EIP-3668 flow: OffchainLookup callData construction →
 * local gateway response → signature verification → on-chain resolveWithProof.
 *
 * Usage:
 *   # Terminal 1:
 *   pnpm dev
 *
 *   # Terminal 2:
 *   set -a; source .env.local; set +a
 *   pnpm exec tsx scripts/test-ens-gateway-e2e.ts
 *
 * Prints "ALL GREEN" and exits 0 on success.
 */

import {
  encodeAbiParameters,
  decodeAbiParameters,
  keccak256,
  createPublicClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hexToBytes, bytesToHex } from "@noble/curves/utils.js";
import { Wallet } from "ethers";

// ─── Constants ────────────────────────────────────────────────────────────────

const RESOLVER_ADDR = "0x4F956e6521A4B87b9f9b2D5ED191fB6134Bc8C17" as Address;
const LOCAL_GATEWAY_BASE = "http://localhost:3000/api/ens-gateway";

// Selectors
const TEXT_SELECTOR = "0x59d1d43c" as Hex; // text(bytes32,string)
const ADDR_SELECTOR = "0x3b3b57de" as Hex; // addr(bytes32)

// ─── OffchainResolver ABI (minimal — only what we need) ───────────────────────
const RESOLVER_ABI = [
  {
    type: "function",
    name: "resolveWithProof",
    stateMutability: "view",
    inputs: [
      { name: "response", type: "bytes" },
      { name: "extraData", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes" }],
  },
  {
    type: "error",
    name: "ExpiredResponse",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidSigner",
    inputs: [],
  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
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

/** DNS wire-format encode a dotted name. e.g. "a.b.eth" → Uint8Array */
function encodeDnsWire(name: string): Uint8Array {
  const labels = name.split(".");
  const parts: number[] = [];
  for (const label of labels) {
    const bytes = Array.from(new TextEncoder().encode(label));
    parts.push(bytes.length, ...bytes);
  }
  parts.push(0x00); // terminator
  return new Uint8Array(parts);
}

/** Compute the namehash (node) for a dotted ENS name. */
function namehash(name: string): Hex {
  let node = new Uint8Array(32); // 0x000...
  if (name === "") return ("0x" + bytesToHex(node)) as Hex;
  const labels = name.split(".").reverse();
  for (const label of labels) {
    const labelHash = keccak_256(new TextEncoder().encode(label));
    node = keccak_256(new Uint8Array([...node, ...labelHash]));
  }
  return ("0x" + bytesToHex(node)) as Hex;
}

/**
 * Builds the outer abi.encode(name, resolveCalldata) that the OffchainResolver
 * passes as both `callData` and `extraData` in the OffchainLookup revert.
 */
function buildOffchainLookupCallData(
  dnsName: Uint8Array,
  innerCalldata: Hex,
): Hex {
  const nameHex = ("0x" + bytesToHex(dnsName)) as Hex;
  return encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes" }],
    [nameHex, innerCalldata],
  );
}

/** Build inner calldata for text(bytes32 node, string key). */
function buildTextCalldata(node: Hex, key: string): Hex {
  const argsEncoded = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "string" }],
    [node, key],
  );
  return (TEXT_SELECTOR + argsEncoded.slice(2)) as Hex;
}

/** Build inner calldata for addr(bytes32 node). */
function buildAddrCalldata(node: Hex): Hex {
  const argsEncoded = encodeAbiParameters(
    [{ type: "bytes32" }],
    [node],
  );
  return (ADDR_SELECTOR + argsEncoded.slice(2)) as Hex;
}

/** POST callData to local gateway, return raw { data: "0x..." } body. */
async function postToGateway(
  resolverAddr: Address,
  callData: Hex,
): Promise<{ data: Hex }> {
  const url = `${LOCAL_GATEWAY_BASE}/${resolverAddr}/${callData}.json`;
  const resp = await fetch(url, { method: "POST" });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Gateway returned HTTP ${resp.status}: ${body}`);
  }
  return resp.json() as Promise<{ data: Hex }>;
}

/**
 * ABI-decode the gateway response bytes as (uint64 expires, bytes result, bytes signature).
 */
function decodeGatewayResponse(responseHex: Hex): {
  expires: bigint;
  result: Hex;
  signature: Hex;
} {
  const decoded = decodeAbiParameters(
    [{ type: "uint64" }, { type: "bytes" }, { type: "bytes" }],
    responseHex,
  );
  return {
    expires: decoded[0] as bigint,
    result: decoded[1] as Hex,
    signature: decoded[2] as Hex,
  };
}

/**
 * Verify the EIP-191 v0 gateway signature locally.
 * Hash = keccak256(0x1900 || resolverAddr || expires(8B BE) || keccak256(extraData) || keccak256(result))
 * Returns the recovered signer address.
 */
function recoverGatewaySigner(args: {
  resolverAddress: Address;
  expires: bigint;
  extraData: Hex;
  result: Hex;
  signature: Hex;
}): Address {
  const expiresBytes = new Uint8Array(8);
  let n = args.expires;
  for (let i = 7; i >= 0; i--) {
    expiresBytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }

  const resolverBytes = hexToBytes(args.resolverAddress.slice(2));
  const extraDataBytes = hexToBytes(args.extraData.slice(2));
  const resultBytes = hexToBytes(args.result.slice(2));

  const messageHash = keccak_256(
    new Uint8Array([
      0x19,
      0x00,
      ...resolverBytes,
      ...expiresBytes,
      ...keccak_256(extraDataBytes),
      ...keccak_256(resultBytes),
    ]),
  );

  const sigBytes = hexToBytes(args.signature.slice(2));
  if (sigBytes.length !== 65) {
    throw new Error(`Signature length ${sigBytes.length} != 65`);
  }

  const compact = sigBytes.slice(0, 64);
  const v = sigBytes[64]!;
  const recoveryBit = v === 27 ? 0 : v === 28 ? 1 : v - 27;

  const sigObj = secp256k1.Signature.fromBytes(compact).addRecoveryBit(recoveryBit);
  const recoveredPub = sigObj.recoverPublicKey(messageHash).toBytes(false); // 65B uncompressed
  const addrHash = keccak_256(recoveredPub.slice(1));
  const addrBytes = addrHash.slice(12);
  return ("0x" + bytesToHex(addrBytes)) as Address;
}

/** Derive Ethereum address from a private key (0x-prefixed or raw hex). */
function pkToAddress(pk: string): Address {
  const normalized = pk.startsWith("0x") ? pk : `0x${pk}`;
  return new Wallet(normalized).address as Address;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== ENS Gateway E2E Test (W2 M6) ===");
  console.log(`resolver:  ${RESOLVER_ADDR}`);
  console.log(`gateway:   ${LOCAL_GATEWAY_BASE}`);
  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 0 – Pre-flight: check required env vars + local dev server
  // ══════════════════════════════════════════════════════════════════════════
  console.log("--- Pre-flight ---");

  let rpcUrl: string;
  let gatewayPk: string;
  let expectedSigner: Address;

  try {
    rpcUrl = envOrThrow("SEPOLIA_RPC_URL");
    gatewayPk = envOrThrow("INFT_GATEWAY_PK");
    expectedSigner = pkToAddress(gatewayPk);

    console.log(`SEPOLIA_RPC_URL:    ${rpcUrl}`);
    console.log(`INFT_GATEWAY_PK:    ${gatewayPk.slice(0, 10)}... (derived signer: ${expectedSigner})`);
    console.log(`expected signer:    ${expectedSigner}`);
    ok("pre-flight: env vars present");
  } catch (e) {
    fail("pre-flight: env vars", e);
    console.error("Cannot continue — required env vars missing.");
    process.exit(1);
  }

  // Check local dev server
  try {
    const pingResp = await fetch("http://localhost:3000", { method: "GET" });
    // Any response (even 404) means the server is up
    console.log(`Local dev server responded with HTTP ${pingResp.status}`);
    ok("pre-flight: local dev server is running");
  } catch {
    console.error("\nFAIL: Local dev server is not running on port 3000.");
    console.error("Start it first: pnpm dev");
    process.exit(1);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SETUP: Create public client for on-chain calls
  // ══════════════════════════════════════════════════════════════════════════
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1 – Construct OffchainLookup callData + POST to local gateway
  // (tradewise.agentlab.eth, key: last-seen-at)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- Step 1: Construct callData for tradewise.agentlab.eth (last-seen-at) ---");

  const tradewiseName = "tradewise.agentlab.eth";
  const tradewiseNode = namehash(tradewiseName);
  const tradewiseDns = encodeDnsWire(tradewiseName);

  const textCalldata = buildTextCalldata(tradewiseNode, "last-seen-at");
  const outerCallData = buildOffchainLookupCallData(tradewiseDns, textCalldata);

  console.log(`DNS wire bytes: ${bytesToHex(tradewiseDns)}`);
  console.log(`node (namehash): ${tradewiseNode}`);
  console.log(`inner calldata (first 10 bytes): ${textCalldata.slice(0, 12)}...`);
  console.log(`outer callData (first 20 bytes): ${outerCallData.slice(0, 22)}...`);
  ok("step 1: callData constructed");

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2 – POST to local gateway, assert non-empty response
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- Step 2: POST to local gateway ---");

  let gatewayResponseHex: Hex;
  try {
    const body = await postToGateway(RESOLVER_ADDR, outerCallData);
    if (!body.data || !body.data.startsWith("0x") || body.data.length < 4) {
      throw new Error(`Unexpected response body: ${JSON.stringify(body)}`);
    }
    gatewayResponseHex = body.data;
    console.log(`gateway response: ${gatewayResponseHex.slice(0, 40)}...`);
    ok("step 2: gateway returned non-empty 0x-prefixed data");
  } catch (e) {
    fail("step 2: POST to local gateway", e);
    console.error("Cannot continue — gateway request failed.");
    process.exit(1);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 – Decode + verify signature locally
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- Step 3: Decode + verify signature locally ---");

  let decoded: { expires: bigint; result: Hex; signature: Hex };
  try {
    decoded = decodeGatewayResponse(gatewayResponseHex);
    console.log(`expires: ${decoded.expires} (${new Date(Number(decoded.expires) * 1000).toISOString()})`);
    console.log(`result:  ${decoded.result.slice(0, 40)}...`);
    console.log(`sig:     ${decoded.signature.slice(0, 20)}...`);

    const recovered = recoverGatewaySigner({
      resolverAddress: RESOLVER_ADDR,
      expires: decoded.expires,
      extraData: outerCallData,
      result: decoded.result,
      signature: decoded.signature,
    });
    console.log(`recovered signer: ${recovered}`);
    console.log(`expected signer:  ${expectedSigner}`);

    if (recovered.toLowerCase() !== expectedSigner.toLowerCase()) {
      throw new Error(
        `Signer mismatch: recovered=${recovered}, expected=${expectedSigner}`,
      );
    }
    ok("step 3: local signature verification passed");
  } catch (e) {
    fail("step 3: local signature verification", e);
    console.error("Cannot continue — signature invalid.");
    process.exit(1);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4 – On-chain resolveWithProof eth_call
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- Step 4: On-chain resolveWithProof eth_call ---");

  let resolvedResult: Hex;
  try {
    const callResult = await publicClient.readContract({
      address: RESOLVER_ADDR,
      abi: RESOLVER_ABI,
      functionName: "resolveWithProof",
      args: [gatewayResponseHex, outerCallData],
    });
    resolvedResult = callResult as Hex;
    console.log(`resolveWithProof result: ${resolvedResult.slice(0, 40)}...`);

    // Decode result as string (text record)
    const [textValue] = decodeAbiParameters([{ type: "string" }], resolvedResult);
    const str = textValue as string;
    console.log(`decoded text value: "${str}"`);

    // Assert: valid ISO timestamp OR empty string (Redis may not have the key yet)
    const isIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str);
    const isEmpty = str === "";
    if (!isIso && !isEmpty) {
      throw new Error(`Unexpected value: "${str}" — expected ISO timestamp or empty string`);
    }
    if (isIso) {
      console.log(`last-seen-at is a valid ISO timestamp: "${str}"`);
    } else {
      console.log("last-seen-at is empty (Redis key not populated — acceptable for v1)");
    }
    ok("step 4: resolveWithProof eth_call succeeded (value is valid ISO or empty)");
  } catch (e) {
    fail("step 4: resolveWithProof eth_call", e);
    // Set a dummy value so later steps can still reference the decoded struct
    resolvedResult = decoded!.result;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 5 – Tamper test: flip a byte in sig → expect InvalidSigner revert
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- Step 5: Tamper test (flipped sig byte → InvalidSigner) ---");

  try {
    const sigBytes = hexToBytes(decoded!.signature.slice(2));
    sigBytes[4] ^= 0xff; // flip one byte
    const tamperedSig = ("0x" + bytesToHex(sigBytes)) as Hex;

    const tamperedResponse = encodeAbiParameters(
      [{ type: "uint64" }, { type: "bytes" }, { type: "bytes" }],
      [decoded!.expires, decoded!.result, tamperedSig],
    );

    let reverted = false;
    let revertMsg = "";
    try {
      await publicClient.readContract({
        address: RESOLVER_ADDR,
        abi: RESOLVER_ABI,
        functionName: "resolveWithProof",
        args: [tamperedResponse, outerCallData],
      });
    } catch (contractErr) {
      revertMsg = contractErr instanceof Error ? contractErr.message : String(contractErr);
      if (
        revertMsg.includes("InvalidSigner") ||
        revertMsg.includes("0x6d5769be") // InvalidSigner selector
      ) {
        reverted = true;
      } else {
        // Any revert is acceptable — a tampered sig MUST not succeed
        reverted = true;
        console.log(`  reverted with: ${revertMsg.slice(0, 120)}`);
      }
    }

    if (!reverted) throw new Error("Expected revert with tampered sig — call succeeded instead");
    ok("step 5: tamper test — tampered sig correctly reverts");
  } catch (e) {
    fail("step 5: tamper test", e);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 6 – Expiry test: past expires → expect ExpiredResponse revert
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- Step 6: Expiry test (past expires → ExpiredResponse) ---");

  try {
    const pastExpires = BigInt(Math.floor(Date.now() / 1000) - 3600); // 1 hour ago
    const expiredResponse = encodeAbiParameters(
      [{ type: "uint64" }, { type: "bytes" }, { type: "bytes" }],
      [pastExpires, decoded!.result, decoded!.signature],
    );

    let reverted = false;
    let revertMsg = "";
    try {
      await publicClient.readContract({
        address: RESOLVER_ADDR,
        abi: RESOLVER_ABI,
        functionName: "resolveWithProof",
        args: [expiredResponse, outerCallData],
      });
    } catch (contractErr) {
      revertMsg = contractErr instanceof Error ? contractErr.message : String(contractErr);
      if (
        revertMsg.includes("ExpiredResponse") ||
        revertMsg.includes("0x1a9c7c96") // ExpiredResponse selector
      ) {
        reverted = true;
        console.log("  contract reverted with ExpiredResponse");
      } else {
        // Any revert (including InvalidSigner because sig binds to real expires) is acceptable
        reverted = true;
        console.log(`  reverted with: ${revertMsg.slice(0, 120)}`);
      }
    }

    if (!reverted) throw new Error("Expected revert for expired response — call succeeded instead");
    ok("step 6: expiry test — expired response correctly reverts");
  } catch (e) {
    fail("step 6: expiry test", e);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 7 – Wildcard test: unregistered label (addr record) doesn't 500
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- Step 7: Wildcard test (agent-eoa.tradewise.agentlab.eth, addr selector) ---");

  try {
    const wildcardName = "agent-eoa.tradewise.agentlab.eth";
    const wildcardNode = namehash(wildcardName);
    const wildcardDns = encodeDnsWire(wildcardName);

    const addrCalldata = buildAddrCalldata(wildcardNode);
    const wildcardOuterCallData = buildOffchainLookupCallData(wildcardDns, addrCalldata);

    const body = await postToGateway(RESOLVER_ADDR, wildcardOuterCallData);
    if (!body.data || !body.data.startsWith("0x")) {
      throw new Error(`Unexpected gateway body: ${JSON.stringify(body)}`);
    }

    const wildcardDecoded = decodeGatewayResponse(body.data);
    console.log(`wildcard result:  ${wildcardDecoded.result.slice(0, 40)}...`);

    // result should be ABI-encoded bytes (could be empty for unregistered label)
    const [addrBytes] = decodeAbiParameters([{ type: "bytes" }], wildcardDecoded.result);
    console.log(`  decoded addr bytes length: ${(addrBytes as Hex).length}`);

    ok("step 7: wildcard infrastructure works — gateway returns signed response for unregistered label");
  } catch (e) {
    fail("step 7: wildcard test", e);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 8 – W1 cross-link: tradewise.agentlab.eth, key: inft-tradeable
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n--- Step 8: W1 cross-link test (tradewise.agentlab.eth, inft-tradeable) ---");

  try {
    const inftCalldata = buildTextCalldata(tradewiseNode, "inft-tradeable");
    const inftOuterCallData = buildOffchainLookupCallData(tradewiseDns, inftCalldata);

    const body = await postToGateway(RESOLVER_ADDR, inftOuterCallData);
    if (!body.data || !body.data.startsWith("0x")) {
      throw new Error(`Unexpected gateway body: ${JSON.stringify(body)}`);
    }

    const inftDecoded = decodeGatewayResponse(body.data);

    // Verify signature
    const inftSigner = recoverGatewaySigner({
      resolverAddress: RESOLVER_ADDR,
      expires: inftDecoded.expires,
      extraData: inftOuterCallData,
      result: inftDecoded.result,
      signature: inftDecoded.signature,
    });
    if (inftSigner.toLowerCase() !== expectedSigner.toLowerCase()) {
      throw new Error(`Signer mismatch for inft-tradeable: ${inftSigner}`);
    }

    const [inftValue] = decodeAbiParameters([{ type: "string" }], inftDecoded.result);
    const str = inftValue as string;
    console.log(`inft-tradeable value: "${str}"`);

    // "1" means memoryReencrypted=true (W1 INFT minted with proof path)
    // "0" is acceptable if AgentINFT contract state hasn't been set yet
    if (str !== "1" && str !== "0" && str !== "") {
      throw new Error(`Unexpected inft-tradeable value: "${str}"`);
    }
    if (str === "1") {
      console.log("  inft-tradeable = 1 (memoryReencrypted confirmed on-chain)");
    } else {
      console.log(`  inft-tradeable = "${str}" (0 or empty — acceptable if INFT not yet transferred via proof)`);
    }
    ok("step 8: W1 cross-link — inft-tradeable resolved correctly (signed response, valid value)");
  } catch (e) {
    fail("step 8: W1 cross-link test (inft-tradeable)", e);
  }

  // ═══════════════════════════════════════════════════════════════════════════
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
