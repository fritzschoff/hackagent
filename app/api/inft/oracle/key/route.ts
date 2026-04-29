import { NextResponse } from "next/server";
import { oracleAddress } from "@/lib/inft-oracle";
import { getSepoliaAddresses } from "@/lib/edge-config";

export const runtime = "nodejs";
// 60 second edge cache — public route, no auth
export const revalidate = 60;

export async function GET(): Promise<NextResponse> {
  const addrs = await getSepoliaAddresses();

  // TODO(M7): populate inftVerifierAddress in Edge Config after deploy.
  // verifierAddress will be available once AgentINFTVerifier is deployed (M7).
  const verifierAddress =
    (addrs as Record<string, unknown>)["inftVerifierAddress"] ?? null;

  const now = Math.floor(Date.now() / 1000);
  const thirtyDays = 30 * 24 * 60 * 60;
  const defaultExpiresAt = new Date((now + thirtyDays) * 1000).toISOString();

  let oracle: string;
  try {
    oracle = oracleAddress();
  } catch {
    oracle = "0x0000000000000000000000000000000000000000";
  }

  return NextResponse.json({
    oracleAddress: oracle,
    verifierAddress: verifierAddress ?? null,
    defaultExpiresAt,
  });
}
