import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http } from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import type { PrivateKeyAccount } from "viem/accounts";

export type WalletId =
  | "agent"
  | "client1"
  | "client2"
  | "client3"
  | "validator"
  | "pricewatch";

const ENV_KEY: Record<WalletId, string> = {
  agent: "AGENT_PK",
  client1: "CLIENT1_PK",
  client2: "CLIENT2_PK",
  client3: "CLIENT3_PK",
  validator: "VALIDATOR_PK",
  pricewatch: "PRICEWATCH_PK",
};

function pk(id: WalletId): `0x${string}` {
  const raw = process.env[ENV_KEY[id]];
  if (!raw) throw new Error(`missing ${ENV_KEY[id]} env var`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

export function loadAccount(id: WalletId): PrivateKeyAccount {
  return privateKeyToAccount(pk(id));
}

export function tryLoadAccount(id: WalletId): PrivateKeyAccount | null {
  try {
    return loadAccount(id);
  } catch {
    return null;
  }
}

export function sepoliaPublicClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL),
  });
}

export function baseSepoliaPublicClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL),
  });
}

export function sepoliaWalletClient(id: WalletId) {
  return createWalletClient({
    account: loadAccount(id),
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL),
  });
}

export function baseSepoliaWalletClient(id: WalletId) {
  return createWalletClient({
    account: loadAccount(id),
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL),
  });
}

export function getClientWalletId(idParam: string | null): WalletId {
  switch (idParam) {
    case "1":
      return "client1";
    case "2":
      return "client2";
    case "3":
      return "client3";
    default:
      return "client1";
  }
}
