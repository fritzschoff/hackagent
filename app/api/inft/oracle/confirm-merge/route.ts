import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseAbiItem } from "viem";
import { commitPending } from "@/lib/inft-redis";
import { sepoliaPublicClient } from "@/lib/wallets";
import { getSepoliaAddresses } from "@/lib/edge-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  mergedAgentId: z.number(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  // Nonces for both source token pending keys
  nonce1: z.string().regex(/^0x[a-fA-F0-9]+$/),
  nonce2: z.string().regex(/^0x[a-fA-F0-9]+$/),
  src1TokenId: z.string().regex(/^\d+$/),
  src2TokenId: z.string().regex(/^\d+$/),
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

  const { txHash, nonce1, nonce2 } = parsed.data;
  const tokenId1 = BigInt(parsed.data.src1TokenId);
  const tokenId2 = BigInt(parsed.data.src2TokenId);
  const mergedAgentId = BigInt(parsed.data.mergedAgentId);

  const addrs = await getSepoliaAddresses();
  const inftAddress = addrs.inftAddress;
  if (!inftAddress) {
    return NextResponse.json({ error: "inft_not_deployed" }, { status: 503 });
  }

  const client = sepoliaPublicClient();

  // Verify tx receipt: must be successful
  const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  if (!receipt) {
    return NextResponse.json({ error: "tx not found" }, { status: 400 });
  }
  if (receipt.status !== "success") {
    return NextResponse.json({ error: "tx reverted" }, { status: 400 });
  }

  // Verify AgentsMerged event with matching mergedAgentId
  const agentsMergedEvent = parseAbiItem(
    "event AgentsMerged(uint256 indexed mergerIndex, uint256 indexed mergedAgentId, uint256 sourceAgentId1, uint256 sourceAgentId2, uint256 sourceTokenId1, uint256 sourceTokenId2, bytes32 sealedMemoryRoot, string sealedMemoryUri, address recordedBy)",
  );
  const logs = await client.getLogs({
    event: agentsMergedEvent,
    args: { mergedAgentId },
    blockHash: receipt.blockHash,
  });

  if (logs.length === 0) {
    return NextResponse.json(
      { error: "AgentsMerged event not found in tx" },
      { status: 400 },
    );
  }

  // Commit both pending keys
  const [committed1, committed2] = await Promise.all([
    commitPending(tokenId1, nonce1),
    commitPending(tokenId2, nonce2),
  ]);

  if (!committed1 || !committed2) {
    console.warn(
      `[confirm-merge] partial commit: token1=${committed1} token2=${committed2}`,
    );
  }

  return NextResponse.json({ ok: true });
}
