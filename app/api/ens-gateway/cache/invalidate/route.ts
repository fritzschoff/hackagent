import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  keys: z.array(z.string()).min(1).max(50),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Gate on KEEPERHUB_WEBHOOK_SECRET — invalidations come from KeeperHub workflows
  const secret = process.env.KEEPERHUB_WEBHOOK_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
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

  const r = getRedis();
  if (!r) {
    return NextResponse.json({ error: "no redis" }, { status: 500 });
  }

  await Promise.all(parsed.data.keys.map((k) => r.del(k)));

  return NextResponse.json({ ok: true, deleted: parsed.data.keys.length });
}
