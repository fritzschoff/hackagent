import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  console.log("[keeperhub-webhook]", body);
  return Response.json({ ok: true });
}
