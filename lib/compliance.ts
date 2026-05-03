import {
  type Address,
  type Hex,
  type AbiEvent,
  keccak256,
  toBytes,
} from "viem";
import { sepoliaPublicClient } from "@/lib/wallets";
import { getLogsChunked } from "@/lib/log-chunks";
import ComplianceManifestAbi from "@/lib/abis/ComplianceManifest.json";

const ABI = ComplianceManifestAbi as readonly unknown[];

const COMMITTED = (ABI as AbiEvent[]).find(
  (e) => e.type === "event" && e.name === "ManifestCommitted",
) as AbiEvent;
const UPDATED = (ABI as AbiEvent[]).find(
  (e) => e.type === "event" && e.name === "ManifestUpdated",
) as AbiEvent;
const CHALLENGED = (ABI as AbiEvent[]).find(
  (e) => e.type === "event" && e.name === "ManifestChallenged",
) as AbiEvent;
const SLASHED = (ABI as AbiEvent[]).find(
  (e) => e.type === "event" && e.name === "ManifestSlashed",
) as AbiEvent;

export type LicenseTier =
  | "public-api"
  | "paid-api"
  | "licensed-dataset"
  | "first-party"
  | "web-scrape";

export type ComplianceSource = {
  url: string;
  /// e.g. "Uniswap V4 SDK", "ENS Universal Resolver"
  name: string;
  /// keccak256 hash of the most recent ToS document the agent reviewed
  tosHash: Hex;
  license: LicenseTier;
  notes?: string;
};

export type ComplianceManifestDoc = {
  agentId: number;
  ens: string;
  agentEoa: Address;
  sources: ComplianceSource[];
  /// Free-form policy statements ("we do not redistribute scraped data",
  /// "all paid APIs use first-party API keys", etc.)
  policies: string[];
  commitTs: number;
  version: number;
};

/// Canonicalize manifest into stable JSON, hash to bytes32 root.
export function buildManifestRoot(doc: ComplianceManifestDoc): Hex {
  const canonical = canonicalJson(doc);
  return keccak256(toBytes(canonical));
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export type ManifestStatus =
  | "none"
  | "committed"
  | "challenged"
  | "slashed"
  | "cleared";

const STATUS_BY_NUM: ManifestStatus[] = [
  "none",
  "committed",
  "challenged",
  "slashed",
  "cleared",
];

export type ComplianceView = {
  agent: Address;
  manifestRoot: Hex;
  manifestUri: string;
  bond: bigint;
  committedAt: bigint;
  status: ManifestStatus;
  challenger: Address;
  challengerBond: bigint;
  evidenceUri: string;
};

export async function readCompliance(args: {
  registry: Address;
  agentId: bigint;
}): Promise<ComplianceView | null> {
  try {
    const client = sepoliaPublicClient();
    const r = (await client.readContract({
      address: args.registry,
      abi: ABI,
      functionName: "getManifest",
      args: [args.agentId],
    })) as readonly [
      Address,
      Hex,
      string,
      bigint,
      bigint,
      number,
      Address,
      bigint,
      string,
    ];
    return {
      agent: r[0],
      manifestRoot: r[1],
      manifestUri: r[2],
      bond: r[3],
      committedAt: r[4],
      status: STATUS_BY_NUM[r[5]] ?? "none",
      challenger: r[6],
      challengerBond: r[7],
      evidenceUri: r[8],
    };
  } catch (err) {
    console.error(
      "[compliance] readCompliance failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export type ComplianceEvent =
  | {
      kind: "committed";
      agentId: bigint;
      agent: Address;
      manifestRoot: Hex;
      manifestUri: string;
      bond: bigint;
      txHash: Hex;
      blockNumber: bigint;
    }
  | {
      kind: "updated";
      agentId: bigint;
      manifestRoot: Hex;
      manifestUri: string;
      txHash: Hex;
      blockNumber: bigint;
    }
  | {
      kind: "challenged";
      agentId: bigint;
      challenger: Address;
      challengerBond: bigint;
      evidenceUri: string;
      txHash: Hex;
      blockNumber: bigint;
    }
  | {
      kind: "slashed";
      agentId: bigint;
      challenger: Address;
      challengerReward: bigint;
      validatorReward: bigint;
      txHash: Hex;
      blockNumber: bigint;
    };

const SEPOLIA_DEPLOY_BLOCK_DEFAULT = 6_000_000n;

export async function readComplianceHistory(args: {
  registry: Address;
  agentId: bigint;
  limit?: number;
}): Promise<ComplianceEvent[]> {
  const client = sepoliaPublicClient();
  const tip = await client.getBlockNumber();
  const fromBlock =
    tip > SEPOLIA_DEPLOY_BLOCK_DEFAULT ? tip - 100_000n : SEPOLIA_DEPLOY_BLOCK_DEFAULT;

  const [committed, updated, challenged, slashed] = await Promise.all([
    getLogsChunked(client, {
      label: "compliance",
      address: args.registry,
      event: COMMITTED,
      eventArgs: { agentId: args.agentId },
      fromBlock,
      toBlock: tip,
    }),
    getLogsChunked(client, {
      label: "compliance",
      address: args.registry,
      event: UPDATED,
      eventArgs: { agentId: args.agentId },
      fromBlock,
      toBlock: tip,
    }),
    getLogsChunked(client, {
      label: "compliance",
      address: args.registry,
      event: CHALLENGED,
      eventArgs: { agentId: args.agentId },
      fromBlock,
      toBlock: tip,
    }),
    getLogsChunked(client, {
      label: "compliance",
      address: args.registry,
      event: SLASHED,
      eventArgs: { agentId: args.agentId },
      fromBlock,
      toBlock: tip,
    }),
  ]);

  const events: ComplianceEvent[] = [];
  for (const log of committed) {
    const a = log.args as {
      agentId: bigint;
      agent: Address;
      manifestRoot: Hex;
      manifestUri: string;
      bond: bigint;
    };
    events.push({
      kind: "committed",
      agentId: a.agentId,
      agent: a.agent,
      manifestRoot: a.manifestRoot,
      manifestUri: a.manifestUri,
      bond: a.bond,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    });
  }
  for (const log of updated) {
    const a = log.args as {
      agentId: bigint;
      newRoot: Hex;
      newUri: string;
    };
    events.push({
      kind: "updated",
      agentId: a.agentId,
      manifestRoot: a.newRoot,
      manifestUri: a.newUri,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    });
  }
  for (const log of challenged) {
    const a = log.args as {
      agentId: bigint;
      challenger: Address;
      challengerBond: bigint;
      evidenceUri: string;
    };
    events.push({
      kind: "challenged",
      agentId: a.agentId,
      challenger: a.challenger,
      challengerBond: a.challengerBond,
      evidenceUri: a.evidenceUri,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    });
  }
  for (const log of slashed) {
    const a = log.args as {
      agentId: bigint;
      challenger: Address;
      challengerReward: bigint;
      validatorReward: bigint;
    };
    events.push({
      kind: "slashed",
      agentId: a.agentId,
      challenger: a.challenger,
      challengerReward: a.challengerReward,
      validatorReward: a.validatorReward,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    });
  }
  events.sort((a, b) => Number(b.blockNumber - a.blockNumber));
  return events.slice(0, args.limit ?? 20);
}

/// Format a USDC bigint as "$X.XX".
export function formatUsdc(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const frac = (amount % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `$${whole}.${frac}`;
}

/// The canonical compliance declaration for tradewise.agentlab.eth.
/// `buildManifestRoot(TRADEWISE_MANIFEST)` must match the on-chain
/// `manifestRoot` for `agentId = 1` on the ComplianceManifest registry.
/// commitTs is fixed so the root is reproducible.
export const TRADEWISE_MANIFEST: ComplianceManifestDoc = {
  agentId: 1,
  ens: "tradewise.agentlab.eth",
  agentEoa: "0x7a83678e330a0C565e6272498FFDF421621820A3",
  sources: [
    {
      url: "https://docs.uniswap.org/contracts/v3/reference/periphery/lens/QuoterV2",
      name: "Uniswap V3 QuoterV2 (on-chain RPC)",
      tosHash:
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      license: "public-api",
      notes:
        "On-chain quoter contract. Public, permissionless, no third-party ToS.",
    },
    {
      url: "https://eth-sepolia.g.alchemy.com",
      name: "Alchemy Sepolia RPC",
      tosHash:
        "0x0000000000000000000000000000000000000000000000000000000000000002",
      license: "paid-api",
      notes: "First-party API key under Alchemy Free Tier ToS.",
    },
    {
      url: "https://app.ens.domains",
      name: "ENS Universal Resolver (on-chain)",
      tosHash:
        "0x0000000000000000000000000000000000000000000000000000000000000003",
      license: "public-api",
      notes:
        "Identity registration and text records read directly from contracts.",
    },
    {
      url: "https://faucet.circle.com",
      name: "Circle USDC (Sepolia + Base Sepolia testnet)",
      tosHash:
        "0x0000000000000000000000000000000000000000000000000000000000000004",
      license: "public-api",
      notes: "Testnet USDC. No production funds, no PII handled.",
    },
    {
      url: "https://docs.0g.ai/0g-storage",
      name: "0G Storage (Galileo testnet)",
      tosHash:
        "0x0000000000000000000000000000000000000000000000000000000000000005",
      license: "first-party",
      notes:
        "Agent's own encrypted memory blobs. No third-party data stored.",
    },
  ],
  policies: [
    "tradewise does NOT scrape Google Flights, Twitter, Reddit, or any site whose ToS forbids automated access.",
    "all paid APIs are accessed under first-party API keys held by the agent operator.",
    "no PII, no production financial data, no biometric data is ever stored on chain or in 0G Storage.",
    "manifest changes are committed via signed transaction from the agent's pricewatch deployer wallet.",
    "challenge mechanism: anyone can post a USDC counter-bond + evidence URI; the validator resolves slashes 70% to challenger, 30% to validator.",
  ],
  commitTs: 0,
  version: 1,
};
