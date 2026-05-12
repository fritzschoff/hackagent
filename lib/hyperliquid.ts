import { encode as msgpackEncode } from "@msgpack/msgpack";
import {
  type Address,
  type Hex,
  bytesToHex,
  hexToBytes,
  keccak256,
} from "viem";
import { type PrivateKeyAccount } from "viem/accounts";

/**
 * Hyperliquid client (V1, M2 verification slice).
 *
 * Wraps the two HL REST endpoints — POST /info (read) and POST /exchange
 * (signed writes) — plus the two HL signing schemes (L1 action + user-
 * signed action) using only `viem` so there is no Python SDK in subprocess.
 *
 * Coverage is intentionally narrow: meta, funding rate, clearinghouse
 * state (positions), place order, close (reduce-only). Withdraw signing
 * is in here too because we'll need it for the empirical bridge test,
 * but no production caller invokes it yet.
 *
 * Numbers come from HL_FACTS.md. Anything labelled VERIFY there is also
 * called out at the relevant call site below.
 */

// ─── env config ───────────────────────────────────────────────────────────

export type HlEnv = "mainnet" | "testnet";

type EnvCfg = {
  api: string;
  source: "a" | "b";
  hyperliquidChain: "Mainnet" | "Testnet";
};

const ENVS: Record<HlEnv, EnvCfg> = {
  mainnet: {
    api: "https://api.hyperliquid.xyz",
    source: "a",
    hyperliquidChain: "Mainnet",
  },
  testnet: {
    api: "https://api.hyperliquid-testnet.xyz",
    source: "b",
    hyperliquidChain: "Testnet",
  },
};

/// EIP-712 domain chainId used in L1 action signing. Fixed at 1337 in
/// the Python SDK regardless of env — the env is encoded in
/// `phantom_agent.source` instead. Replay-safe across envs.
const L1_DOMAIN_CHAIN_ID = 1337;

/// EIP-712 signatureChainId literal used in user-signed actions (withdraw,
/// transfers). 0x66eee = 421614 = Arbitrum Sepolia. Constant across envs
/// in the SDK; `hyperliquidChain` field is what segregates Mainnet vs
/// Testnet here.
const USER_SIGN_CHAIN_ID = "0x66eee" as const;

// ─── REST primitives ──────────────────────────────────────────────────────

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`hl ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/// POST /info — info endpoints take `{type, ...}`.
export async function hlInfo<T = unknown>(
  env: HlEnv,
  body: { type: string; [k: string]: unknown },
): Promise<T> {
  return postJson<T>(`${ENVS[env].api}/info`, body);
}

/// POST /exchange — every write goes here, signed.
async function hlExchange<T = unknown>(
  env: HlEnv,
  body: {
    action: object;
    nonce: number;
    signature: { r: Hex; s: Hex; v: number };
    vaultAddress?: Address;
    expiresAfter?: number;
  },
): Promise<T> {
  return postJson<T>(`${ENVS[env].api}/exchange`, body);
}

// ─── L1 action hashing + signing ──────────────────────────────────────────

/// Mirrors hyperliquid-python-sdk `signing.action_hash`:
///   msgpack(action) || nonce_be8 || vault_marker || [opt 0x00 || expires_be8]
function actionHash(
  action: unknown,
  vaultAddress: Address | null,
  nonce: bigint,
  expiresAfter: bigint | null,
): Hex {
  const packed = msgpackEncode(action, { sortKeys: false });
  const nonceBuf = new Uint8Array(8);
  new DataView(nonceBuf.buffer).setBigUint64(0, nonce, false);

  const parts: Uint8Array[] = [packed, nonceBuf];

  if (vaultAddress === null) {
    parts.push(new Uint8Array([0x00]));
  } else {
    parts.push(new Uint8Array([0x01]));
    parts.push(hexToBytes(vaultAddress));
  }

  if (expiresAfter !== null) {
    const expBuf = new Uint8Array(8);
    new DataView(expBuf.buffer).setBigUint64(0, expiresAfter, false);
    parts.push(new Uint8Array([0x00]));
    parts.push(expBuf);
  }

  const merged = concatBytes(parts);
  return keccak256(bytesToHex(merged));
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/// Sign an L1 action (orders, cancels, vault ops) and return the
/// {r,s,v}-shaped signature HL expects in the /exchange body.
async function signL1Action(args: {
  account: PrivateKeyAccount;
  action: unknown;
  env: HlEnv;
  nonce: bigint;
  vaultAddress?: Address | null;
  expiresAfter?: bigint | null;
}): Promise<{ r: Hex; s: Hex; v: number }> {
  const hash = actionHash(
    args.action,
    args.vaultAddress ?? null,
    args.nonce,
    args.expiresAfter ?? null,
  );
  const phantomAgent = {
    source: ENVS[args.env].source,
    connectionId: hash,
  };
  const sig = await args.account.signTypedData({
    domain: {
      name: "Exchange",
      version: "1",
      chainId: L1_DOMAIN_CHAIN_ID,
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types: {
      Agent: [
        { name: "source", type: "string" },
        { name: "connectionId", type: "bytes32" },
      ],
    },
    primaryType: "Agent",
    message: phantomAgent,
  });
  return splitRSV(sig);
}

function splitRSV(sig: Hex): { r: Hex; s: Hex; v: number } {
  const stripped = sig.startsWith("0x") ? sig.slice(2) : sig;
  if (stripped.length !== 130) {
    throw new Error(`invalid sig length: ${stripped.length}`);
  }
  return {
    r: `0x${stripped.slice(0, 64)}` as Hex,
    s: `0x${stripped.slice(64, 128)}` as Hex,
    v: parseInt(stripped.slice(128, 130), 16),
  };
}

// ─── user-signed actions (withdraw / transfers) ───────────────────────────

type UserSignType = { name: string; type: string };

async function signUserAction(args: {
  account: PrivateKeyAccount;
  action: Record<string, unknown>;
  primaryType: string;
  payloadTypes: UserSignType[];
  env: HlEnv;
}): Promise<{ action: Record<string, unknown>; sig: { r: Hex; s: Hex; v: number } }> {
  const enriched = {
    ...args.action,
    signatureChainId: USER_SIGN_CHAIN_ID,
    hyperliquidChain: ENVS[args.env].hyperliquidChain,
  };
  const sig = await args.account.signTypedData({
    domain: {
      name: "HyperliquidSignTransaction",
      version: "1",
      chainId: BigInt(USER_SIGN_CHAIN_ID),
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types: {
      [args.primaryType]: args.payloadTypes,
    },
    primaryType: args.primaryType,
    message: enriched,
  });
  return { action: enriched, sig: splitRSV(sig) };
}

// ─── public surface: info reads ───────────────────────────────────────────

export type AssetMeta = { name: string; szDecimals: number };
export type Meta = { universe: AssetMeta[] };

export async function getMeta(env: HlEnv): Promise<Meta> {
  return hlInfo<Meta>(env, { type: "meta" });
}

/// Index of `asset` in `meta.universe` — the integer HL expects in order
/// payloads. ETH = 0 historically but never assume.
export async function getAssetIndex(env: HlEnv, asset: string): Promise<number> {
  const meta = await getMeta(env);
  const idx = meta.universe.findIndex((a) => a.name === asset);
  if (idx < 0) throw new Error(`asset not found in HL universe: ${asset}`);
  return idx;
}

type AssetCtx = {
  funding: string; // float-as-string, per-hour funding rate
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string | null;
  oraclePx: string;
  markPx: string;
  midPx: string | null;
};
type MetaAndAssetCtxs = [Meta, AssetCtx[]];

export async function getFundingRate(
  env: HlEnv,
  asset: string,
): Promise<{ assetIdx: number; fundingHourly: number; oraclePx: number; markPx: number }> {
  const result = await hlInfo<MetaAndAssetCtxs>(env, {
    type: "metaAndAssetCtxs",
  });
  const [meta, ctxs] = result;
  const idx = meta.universe.findIndex((a) => a.name === asset);
  if (idx < 0) throw new Error(`asset not found: ${asset}`);
  const ctx = ctxs[idx];
  if (!ctx) throw new Error(`no ctx for asset idx ${idx}`);
  return {
    assetIdx: idx,
    fundingHourly: Number(ctx.funding),
    oraclePx: Number(ctx.oraclePx),
    markPx: Number(ctx.markPx),
  };
}

export type ClearinghouseState = {
  assetPositions: Array<{
    position: {
      coin: string;
      szi: string; // signed size; positive = long, negative = short
      entryPx: string | null;
      positionValue: string;
      unrealizedPnl: string;
      returnOnEquity: string;
      leverage: { type: string; value: number };
      liquidationPx: string | null;
      marginUsed: string;
    };
  }>;
  marginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  withdrawable: string;
};

export async function getClearinghouseState(
  env: HlEnv,
  user: Address,
): Promise<ClearinghouseState> {
  return hlInfo<ClearinghouseState>(env, {
    type: "clearinghouseState",
    user: user.toLowerCase(),
  });
}

export async function getPosition(
  env: HlEnv,
  user: Address,
  asset: string,
): Promise<ClearinghouseState["assetPositions"][number]["position"] | null> {
  const state = await getClearinghouseState(env, user);
  const found = state.assetPositions.find(
    (p) => p.position.coin === asset,
  );
  return found?.position ?? null;
}

// ─── public surface: writes (orders) ──────────────────────────────────────

/// HL wire format for an order — keys are short on purpose; this is what
/// gets msgpack-encoded and hashed.
type OrderWire = {
  a: number; // asset
  b: boolean; // is_buy
  p: string; // limit price as decimal string
  s: string; // size as decimal string
  r: boolean; // reduce_only
  t: { limit: { tif: "Alo" | "Ioc" | "Gtc" } };
};

/// Mirrors hyperliquid-python-sdk float_to_wire — string with ≤8 decimals,
/// trailing zeros trimmed.
function floatToWire(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`not finite: ${x}`);
  const rounded = x.toFixed(8);
  if (Math.abs(Number(rounded) - x) >= 1e-12) {
    throw new Error(`float_to_wire rounding: ${x}`);
  }
  // Trim trailing zeros (and the decimal point if all-trim).
  let s = rounded;
  if (s.includes(".")) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  if (s === "-0") s = "0";
  return s;
}

export async function placeOrder(args: {
  env: HlEnv;
  account: PrivateKeyAccount;
  asset: string; // e.g. "ETH"
  isBuy: boolean;
  size: number;
  limitPx: number;
  reduceOnly?: boolean;
  tif?: "Alo" | "Ioc" | "Gtc";
}): Promise<{ status: string; response: unknown }> {
  const assetIdx = await getAssetIndex(args.env, args.asset);
  const wire: OrderWire = {
    a: assetIdx,
    b: args.isBuy,
    p: floatToWire(args.limitPx),
    s: floatToWire(args.size),
    r: args.reduceOnly ?? false,
    t: { limit: { tif: args.tif ?? "Gtc" } },
  };
  const action = {
    type: "order",
    orders: [wire],
    grouping: "na",
  };
  const nonce = BigInt(Date.now());
  const sig = await signL1Action({
    account: args.account,
    action,
    env: args.env,
    nonce,
  });
  return hlExchange<{ status: string; response: unknown }>(args.env, {
    action,
    nonce: Number(nonce),
    signature: sig,
  });
}

/// Opens a market-ish position via an IOC limit at the worst-case slippage
/// price. `slippageBps` (e.g. 50 = 0.5%) sets how far through the book we
/// will sweep.
export async function openPosition(args: {
  env: HlEnv;
  account: PrivateKeyAccount;
  asset: string;
  isBuy: boolean;
  size: number;
  slippageBps?: number;
}): Promise<{ status: string; response: unknown }> {
  const { markPx } = await getFundingRate(args.env, args.asset);
  const slip = (args.slippageBps ?? 50) / 10_000;
  const limitPx = args.isBuy ? markPx * (1 + slip) : markPx * (1 - slip);
  return placeOrder({
    env: args.env,
    account: args.account,
    asset: args.asset,
    isBuy: args.isBuy,
    size: args.size,
    limitPx: roundToTick(limitPx),
    reduceOnly: false,
    tif: "Ioc",
  });
}

/// Reduce-only close. `size` defaults to the full current position.
export async function closePosition(args: {
  env: HlEnv;
  account: PrivateKeyAccount;
  asset: string;
  size?: number;
  slippageBps?: number;
}): Promise<{ status: string; response: unknown }> {
  const pos = await getPosition(args.env, args.account.address, args.asset);
  if (!pos) throw new Error(`no position open in ${args.asset}`);
  const szi = Number(pos.szi);
  if (szi === 0) throw new Error(`flat in ${args.asset}`);
  const closeSize = args.size ?? Math.abs(szi);
  // Selling closes a long, buying closes a short.
  const isBuy = szi < 0;
  const { markPx } = await getFundingRate(args.env, args.asset);
  const slip = (args.slippageBps ?? 50) / 10_000;
  const limitPx = isBuy ? markPx * (1 + slip) : markPx * (1 - slip);
  return placeOrder({
    env: args.env,
    account: args.account,
    asset: args.asset,
    isBuy,
    size: closeSize,
    limitPx: roundToTick(limitPx),
    reduceOnly: true,
    tif: "Ioc",
  });
}

/// HL prices have tick precision derived from asset config. For V1 we
/// snap to 5 sig figs which is conservative for major pairs (BTC/ETH).
/// VERIFY against meta `pxDecimals` once we wire the proper rule.
function roundToTick(px: number): number {
  if (px <= 0) return px;
  const mag = Math.floor(Math.log10(px));
  const decimals = Math.max(0, 4 - mag);
  const f = 10 ** decimals;
  return Math.round(px * f) / f;
}

// ─── public surface: withdraw signing (for the empirical bridge test) ─────

export const WITHDRAW_SIGN_TYPES: UserSignType[] = [
  { name: "hyperliquidChain", type: "string" },
  { name: "destination", type: "string" },
  { name: "amount", type: "string" },
  { name: "time", type: "uint64" },
];

export async function signWithdraw(args: {
  env: HlEnv;
  account: PrivateKeyAccount;
  destination: Address; // Arbitrum address to receive USDC
  amountUsdc: number; // human float, e.g. 20
}): Promise<{ action: Record<string, unknown>; nonce: number; signature: { r: Hex; s: Hex; v: number } }> {
  const time = Date.now();
  const action = {
    type: "withdraw3",
    destination: args.destination.toLowerCase(),
    amount: floatToWire(args.amountUsdc),
    time,
  };
  const signed = await signUserAction({
    account: args.account,
    action,
    primaryType: "HyperliquidTransaction:Withdraw",
    payloadTypes: WITHDRAW_SIGN_TYPES,
    env: args.env,
  });
  return { action: signed.action, nonce: time, signature: signed.sig };
}

export async function withdraw(args: {
  env: HlEnv;
  account: PrivateKeyAccount;
  destination: Address;
  amountUsdc: number;
}): Promise<unknown> {
  const { action, nonce, signature } = await signWithdraw(args);
  return hlExchange(args.env, { action, nonce, signature });
}
