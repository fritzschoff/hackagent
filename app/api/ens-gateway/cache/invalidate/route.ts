import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRedis } from "@/lib/redis";
import { verifyKeeperhubWebhook, unauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/// Redis key prefixes the cache-invalidate webhook is allowed to delete.
/// Restricting this prevents a leaked KEEPERHUB_WEBHOOK_SECRET from
/// wiping load-bearing state — trade-log, earnings counters, funding
/// snapshots, debounce keys, etc.
const ALLOWED_PREFIXES = [
  "ens:dynamic:",
  "ens:static:",
  "reputation:summary:",
  "ens:cache:",
];

const Body = z.object({
  keys: z.array(z.string()).min(1).max(50),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyKeeperhubWebhook(req)) return unauthorized();

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

  const allowed = parsed.data.keys.filter((k) =>
    ALLOWED_PREFIXES.some((p) => k.startsWith(p)),
  );
  const rejected = parsed.data.keys.filter((k) => !allowed.includes(k));

  const r = getRedis();
  if (!r) {
    return NextResponse.json({ error: "no redis" }, { status: 500 });
  }

  await Promise.all(allowed.map((k) => r.del(k)));

  return NextResponse.json({
    ok: true,
    deleted: allowed.length,
    rejected: rejected.length > 0 ? rejected : undefined,
  });
}
