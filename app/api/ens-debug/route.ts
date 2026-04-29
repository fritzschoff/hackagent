import { NextRequest, NextResponse } from "next/server";
import { readEnsText } from "@/lib/ens-records";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  const key = url.searchParams.get("key");
  if (!name || !key) {
    return NextResponse.json({ error: "missing name/key" }, { status: 400 });
  }
  const t0 = Date.now();
  const value = await readEnsText(name, key);
  return NextResponse.json({
    name,
    key,
    value,
    latencyMs: Date.now() - t0,
  });
}
