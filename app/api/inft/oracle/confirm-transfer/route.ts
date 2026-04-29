import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseAbiItem } from "viem";
import { commitPending, rotations } from "@/lib/inft-redis";
import { sepoliaPublicClient } from "@/lib/wallets";
import { getSepoliaAddresses } from "@/lib/edge-config";
import AgentINFTAbi from "@/lib/abis/AgentINFT.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tokenId: z.string().regex(/^\d+$/),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  sellerNonce: z.string().regex(/^0x[a-fA-F0-9]{96}$/),
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
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const tokenId = BigInt(parsed.data.tokenId);
  const txHash = parsed.data.txHash as `0x${string}`;
  const sellerNonce = parsed.data.sellerNonce;

  const addrs = await getSepoliaAddresses();
  const inftAddress = addrs.inftAddress;
  if (!inftAddress) {
    return NextResponse.json({ error: "inft_not_deployed" }, { status: 503 });
  }

  const client = sepoliaPublicClient();

  // Verify tx receipt: must be successful
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (!receipt) {
    return NextResponse.json({ error: "tx not found" }, { status: 400 });
  }
  if (receipt.status !== "success") {
    return NextResponse.json({ error: "tx reverted" }, { status: 400 });
  }

  // Verify the Transferred(tokenId, from, to) event is present in this tx
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
      { error: "Transferred event not found in tx" },
      { status: 400 },
    );
  }

  // Confirm: rotate the pending key into the active key
  const committed = await commitPending(tokenId, sellerNonce);
  if (!committed) {
    return NextResponse.json(
      { error: "no pending key found (already committed or expired)" },
      { status: 400 },
    );
  }

  const rot = await rotations(tokenId);
  void AgentINFTAbi; // referenced for type context

  return NextResponse.json({ ok: true, rotations: rot });
}
