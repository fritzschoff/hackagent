import { NextRequest, NextResponse } from "next/server";
import { hexToBytes } from "@noble/curves/utils.js";
import { decodeAbiParameters } from "viem";
import {
  decodeDnsName,
  computeRecord,
  signGatewayResponse,
  encodeResponse,
} from "@/lib/ens-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_TTL = 60; // seconds

type Params = { params: Promise<{ sender: string; data: string }> };

async function handle(req: NextRequest, ctx: Params): Promise<NextResponse> {
  const { sender, data: dataParam } = await ctx.params;

  // EIP-3668 GET URL pattern: {base}/{sender}/{data}.json — strip .json suffix
  const dataHex = dataParam.replace(/\.json$/, "");
  if (!/^0x[0-9a-fA-F]+$/.test(dataHex)) {
    return NextResponse.json({ error: "invalid data" }, { status: 400 });
  }

  let nameWire: `0x${string}`;
  let resolveCalldata: `0x${string}`;
  try {
    // Decode the outer (bytes name, bytes resolveCalldata) tuple per EIP-3668 / OffchainLookup spec
    const decoded = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes" }],
      dataHex as `0x${string}`,
    );
    nameWire = decoded[0] as `0x${string}`;
    resolveCalldata = decoded[1] as `0x${string}`;
  } catch {
    return NextResponse.json({ error: "invalid calldata encoding" }, { status: 400 });
  }

  // Decode DNS wire-format name → dotted label string
  const label = decodeDnsName(hexToBytes(nameWire.slice(2)));

  // Parse the inner resolve calldata: 4-byte selector + ABI-encoded args
  const selector = resolveCalldata.slice(0, 10) as `0x${string}`;
  const argsHex = ("0x" + resolveCalldata.slice(10)) as `0x${string}`;

  let args: unknown[] = [];
  if (selector === "0x59d1d43c") {
    // text(bytes32 node, string key)
    args = [...decodeAbiParameters(
      [{ type: "bytes32" }, { type: "string" }],
      argsHex,
    )];
  } else if (selector === "0x3b3b57de") {
    // addr(bytes32 node)
    args = [...decodeAbiParameters(
      [{ type: "bytes32" }],
      argsHex,
    )];
  } else if (selector === "0xf1cb7e06") {
    // addr(bytes32 node, uint256 coinType)
    args = [...decodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }],
      argsHex,
    )];
  } else if (selector === "0xbc1c58d1") {
    // contenthash(bytes32 node)
    args = [...decodeAbiParameters(
      [{ type: "bytes32" }],
      argsHex,
    )];
  } else {
    return NextResponse.json({ error: "unsupported selector" }, { status: 400 });
  }

  const { encoded } = await computeRecord(label, selector, args);
  const expires = Math.floor(Date.now() / 1000) + RESPONSE_TTL;
  const signed = signGatewayResponse({
    resolverAddress: sender as `0x${string}`,
    expires,
    extraData: dataHex as `0x${string}`,
    result: encoded,
  });

  return NextResponse.json({ data: encodeResponse(signed) });
}

export const GET = handle;
export const POST = handle;
