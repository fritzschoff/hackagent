/**
 * Circle CCTP V1 constants + helpers for the D2/D3 cross-chain dividend
 * legs. Tradewise withdraws USDC from HL onto Arbitrum (D1), then burns
 * on Arbitrum (D2, this lib), and Circle mints on Base into the
 * RevenueSplitter (D3, this lib).
 *
 * Mainnet only — testnet domains are intentionally not wired so a
 * mis-configured deploy can't silently bridge to Sepolia. If/when we
 * need a testnet path we'll add a second constants block.
 *
 * Reference: https://developers.circle.com/stablecoins/docs/cctp-getting-started
 */

import { type Address, type Hex } from "viem";

/// CCTP domain IDs (V1 — keep stable across V2 migration; V2 reuses).
export const CCTP_DOMAIN_ETHEREUM = 0;
export const CCTP_DOMAIN_AVALANCHE = 1;
export const CCTP_DOMAIN_OPTIMISM = 2;
export const CCTP_DOMAIN_ARBITRUM = 3;
export const CCTP_DOMAIN_BASE = 6;

/// Arbitrum mainnet — source chain for D2 burn.
export const ARBITRUM_TOKEN_MESSENGER: Address =
  "0x19330d10D9Cc8751218eaf51E8885D058642E08A";
export const ARBITRUM_MESSAGE_TRANSMITTER: Address =
  "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca";
export const ARBITRUM_USDC: Address =
  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

/// Base mainnet — destination chain for D3 mint.
export const BASE_MESSAGE_TRANSMITTER: Address =
  "0xAD09780d193884d503182aD4588450C416D6F9D4";
export const BASE_USDC: Address =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/// Circle's attestation API (V1 — V2 is rolling out, watch for changes).
export const IRIS_API_BASE = "https://iris-api.circle.com";

/// Minimal ABIs for the on-chain calls we make.
export const TOKEN_MESSENGER_ABI = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
  },
] as const;

export const MESSAGE_TRANSMITTER_ABI = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

export const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/// Convert a 20-byte EVM address to 32-byte left-padded form (CCTP wants
/// mintRecipient as bytes32 to support non-EVM destinations).
export function addressToBytes32(addr: Address): Hex {
  return `0x000000000000000000000000${addr.slice(2).toLowerCase()}` as Hex;
}

/// Poll Circle's attestation API. Returns null while pending, the
/// 65-byte signature when ready.
export async function fetchAttestation(
  messageHash: Hex,
): Promise<Hex | null> {
  const res = await fetch(`${IRIS_API_BASE}/attestations/${messageHash}`);
  if (!res.ok) return null;
  const body = (await res.json()) as {
    status?: "pending_confirmations" | "complete";
    attestation?: Hex;
  };
  if (body.status === "complete" && body.attestation) {
    return body.attestation;
  }
  return null;
}
