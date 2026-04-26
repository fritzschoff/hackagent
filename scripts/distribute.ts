import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";
import { BASE_SEPOLIA_USDC } from "../lib/x402";

type ChainKey = "sepolia" | "base-sepolia";

type Role = "agent" | "client1" | "client2" | "client3" | "validator";

const ENV_KEY: Record<Role, string> = {
  agent: "AGENT_PK",
  client1: "CLIENT1_PK",
  client2: "CLIENT2_PK",
  client3: "CLIENT3_PK",
  validator: "VALIDATOR_PK",
};

function pkOrThrow(name: string): Hex {
  const raw = process.env[name];
  if (!raw) throw new Error(`missing ${name} env var`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

function getHubPk(): Hex {
  const explicit = process.env.FUNDING_HUB_PK;
  if (explicit) {
    return (explicit.startsWith("0x") ? explicit : `0x${explicit}`) as Hex;
  }
  return pkOrThrow("AGENT_PK");
}

function loadRecipient(role: Role): Address {
  return privateKeyToAccount(pkOrThrow(ENV_KEY[role])).address;
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(3)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(3).includes(`--${name}`);
}

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

async function main() {
  const chainArg = process.argv[2] as ChainKey | undefined;
  if (!chainArg || (chainArg !== "sepolia" && chainArg !== "base-sepolia")) {
    console.error("usage: tsx scripts/distribute.ts <sepolia|base-sepolia> [--eth=0.01] [--usdc=5] [--token=eth|usdc|both] [--dry-run]");
    process.exit(1);
  }

  const dryRun = hasFlag("dry-run");
  const tokenFilter = (parseArg("token") ?? "both") as "eth" | "usdc" | "both";

  const hubPk = getHubPk();
  const hub = privateKeyToAccount(hubPk);

  const chain = chainArg === "sepolia" ? sepolia : baseSepolia;
  const rpcUrl =
    chainArg === "sepolia"
      ? process.env.SEPOLIA_RPC_URL
      : process.env.BASE_SEPOLIA_RPC_URL;
  if (!rpcUrl) {
    throw new Error(
      `missing ${chainArg === "sepolia" ? "SEPOLIA_RPC_URL" : "BASE_SEPOLIA_RPC_URL"} env var`,
    );
  }

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account: hub,
    chain,
    transport: http(rpcUrl),
  });

  const ethAmount = parseEther(parseArg("eth") ?? (chainArg === "sepolia" ? "0.01" : "0.005"));
  const usdcAmount = parseUnits(parseArg("usdc") ?? "5", 6);

  const recipientsByChain: Record<ChainKey, Role[]> = {
    sepolia: ["agent", "client1", "client2", "client3", "validator"],
    "base-sepolia": ["client1", "client2", "client3"],
  };

  const recipients = recipientsByChain[chainArg]
    .map((role) => ({ role, address: loadRecipient(role) }))
    .filter((r) => r.address.toLowerCase() !== hub.address.toLowerCase());

  console.log(`chain:      ${chain.name}`);
  console.log(`hub:        ${hub.address}`);
  const nativeBal = await publicClient.getBalance({ address: hub.address });
  console.log(`hub ETH:    ${formatEther(nativeBal)}`);

  if (chainArg === "base-sepolia") {
    const usdcBal = (await publicClient.readContract({
      address: BASE_SEPOLIA_USDC,
      abi: ERC20_TRANSFER_ABI,
      functionName: "balanceOf",
      args: [hub.address],
    })) as bigint;
    console.log(`hub USDC:   ${formatUnits(usdcBal, 6)}`);
  }
  console.log();

  const sendEth = tokenFilter !== "usdc";
  const sendUsdc = tokenFilter !== "eth" && chainArg === "base-sepolia";

  const plan: Array<{ role: Role; address: Address; kind: "ETH" | "USDC"; amount: bigint }> = [];
  for (const r of recipients) {
    if (sendEth) plan.push({ ...r, kind: "ETH", amount: ethAmount });
    if (sendUsdc) plan.push({ ...r, kind: "USDC", amount: usdcAmount });
  }

  if (plan.length === 0) {
    console.log("nothing to send");
    return;
  }

  console.log("plan:");
  for (const p of plan) {
    const human = p.kind === "ETH" ? `${formatEther(p.amount)} ETH` : `${formatUnits(p.amount, 6)} USDC`;
    console.log(`  ${p.role.padEnd(10)} ${p.address}  ${human}`);
  }
  console.log();

  if (dryRun) {
    console.log("--dry-run set, exiting without sending");
    return;
  }

  for (const p of plan) {
    if (p.kind === "ETH") {
      const hash = await walletClient.sendTransaction({
        to: p.address,
        value: p.amount,
      });
      console.log(`ETH  -> ${p.role.padEnd(10)} ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
    } else {
      const data = encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [p.address, p.amount],
      });
      const hash = await walletClient.sendTransaction({
        to: BASE_SEPOLIA_USDC,
        data,
      });
      console.log(`USDC -> ${p.role.padEnd(10)} ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }

  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
