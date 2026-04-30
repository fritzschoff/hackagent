import { NextRequest, NextResponse } from "next/server";
import { readEnsText } from "@/lib/ens-records";
import { sepoliaPublicClient } from "@/lib/wallets";

const TEXT_KEYS = [
  "last-seen-at",
  "memory-rotations",
  "inft-tradeable",
  "outstanding-bids",
  "reputation-summary",
  "avatar",
  "agent-card",
  "description",
  "url",
] as const;

async function readAddrSafe(name: string): Promise<string | null> {
  try {
    return await sepoliaPublicClient().getEnsAddress({ name });
  } catch {
    return null;
  }
}

async function readNameSafe(address: `0x${string}`): Promise<string | null> {
  try {
    return await sepoliaPublicClient().getEnsName({ address });
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  const key = url.searchParams.get("key");
  const all = url.searchParams.get("all") === "1";
  const reverseAddr = url.searchParams.get("reverse");

  if (reverseAddr) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(reverseAddr)) {
      return NextResponse.json({ error: "invalid reverse address" }, { status: 400 });
    }
    const t0 = Date.now();
    const value = await readNameSafe(reverseAddr as `0x${string}`);
    return NextResponse.json({
      kind: "reverse",
      address: reverseAddr,
      value,
      latencyMs: Date.now() - t0,
    });
  }

  if (!name) {
    return NextResponse.json({ error: "missing name" }, { status: 400 });
  }

  if (all) {
    const t0 = Date.now();
    const [addr, ...textValues] = await Promise.all([
      readAddrSafe(name),
      ...TEXT_KEYS.map((k) => readEnsText(name, k)),
    ]);
    const records: Record<string, string | null> = { addr };
    TEXT_KEYS.forEach((k, i) => {
      records[k] = textValues[i] ?? null;
    });
    return NextResponse.json({
      kind: "all",
      name,
      records,
      latencyMs: Date.now() - t0,
    });
  }

  if (!key) {
    return NextResponse.json({ error: "missing key" }, { status: 400 });
  }

  const t0 = Date.now();
  if (key === "addr") {
    const value = await readAddrSafe(name);
    return NextResponse.json({
      kind: "addr",
      name,
      key,
      value,
      latencyMs: Date.now() - t0,
    });
  }

  const value = await readEnsText(name, key);
  return NextResponse.json({
    kind: "text",
    name,
    key,
    value,
    latencyMs: Date.now() - t0,
  });
}
