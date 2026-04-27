import { NextResponse } from "next/server";
import { getSepoliaAddresses } from "@/lib/edge-config";
import { readInft } from "@/lib/inft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId: tokenIdStr } = await ctx.params;
  const tokenId = BigInt(tokenIdStr);

  const url = new URL(req.url);
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`;

  const addresses = await getSepoliaAddresses();
  if (!addresses.inftAddress || !addresses.identityRegistryV2) {
    return NextResponse.json(
      { error: "inft_not_deployed" },
      { status: 404 },
    );
  }

  const inft = await readInft({
    tokenId,
    inftAddress: addresses.inftAddress,
    registryV2Address: addresses.identityRegistryV2,
  });
  if (!inft) {
    return NextResponse.json(
      { error: "token_not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      name: `tradewise.agentlab.eth #${inft.tokenId}`,
      description:
        "Tradewise — autonomous Uniswap quote concierge. ERC-7857 INFT linked to ERC-8004 reputation. On transfer, payout wallet clears (EIP-8004 §4.4).",
      image: `${baseUrl}/avatar.png`,
      external_url: `${baseUrl}/inft`,
      attributes: [
        { trait_type: "agentId", value: Number(inft.agentId) },
        { trait_type: "owner", value: inft.owner },
        {
          trait_type: "payoutWallet",
          value: inft.walletCleared ? "cleared" : (inft.agentWallet ?? "unset"),
        },
        { trait_type: "memoryRoot", value: inft.encryptedMemoryRoot },
        { trait_type: "memoryUri", value: inft.encryptedMemoryUri },
      ],
    },
    {
      headers: { "Cache-Control": "public, max-age=30" },
    },
  );
}
