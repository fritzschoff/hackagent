/**
 * Smoke test for lib/ens-gateway.ts (Task 6).
 *
 * Run with:
 *   INFT_GATEWAY_PK=0x$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
 *     pnpm exec tsx scripts/ens-gateway-smoke.ts
 *
 * Does NOT require Redis, Edge Config, or an RPC endpoint — all live reads
 * are exercised only via the text record paths that need them; the smoke avoids
 * those paths intentionally.
 */

import { encodeAbiParameters } from "viem";
import {
  gatewayAddress,
  decodeDnsName,
  labelToAgent,
  computeRecord,
  signGatewayResponse,
  encodeResponse,
} from "../lib/ens-gateway";

async function main() {
  // 1. Gateway address derived from env PK.
  const addr = gatewayAddress();
  console.log("gateway address:", addr);
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error(`gatewayAddress returned unexpected value: ${addr}`);
  }
  console.log("✓ gatewayAddress OK");

  // 2. DNS wire-format decoder.
  // "tradewise.agentlab.eth" in wire format:
  //   09 t r a d e w i s e  08 a g e n t l a b  03 e t h  00
  const wire = new Uint8Array([
    0x09,
    ...Array.from("tradewise").map((c) => c.charCodeAt(0)),
    0x08,
    ...Array.from("agentlab").map((c) => c.charCodeAt(0)),
    0x03,
    ...Array.from("eth").map((c) => c.charCodeAt(0)),
    0x00,
  ]);
  const decoded = decodeDnsName(wire);
  if (decoded !== "tradewise.agentlab.eth") {
    throw new Error(`decodeDnsName returned "${decoded}", expected "tradewise.agentlab.eth"`);
  }
  console.log("✓ decodeDnsName OK:", decoded);

  // 3. labelToAgent hardcoded mapping.
  const agent1 = await labelToAgent("tradewise.agentlab.eth");
  if (!agent1 || agent1.agentId !== 1 || agent1.tokenId !== 1) {
    throw new Error(`labelToAgent(tradewise) returned unexpected: ${JSON.stringify(agent1)}`);
  }
  const agent2 = await labelToAgent("pricewatch.agentlab.eth");
  if (!agent2 || agent2.agentId !== 2 || agent2.tokenId !== null) {
    throw new Error(`labelToAgent(pricewatch) returned unexpected: ${JSON.stringify(agent2)}`);
  }
  const agentNull = await labelToAgent("unknown.agentlab.eth");
  if (agentNull !== null) {
    throw new Error(`labelToAgent(unknown) should return null, got: ${JSON.stringify(agentNull)}`);
  }
  console.log("✓ labelToAgent OK");

  // 4. computeRecord for a text selector — Redis/RPC paths gracefully return ""
  //    when those services are absent.
  const textOut = await computeRecord(
    "tradewise.agentlab.eth",
    "0x59d1d43c",
    ["0x0000000000000000000000000000000000000000000000000000000000000000", "last-seen-at"],
  );
  if (!textOut.encoded.startsWith("0x")) {
    throw new Error(`computeRecord text result must be 0x-prefixed hex`);
  }
  console.log(
    "✓ computeRecord(text) encoded:",
    textOut.encoded.slice(0, 66) + "...",
  );

  // 5. computeRecord for contenthash selector — must return 0x-prefixed.
  const chOut = await computeRecord(
    "tradewise.agentlab.eth",
    "0xbc1c58d1",
    ["0x0000000000000000000000000000000000000000000000000000000000000000"],
  );
  if (!chOut.encoded.startsWith("0x")) {
    throw new Error(`computeRecord contenthash result must be 0x-prefixed hex`);
  }
  console.log("✓ computeRecord(contenthash) OK");

  // 6. signGatewayResponse + encodeResponse.
  const result = encodeAbiParameters([{ type: "string" }], ["hello world"]);
  const resolverAddress = "0x0000000000000000000000000000000000001234" as `0x${string}`;
  const extraData = "0xdeadbeef" as `0x${string}`;
  const expires = Math.floor(Date.now() / 1000) + 60;

  const signed = signGatewayResponse({
    resolverAddress,
    expires,
    extraData,
    result,
  });

  // Signature must be exactly 65 bytes → 0x + 130 hex chars = 132 total.
  if (signed.signature.length !== 132) {
    throw new Error(
      `signature length ${signed.signature.length} != 132 (expected 65 bytes as 0x-hex)`,
    );
  }
  console.log("✓ signGatewayResponse signature length OK:", signed.signature.length);

  const encoded = encodeResponse(signed);
  if (!encoded.startsWith("0x") || encoded.length < 10) {
    throw new Error(`encodeResponse returned invalid hex: ${encoded.slice(0, 40)}`);
  }
  console.log("✓ encodeResponse bytes length:", (encoded.length - 2) / 2);

  console.log("\n✓ all checks passed");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
