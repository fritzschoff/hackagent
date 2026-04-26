import { Indexer, MemData } from "@0glabs/0g-ts-sdk";
import { JsonRpcProvider, Wallet } from "ethers";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Job } from "@/lib/types";

const DEFAULT_INDEXER_URL = "https://indexer-storage-testnet-turbo.0g.ai";
const FLOW_PROXY: Address = "0x22E03a6A89B950F1c82ec5e74F8eCa321a105296";
const ENTRY_SIZE = 256n;
const GALILEO_CHAIN_ID = 16602;

type WriteResult = {
  rootHash: string;
  txHash: string;
  anchored: boolean;
};

let cached: { indexer: Indexer; signer: Wallet; rpcUrl: string } | null = null;

function getZg(): { indexer: Indexer; signer: Wallet; rpcUrl: string } | null {
  if (cached) return cached;
  const rpcUrl = process.env.ZG_GALILEO_RPC_URL;
  const pk = process.env.ZG_PRIVATE_KEY ?? process.env.AGENT_PK;
  const indexerUrl = process.env.ZG_INDEXER_URL ?? DEFAULT_INDEXER_URL;
  if (!rpcUrl || !pk) return null;
  const provider = new JsonRpcProvider(rpcUrl);
  const signer = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
  const indexer = new Indexer(indexerUrl);
  cached = { indexer, signer, rpcUrl };
  return cached;
}

const FLOW_ABI = [
  {
    type: "function",
    name: "submit",
    stateMutability: "payable",
    inputs: [
      {
        name: "submission",
        type: "tuple",
        components: [
          {
            name: "data",
            type: "tuple",
            components: [
              { name: "length", type: "uint256" },
              { name: "tags", type: "bytes" },
              {
                name: "nodes",
                type: "tuple[]",
                components: [
                  { name: "root", type: "bytes32" },
                  { name: "height", type: "uint256" },
                ],
              },
            ],
          },
          { name: "submitter", type: "address" },
        ],
      },
    ],
    outputs: [
      { name: "index", type: "uint256" },
      { name: "digest", type: "bytes32" },
      { name: "startIndex", type: "uint256" },
      { name: "length", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "market",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const MARKET_ABI = [
  {
    type: "function",
    name: "pricePerSector",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function heightFromChunks(chunks: number): number {
  return Math.log2(nextPowerOfTwo(Math.max(chunks, 1)));
}

async function anchorOnChain(
  rootHash: string,
  byteLength: number,
): Promise<{ txHash: Hex } | null> {
  const rpcUrl = process.env.ZG_GALILEO_RPC_URL;
  const pkRaw = process.env.ZG_PRIVATE_KEY ?? process.env.AGENT_PK;
  if (!rpcUrl || !pkRaw) return null;
  const pk = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as Hex;

  const galileo = {
    id: GALILEO_CHAIN_ID,
    name: "0G Galileo",
    nativeCurrency: { name: "OG", symbol: "OG", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const;

  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({
    chain: galileo,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: galileo,
    transport: http(rpcUrl),
  });

  const market = (await publicClient.readContract({
    address: FLOW_PROXY,
    abi: FLOW_ABI,
    functionName: "market",
  })) as Address;
  const pricePerSector = (await publicClient.readContract({
    address: market,
    abi: MARKET_ABI,
    functionName: "pricePerSector",
  })) as bigint;

  const numChunks = Math.ceil(byteLength / 256);
  const padded = nextPowerOfTwo(numChunks);
  const sectors = BigInt(padded);
  const fee = pricePerSector * sectors;
  const height = BigInt(heightFromChunks(numChunks));

  const submission = {
    data: {
      length: BigInt(byteLength),
      tags: "0x" as Hex,
      nodes: [{ root: rootHash as Hex, height }],
    },
    submitter: account.address,
  };

  // Galileo requires min priority fee 2 gwei; use legacy gas to avoid the
  // EIP-1559 minimum-tip rejection.
  const gasPrice = (await publicClient.getGasPrice()) + 1n;

  const txHash = await walletClient.writeContract({
    address: FLOW_PROXY,
    abi: FLOW_ABI,
    functionName: "submit",
    args: [submission],
    value: fee,
    gasPrice,
  });
  // Galileo blocks land slow + viem default timeout is too tight; we don't
  // need the receipt for downstream logic, just the hash. Fire and return.
  publicClient
    .waitForTransactionReceipt({ hash: txHash, timeout: 180_000 })
    .catch(() => undefined);
  return { txHash };
}

async function writeBlob(payload: object): Promise<WriteResult | null> {
  const zg = getZg();
  if (!zg) return null;
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  const file = new MemData(bytes);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signer = zg.signer as any;
  const [res] = await zg.indexer.upload(file, zg.rpcUrl, signer);
  if (!res?.rootHash) return null;

  // SDK 0.3.3's on-chain submit() uses the old selector and reverts on
  // Galileo. We compute the Merkle root via the SDK (which works), then
  // submit ourselves with the new (SubmissionData, address submitter) shape.
  let txHash = res.txHash || "";
  let anchored = Boolean(res.txHash);
  if (!anchored) {
    try {
      const r = await anchorOnChain(res.rootHash, bytes.byteLength);
      if (r?.txHash) {
        txHash = r.txHash;
        anchored = true;
      }
    } catch (err) {
      console.error(
        "[zg-storage] anchor fallback failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { rootHash: res.rootHash, txHash, anchored };
}

export async function appendJobLog(job: Job): Promise<WriteResult | null> {
  return writeBlob({ kind: "job-log", job });
}

export async function writeState<T>(
  key: string,
  value: T,
): Promise<WriteResult | null> {
  return writeBlob({ kind: "state", key, value, ts: Date.now() });
}

export async function readState<T>(_key: string): Promise<T | null> {
  return null;
}

export async function listRecentJobLogs(_limit = 50): Promise<Job[]> {
  return [];
}

void ENTRY_SIZE;
