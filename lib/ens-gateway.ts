import { keccak_256 } from "@noble/hashes/sha3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hexToBytes, bytesToHex } from "@noble/curves/utils.js";
import { Wallet } from "ethers";
import { encodeAbiParameters } from "viem";
import { sepoliaPublicClient } from "@/lib/wallets";
import { getRedis } from "@/lib/redis";
import { getSepoliaAddresses } from "@/lib/edge-config";
import AgentINFTAbi from "@/lib/abis/AgentINFT.json";
import AgentBidsAbi from "@/lib/abis/AgentBids.json";
import ReputationRegistryAbi from "@/lib/abis/ReputationRegistry.json";

// ----------------------------------------------------------------------------
// Selectors
// ----------------------------------------------------------------------------
const TEXT_SELECTOR = "0x59d1d43c"; // text(bytes32,string)
const ADDR_SELECTOR = "0x3b3b57de"; // addr(bytes32)
const ADDR_COIN_SELECTOR = "0xf1cb7e06"; // addr(bytes32,uint256)
const CONTENTHASH_SELECTOR = "0xbc1c58d1"; // contenthash(bytes32)

// ----------------------------------------------------------------------------
// Internal key helpers
// ----------------------------------------------------------------------------
function gatewaySk(): Uint8Array {
  const pk = process.env.INFT_GATEWAY_PK;
  if (!pk) throw new Error("INFT_GATEWAY_PK missing");
  return hexToBytes(pk.startsWith("0x") ? pk.slice(2) : pk);
}

// ----------------------------------------------------------------------------
// Public: gateway address
// ----------------------------------------------------------------------------
/** Returns the Ethereum address derived from INFT_GATEWAY_PK. */
export function gatewayAddress(): `0x${string}` {
  const pk = process.env.INFT_GATEWAY_PK!;
  return new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`)
    .address as `0x${string}`;
}

// ----------------------------------------------------------------------------
// Public: DNS wire-format decoder
// ----------------------------------------------------------------------------
/**
 * Decodes a DNS wire-format name (per RFC 1035 §3.1) into a dotted label
 * string such as "tradewise.agentlab.eth".
 * Format: 1-byte length prefix per label, terminated by 0x00.
 */
export function decodeDnsName(wire: Uint8Array): string {
  const labels: string[] = [];
  let i = 0;
  while (i < wire.length && wire[i] !== 0) {
    const len = wire[i++]!;
    labels.push(new TextDecoder().decode(wire.slice(i, i + len)));
    i += len;
  }
  return labels.join(".");
}

// ----------------------------------------------------------------------------
// Public: label → agent metadata
// ----------------------------------------------------------------------------
export type AgentInfo = {
  agentId: number | null;
  tokenId: number | null;
  /** When set, computeAddr returns this address directly (skips agentId lookup). */
  addressOverride?: `0x${string}`;
};

/**
 * Direct wallet labels added in W3 for primary-name reverse resolution.
 * Each entry maps a fully-qualified ENS name to a specific wallet address.
 * Forward `addr(label)` lookups MUST match the on-chain reverse record for
 * ENS reverse resolution (`getEnsName(addr)`) to return the label — viem
 * does the round-trip check.
 */
const WALLET_LABELS: Record<string, `0x${string}`> = {
  "agent-eoa.tradewise.agentlab.eth":
    "0x7a83678e330a0C565e6272498FFDF421621820A3",
  "pricewatch-deployer.agentlab.eth":
    "0xBf5df5c89b1eCa32C1E8AC7ECdd93d44F86F2469",
  // VALIDATOR_PK address
  "validator.agentlab.eth":
    "0x01340D5A7A6995513C0C3EdF0367236e5b9C83F6",
  // Turnkey wallet — set by W3 M4 via execute_contract_call setName
  "keeperhub.agentlab.eth":
    "0xB28cC07F397Af54c89b2Ff06b6c595F282856539",
};

/**
 * Maps a fully-qualified label like "tradewise.agentlab.eth" to the agent's
 * identifiers.  Hardcoded for v1; W3 extended with direct wallet labels for
 * nested subnames (agent-eoa, pricewatch-deployer, validator, keeperhub).
 */
export async function labelToAgent(
  label: string,
): Promise<AgentInfo | null> {
  const lower = label.toLowerCase();
  if (lower === "tradewise.agentlab.eth") return { agentId: 1, tokenId: 1 };
  if (lower === "pricewatch.agentlab.eth") return { agentId: 2, tokenId: null };

  // Direct wallet labels (W3): return addressOverride so computeAddr skips the
  // agentId-based edge-config lookup.
  const override = WALLET_LABELS[lower];
  if (override !== undefined) {
    return { agentId: null, tokenId: null, addressOverride: override };
  }

  return null;
}

// ----------------------------------------------------------------------------
// Public: computeRecord
// ----------------------------------------------------------------------------
/**
 * Computes the ABI-encoded value for the given resolve selector.
 *
 * @param label   Fully-qualified ENS name (e.g. "tradewise.agentlab.eth")
 * @param selector 4-byte function selector as 0x-prefixed hex
 * @param args    Decoded ABI arguments from the original resolve() calldata
 */
export async function computeRecord(
  label: string,
  selector: `0x${string}`,
  args: unknown[],
): Promise<{ encoded: `0x${string}` }> {
  if (selector === TEXT_SELECTOR) {
    const key = args[1] as string;
    const value = await computeTextRecord(label, key);
    return {
      encoded: encodeAbiParameters([{ type: "string" }], [value]),
    };
  }

  if (selector === ADDR_SELECTOR || selector === ADDR_COIN_SELECTOR) {
    const addr = await computeAddr(label);
    // addr(bytes32) → abi.encode(address)
    // The CCIP-Read client (viem getEnsAddress) decodes resolveWithProof's result
    // as the return type of addr(bytes32) which is `address`. We must encode
    // as address so abi.decode(result, (address)) yields the correct value.
    return {
      encoded: encodeAbiParameters([{ type: "address" }], [addr]),
    };
  }

  if (selector === CONTENTHASH_SELECTOR) {
    return {
      encoded: encodeAbiParameters([{ type: "bytes" }], ["0x"]),
    };
  }

  // Unknown selector — return empty string.
  return {
    encoded: encodeAbiParameters([{ type: "string" }], [""]),
  };
}

// ----------------------------------------------------------------------------
// Internal: text record computation per spec table
// ----------------------------------------------------------------------------
async function computeTextRecord(
  label: string,
  key: string,
): Promise<string> {
  const agent = await labelToAgent(label);
  if (!agent) return "";

  switch (key) {
    // ---- Edge Config-fed static fields (v1: read from Redis directly) ----
    case "agent-card":
    case "description":
    case "url":
    case "current-price-tier": {
      const v = await getRedis()?.get(`ens:static:${label}:${key}`);
      return v ?? "";
    }

    // ---- W1 cross-link: heartbeat pulse ----
    case "last-seen-at": {
      const v = await getRedis()?.get(`agent:${agent.agentId}:last-seen`);
      return v ?? "";
    }

    // ---- reputation-summary: Redis cache with live fallback ----
    case "reputation-summary": {
      if (agent.agentId === null) return "";
      const cacheKey = `reputation:summary:${agent.agentId}`;
      const cached = await getRedis()?.get(cacheKey);
      if (cached) return cached;
      // Cache miss → live on-chain read
      try {
        const addrs = await getSepoliaAddresses();
        const count = (await sepoliaPublicClient().readContract({
          address: addrs.reputationRegistry as `0x${string}`,
          abi: ReputationRegistryAbi as readonly unknown[],
          functionName: "feedbackCount",
          args: [BigInt(agent.agentId)],
        })) as bigint;
        const summary = `feedback=${count}`;
        // Cache for 5 minutes
        await getRedis()?.set(cacheKey, summary, "EX", 300);
        return summary;
      } catch {
        return "";
      }
    }

    // ---- outstanding-bids: on-chain AgentBids.biddersCount ----
    case "outstanding-bids": {
      if (agent.tokenId === null) return "0";
      try {
        const addrs = await getSepoliaAddresses();
        const count = (await sepoliaPublicClient().readContract({
          address: addrs.agentBidsAddress as `0x${string}`,
          abi: AgentBidsAbi as readonly unknown[],
          functionName: "biddersCount",
          args: [BigInt(agent.tokenId)],
        })) as bigint;
        return String(count);
      } catch {
        return "0";
      }
    }

    // ---- compliance-status: skip v1 ----
    case "compliance-status":
      return "";

    // ---- tvl: skip v1 ----
    case "tvl":
      return "0";

    // ---- inft-tradeable: AgentINFT.memoryReencrypted(tokenId) ----
    // True iff the last transfer went through the proof path (oracle
    // re-encrypted memory to current owner). False after a raw transferFrom
    // bypass — the new owner cannot decrypt the memory blob.
    case "inft-tradeable": {
      if (agent.tokenId === null) return "0";
      try {
        const addrs = await getSepoliaAddresses();
        if (!addrs.inftAddress) return "0";
        const ok = (await sepoliaPublicClient().readContract({
          address: addrs.inftAddress as `0x${string}`,
          abi: AgentINFTAbi as readonly unknown[],
          functionName: "memoryReencrypted",
          args: [BigInt(agent.tokenId)],
        })) as boolean;
        return ok ? "1" : "0";
      } catch {
        return "0";
      }
    }

    // ---- memory-rotations: Redis inft:meta:<tokenId>:rotations ----
    case "memory-rotations": {
      if (agent.tokenId === null) return "0";
      const v = await getRedis()?.get(
        `inft:meta:${agent.tokenId}:rotations`,
      );
      return v ?? "0";
    }

    // ---- avatar: eip155:<chainId>/erc721:<INFT>/<tokenId> ----
    // For labels with their own tokenId (tradewise.agentlab.eth) we point
    // at the agent's INFT directly. For nested wallet labels like
    // agent-eoa.tradewise.agentlab.eth, we fall back to the avatar of the
    // parent agent label so MetaMask / wallet UIs still surface a logo.
    case "avatar": {
      const addrs = await getSepoliaAddresses();
      if (agent.tokenId !== null && addrs.inftAddress) {
        return `eip155:11155111/erc721:${addrs.inftAddress}/${agent.tokenId}`;
      }
      // Walk up the label tree until we find a parent label with a tokenId.
      const parts = label.split(".");
      while (parts.length > 2) {
        parts.shift();
        const parent = parts.join(".");
        const parentAgent = await labelToAgent(parent);
        if (parentAgent?.tokenId !== null && parentAgent?.tokenId !== undefined && addrs.inftAddress) {
          return `eip155:11155111/erc721:${addrs.inftAddress}/${parentAgent.tokenId}`;
        }
      }
      return "";
    }

    default:
      return "";
  }
}

// ----------------------------------------------------------------------------
// Internal: addr resolution
// ----------------------------------------------------------------------------
async function computeAddr(label: string): Promise<`0x${string}`> {
  const zero = "0x0000000000000000000000000000000000000000" as `0x${string}`;
  const agent = await labelToAgent(label);
  if (!agent) return zero;

  // W3 wallet labels: return the hardcoded address directly.
  if (agent.addressOverride !== undefined) return agent.addressOverride;

  if (agent.agentId === null) return zero;

  const addrs = await getSepoliaAddresses();
  if (agent.agentId === 1) {
    return (addrs.agentEOA as `0x${string}`) ?? zero;
  }
  if (agent.agentId === 2) {
    return (addrs.pricewatchEOA as `0x${string}`) ?? zero;
  }
  return zero;
}

// ----------------------------------------------------------------------------
// Public: signing
// ----------------------------------------------------------------------------
export type SignedResponse = {
  expires: number;
  result: `0x${string}`;
  signature: `0x${string}`;
};

/**
 * Signs the EIP-3668 gateway response.
 *
 * The contract's resolveWithProof verifies:
 *   keccak256(abi.encodePacked(
 *     hex"1900",
 *     address(this),
 *     expires,        // uint64 big-endian 8 bytes
 *     keccak256(extraData),
 *     keccak256(result)
 *   ))
 *
 * NOTE: The 0x1900 prefix is INSIDE the outer keccak256 input — this is
 * NOT wrapped in the standard EIP-191 "Ethereum Signed Message:\n32" prefix.
 * We sign the raw digest directly.
 */
export function signGatewayResponse(args: {
  resolverAddress: `0x${string}`;
  expires: number;
  extraData: `0x${string}`;
  result: `0x${string}`;
}): SignedResponse {
  // Encode expires as 8-byte big-endian (uint64).
  const expiresBytes = new Uint8Array(8);
  let n = BigInt(args.expires);
  for (let i = 7; i >= 0; i--) {
    expiresBytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }

  const resolverBytes = hexToBytes(args.resolverAddress.slice(2));
  const extraDataBytes = hexToBytes(
    args.extraData.startsWith("0x") ? args.extraData.slice(2) : args.extraData,
  );
  const resultBytes = hexToBytes(
    args.result.startsWith("0x") ? args.result.slice(2) : args.result,
  );

  // Build the message exactly as the contract does.
  const messageHash = keccak_256(
    new Uint8Array([
      0x19,
      0x00,
      ...resolverBytes,
      ...expiresBytes,
      ...keccak_256(extraDataBytes),
      ...keccak_256(resultBytes),
    ]),
  );

  const sk = gatewaySk();

  // secp256k1.sign() returns a raw 64-byte Uint8Array (compact r || s).
  // prehash: false because messageHash is already the keccak256 digest.
  const compact = secp256k1.sign(messageHash, sk, { prehash: false });

  // Recover the expected uncompressed public key to determine the recovery bit.
  // getPublicKey(sk, false) → 65-byte uncompressed form (0x04 || x || y).
  const pubExpected = secp256k1.getPublicKey(sk, false);
  let recoveryBit = 0;
  for (let rec = 0; rec < 2; rec++) {
    try {
      // Signature.fromBytes with 64-byte compact input defaults to compact format.
      const sigObj = secp256k1.Signature.fromBytes(compact).addRecoveryBit(rec);
      // Point.toBytes(false) returns the 65-byte uncompressed public key.
      const recovered = sigObj
        .recoverPublicKey(messageHash)
        .toBytes(false);
      if (Buffer.from(recovered).equals(Buffer.from(pubExpected))) {
        recoveryBit = rec;
        break;
      }
    } catch {
      // ignore
    }
  }

  // Ethereum v = 27 + recoveryBit
  const v = recoveryBit + 27;
  // Signature layout expected by Solidity: r (32) || s (32) || v (1)
  const sigBytes = new Uint8Array([...compact, v]);

  return {
    expires: args.expires,
    result: args.result,
    signature: `0x${bytesToHex(sigBytes)}` as `0x${string}`,
  };
}

// ----------------------------------------------------------------------------
// Public: response encoding
// ----------------------------------------------------------------------------
/**
 * ABI-encodes the signed gateway response as (uint64 expires, bytes result, bytes signature)
 * for the resolveWithProof callback.
 */
export function encodeResponse(r: SignedResponse): `0x${string}` {
  return encodeAbiParameters(
    [{ type: "uint64" }, { type: "bytes" }, { type: "bytes" }],
    [BigInt(r.expires), r.result, r.signature],
  );
}
