import { NextRequest, NextResponse } from "next/server";
import { rotations } from "@/lib/inft-redis";

export const runtime = "nodejs";

/**
 * GET /api/inft/oracle/meta?tokenId=N
 *
 * Public route (no API key) — returns per-token metadata stored in Redis.
 * Currently: key-rotation counter.
 * Cache: 30 s (revalidate on Vercel edge).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const tokenIdStr = req.nextUrl.searchParams.get("tokenId");
  if (!tokenIdStr || !/^\d+$/.test(tokenIdStr)) {
    return NextResponse.json({ error: "missing or invalid tokenId" }, { status: 400 });
  }

  const tokenId = BigInt(tokenIdStr);

  let count = 0;
  try {
    count = await rotations(tokenId);
  } catch {
    // Redis unavailable in dev — return 0 gracefully
    count = 0;
  }

  return NextResponse.json(
    { rotations: count },
    {
      headers: {
        "Cache-Control": "public, max-age=30, s-maxage=30",
      },
    },
  );
}
