import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth, unauthorized } from "@/lib/cron-auth";
import {
  readTreasury,
  pingHeartbeat,
  depositToExchange,
  withdrawFromExchange,
  openPosition,
  closePosition,
  distributeRevenue,
} from "@/lib/treasury";

export const runtime = "nodejs";
export const maxDuration = 30;

/// GET /api/treasury — read current state. Public.
export async function GET() {
  const view = await readTreasury();
  if (!view) {
    return NextResponse.json({ ok: true, treasury: null }, { status: 200 });
  }
  // bigints → strings so JSON.stringify doesn't throw
  return NextResponse.json({
    ok: true,
    treasury: {
      address: view.address,
      agent: view.agent,
      owner: view.owner,
      usdcBalance: view.usdcBalance.toString(),
      positionId: view.positionId,
      positionSize: view.positionSize.toString(),
      positionCollateral: view.positionCollateral.toString(),
      lastHeartbeat: Number(view.lastHeartbeat),
      heartbeatTimeout: Number(view.heartbeatTimeout),
      heartbeatStale: view.heartbeatStale,
      killed: view.killed,
    },
  });
}

/// POST /api/treasury — agent-only orchestration via CRON_SECRET.
///
/// Body: { action, amount?, size?, collateral? }
///   action: "heartbeat" | "deposit" | "withdraw" | "open" | "close" | "distribute"
///   amount / size / collateral: stringified bigints (USDC base = 1e6, size = 1e18)
export async function POST(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    amount?: string;
    size?: string;
    collateral?: string;
  };
  const action = body.action;

  try {
    switch (action) {
      case "heartbeat": {
        const txHash = await pingHeartbeat();
        return NextResponse.json({ ok: true, action, txHash });
      }
      case "deposit": {
        if (!body.amount) return badRequest("missing amount");
        const txHash = await depositToExchange(BigInt(body.amount));
        return NextResponse.json({ ok: true, action, txHash });
      }
      case "withdraw": {
        if (!body.amount) return badRequest("missing amount");
        const txHash = await withdrawFromExchange(BigInt(body.amount));
        return NextResponse.json({ ok: true, action, txHash });
      }
      case "open": {
        if (!body.size || !body.collateral)
          return badRequest("missing size or collateral");
        const txHash = await openPosition(
          BigInt(body.size),
          BigInt(body.collateral),
        );
        return NextResponse.json({ ok: true, action, txHash });
      }
      case "close": {
        const txHash = await closePosition();
        return NextResponse.json({ ok: true, action, txHash });
      }
      case "distribute": {
        if (!body.amount) return badRequest("missing amount");
        const txHash = await distributeRevenue(BigInt(body.amount));
        return NextResponse.json({ ok: true, action, txHash });
      }
      default:
        return badRequest(`unknown action: ${action ?? "<missing>"}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[treasury:${action}] failed:`, msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}
