import { type Address, type Hex } from "viem";
import {
  baseSepoliaPublicClient,
  baseSepoliaWalletClient,
} from "@/lib/wallets";
import { getBaseSepoliaAddresses } from "@/lib/edge-config";
import TradingTreasuryAbi from "@/lib/abis/TradingTreasury.json";

const ABI = TradingTreasuryAbi as readonly unknown[];

export type TreasuryView = {
  address: Address;
  agent: Address;
  owner: Address;
  usdcBalance: bigint;
  positionId: Hex;
  positionSize: bigint;
  positionCollateral: bigint;
  lastHeartbeat: bigint;
  heartbeatTimeout: bigint;
  heartbeatStale: boolean;
  killed: boolean;
};

export async function getTreasuryAddress(): Promise<Address | null> {
  const map = await getBaseSepoliaAddresses();
  return (map.tradingTreasury ?? null) as Address | null;
}

export async function readTreasury(): Promise<TreasuryView | null> {
  const address = await getTreasuryAddress();
  if (!address) return null;
  const client = baseSepoliaPublicClient();

  try {
    const [
      agent,
      owner,
      positionId,
      positionSize,
      positionCollateral,
      lastHeartbeat,
      heartbeatTimeout,
      heartbeatStale,
      killed,
    ] = (await Promise.all([
      client.readContract({ address, abi: ABI, functionName: "agent" }),
      client.readContract({ address, abi: ABI, functionName: "owner" }),
      client.readContract({ address, abi: ABI, functionName: "positionId" }),
      client.readContract({ address, abi: ABI, functionName: "positionSize" }),
      client.readContract({
        address,
        abi: ABI,
        functionName: "positionCollateral",
      }),
      client.readContract({
        address,
        abi: ABI,
        functionName: "lastHeartbeat",
      }),
      client.readContract({
        address,
        abi: ABI,
        functionName: "heartbeatTimeout",
      }),
      client.readContract({
        address,
        abi: ABI,
        functionName: "heartbeatStale",
      }),
      client.readContract({ address, abi: ABI, functionName: "killed" }),
    ])) as [
      Address,
      Address,
      Hex,
      bigint,
      bigint,
      bigint,
      bigint,
      boolean,
      boolean,
    ];

    // USDC balance is a separate token read — keep it close to the rest so
    // dashboards don't have to compose two helpers.
    const usdcAddress = (await client.readContract({
      address,
      abi: ABI,
      functionName: "USDC",
    })) as Address;
    const usdcBalance = (await client.readContract({
      address: usdcAddress,
      abi: [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "owner", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
      ],
      functionName: "balanceOf",
      args: [address],
    })) as bigint;

    return {
      address,
      agent,
      owner,
      usdcBalance,
      positionId,
      positionSize,
      positionCollateral,
      lastHeartbeat,
      heartbeatTimeout,
      heartbeatStale,
      killed,
    };
  } catch (err) {
    console.error(
      "[treasury] readTreasury failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/// Send a heartbeat() from the agent EOA. Returns the txHash on success,
/// null on no-op (treasury not deployed yet) or failure (caller logs).
export async function pingHeartbeat(): Promise<Hex | null> {
  const address = await getTreasuryAddress();
  if (!address) return null;
  const wallet = baseSepoliaWalletClient("agent");
  const txHash = await wallet.writeContract({
    address,
    abi: ABI,
    functionName: "heartbeat",
    args: [],
  });
  return txHash;
}

/// Move USDC from the treasury into exchange collateral. Agent-only.
export async function depositToExchange(amount: bigint): Promise<Hex> {
  const address = await getTreasuryAddress();
  if (!address) throw new Error("treasury address missing");
  const wallet = baseSepoliaWalletClient("agent");
  return wallet.writeContract({
    address,
    abi: ABI,
    functionName: "depositToExchange",
    args: [amount],
  });
}

/// Pull USDC collateral back from the exchange into the treasury. Agent-only.
export async function withdrawFromExchange(amount: bigint): Promise<Hex> {
  const address = await getTreasuryAddress();
  if (!address) throw new Error("treasury address missing");
  const wallet = baseSepoliaWalletClient("agent");
  return wallet.writeContract({
    address,
    abi: ABI,
    functionName: "withdrawFromExchange",
    args: [amount],
  });
}

/// Open the single arb position. `size > 0` long, `size < 0` short (1e18 = 1 unit).
export async function openPosition(
  size: bigint,
  collateral: bigint,
): Promise<Hex> {
  const address = await getTreasuryAddress();
  if (!address) throw new Error("treasury address missing");
  const wallet = baseSepoliaWalletClient("agent");
  return wallet.writeContract({
    address,
    abi: ABI,
    functionName: "openPosition",
    args: [size, collateral],
  });
}

/// Close the currently-open treasury position. Agent-only.
export async function closePosition(): Promise<Hex> {
  const address = await getTreasuryAddress();
  if (!address) throw new Error("treasury address missing");
  const wallet = baseSepoliaWalletClient("agent");
  return wallet.writeContract({
    address,
    abi: ABI,
    functionName: "closePosition",
    args: [],
  });
}

/// Forward `amount` of free treasury USDC to the splitter for shareholders.
export async function distributeRevenue(amount: bigint): Promise<Hex> {
  const address = await getTreasuryAddress();
  if (!address) throw new Error("treasury address missing");
  const wallet = baseSepoliaWalletClient("agent");
  return wallet.writeContract({
    address,
    abi: ABI,
    functionName: "distributeRevenue",
    args: [amount],
  });
}
