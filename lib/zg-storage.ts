import { Indexer, MemData } from "@0glabs/0g-ts-sdk";
import { JsonRpcProvider, Wallet } from "ethers";
import type { Job } from "@/lib/types";

const DEFAULT_INDEXER_URL = "https://indexer-storage-testnet-turbo.0g.ai";

type WriteResult = { rootHash: string; txHash: string; anchored: boolean };

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

async function writeBlob(payload: object): Promise<WriteResult | null> {
  const zg = getZg();
  if (!zg) return null;
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  const file = new MemData(bytes);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signer = zg.signer as any;
  const [res, err] = await zg.indexer.upload(file, zg.rpcUrl, signer);
  // The SDK populates res.rootHash even when on-chain submit fails. We keep it
  // as the content-address — Galileo's Flow contract proxy was upgraded since
  // SDK 0.3.3 (latest), so submit() currently reverts. Anchoring will start
  // working transparently once the SDK is updated.
  if (res?.rootHash) {
    return {
      rootHash: res.rootHash,
      txHash: res.txHash || "",
      anchored: !err,
    };
  }
  if (err) console.error("[zg-storage] upload error:", err.message);
  return null;
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
