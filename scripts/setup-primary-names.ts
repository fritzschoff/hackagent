/**
 * One-shot reverse-name setup for wallets we hold locally. Each wallet
 * pays its own gas (need ~0.001 ETH per setName call). Idempotent: skips
 * if reverse name already matches. Gracefully skips Base Sepolia if the
 * L2 ReverseRegistrar is not deployed at the canonical ENSIP-19 address.
 *
 * Required env: AGENT_PK, PRICEWATCH_PK, VALIDATOR_PK,
 *               SEPOLIA_RPC_URL, BASE_SEPOLIA_RPC_URL.
 */
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, baseSepolia } from "viem/chains";

// The actual Sepolia ReverseRegistrar is the owner of addr.reverse in the ENS registry.
// Verified: ENS.owner(namehash("addr.reverse")) = 0xA0a1AbcDAe1a2a4A2EF8e9113Ff0e02DD81DC0C6
const SEPOLIA_REVERSE_REGISTRAR =
  "0xA0a1AbcDAe1a2a4A2EF8e9113Ff0e02DD81DC0C6" as const satisfies Address;

// Canonical L2 reverse registrar per ENSIP-19.
// Verified present on Base Sepolia via getBytecode check.
const BASE_SEPOLIA_L2_REVERSE_REGISTRAR =
  "0x00000BeEF055f7934784D6d81b6BC86665630dbA" as const satisfies Address;

// Sepolia ReverseRegistrar returns bytes32; Base Sepolia L2 version returns void.
// Use separate ABIs for each.
const REVERSE_REGISTRAR_ABI_BYTES32 = [
  {
    type: "function",
    name: "setName",
    stateMutability: "nonpayable",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

const REVERSE_REGISTRAR_ABI_VOID = [
  {
    type: "function",
    name: "setName",
    stateMutability: "nonpayable",
    inputs: [{ name: "name", type: "string" }],
    outputs: [],
  },
] as const;

const MIN_BALANCE = BigInt(1e15); // 0.001 ETH

type ChainConfig = {
  chain: Chain;
  rpcEnv: string;
  registrar: Address;
  /** Some chains return void from setName instead of bytes32 */
  abiVoid: boolean;
};

type Plan = {
  pkEnv: string;
  label: string;
};

const PLANS: Plan[] = [
  { pkEnv: "AGENT_PK", label: "agent-eoa.tradewise.agentlab.eth" },
  { pkEnv: "PRICEWATCH_PK", label: "pricewatch-deployer.agentlab.eth" },
  { pkEnv: "VALIDATOR_PK", label: "validator.agentlab.eth" },
];

const CHAINS: ChainConfig[] = [
  {
    chain: sepolia,
    rpcEnv: "SEPOLIA_RPC_URL",
    registrar: SEPOLIA_REVERSE_REGISTRAR,
    abiVoid: false,
  },
  {
    chain: baseSepolia,
    rpcEnv: "BASE_SEPOLIA_RPC_URL",
    registrar: BASE_SEPOLIA_L2_REVERSE_REGISTRAR,
    abiVoid: true,
  },
];

async function checkRegistrarPresent(
  pub: ReturnType<typeof createPublicClient>,
  registrar: Address,
  chainName: string,
): Promise<boolean> {
  try {
    const code = await pub.getBytecode({ address: registrar });
    if (!code || code === "0x") {
      console.log(
        `  (skipped ${chainName}: L2 ReverseRegistrar not found at ${registrar})`,
      );
      return false;
    }
    return true;
  } catch {
    console.log(
      `  (skipped ${chainName}: could not verify ReverseRegistrar — ${registrar})`,
    );
    return false;
  }
}

async function main() {
  // Pre-flight: verify all PKs are set
  const missing = PLANS.filter((p) => !process.env[p.pkEnv]).map(
    (p) => p.pkEnv,
  );
  if (missing.length > 0) {
    console.error(`✗ Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Pre-flight: check balances on all chains
  console.log("Checking wallet balances...");
  const balanceErrors: string[] = [];

  for (const plan of PLANS) {
    const pkRaw = process.env[plan.pkEnv]!;
    const pk = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as Hex;
    const account = privateKeyToAccount(pk);

    for (const c of CHAINS) {
      const rpc = process.env[c.rpcEnv];
      if (!rpc) continue;
      const pub = createPublicClient({ chain: c.chain, transport: http(rpc) });
      const bal = await pub.getBalance({ address: account.address });
      console.log(
        `  ${plan.pkEnv} (${account.address}) on ${c.chain.name}: ${formatEther(bal)} ETH`,
      );
      if (bal < MIN_BALANCE) {
        balanceErrors.push(
          `  ${plan.pkEnv} (${account.address}) on ${c.chain.name}: ${formatEther(bal)} ETH — need at least 0.001 ETH`,
        );
      }
    }
  }

  if (balanceErrors.length > 0) {
    console.error("\n✗ Insufficient balances — please fund these wallets:");
    balanceErrors.forEach((e) => console.error(e));
    process.exit(1);
  }

  console.log("\nAll balances OK. Setting reverse names...\n");

  // Process each plan × chain
  for (const plan of PLANS) {
    const pkRaw = process.env[plan.pkEnv]!;
    const pk = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as Hex;
    const account = privateKeyToAccount(pk);
    console.log(`\n[${plan.pkEnv}] ${account.address} → "${plan.label}"`);

    for (const c of CHAINS) {
      const rpc = process.env[c.rpcEnv];
      if (!rpc) {
        console.log(
          `  (skipped ${c.chain.name}: ${c.rpcEnv} env var not set)`,
        );
        continue;
      }

      const pub = createPublicClient({ chain: c.chain, transport: http(rpc) });

      // Verify registrar is deployed (graceful degradation)
      const registrarOk = await checkRegistrarPresent(
        pub,
        c.registrar,
        c.chain.name,
      );
      if (!registrarOk) continue;

      // Idempotency check: read current reverse name
      try {
        const current = await pub.getEnsName({ address: account.address });
        if (current?.toLowerCase() === plan.label.toLowerCase()) {
          console.log(`  ✓ ${c.chain.name}: already set to "${current}"`);
          continue;
        }
        if (current) {
          console.log(
            `  ${c.chain.name}: current reverse="${current}" → will update`,
          );
        }
      } catch {
        // No reverse record yet — proceed normally
      }

      // Send setName tx
      console.log(`  ${c.chain.name}: calling setName("${plan.label}")...`);
      const wallet = createWalletClient({
        account,
        chain: c.chain,
        transport: http(rpc),
      });

      const abi = c.abiVoid
        ? REVERSE_REGISTRAR_ABI_VOID
        : REVERSE_REGISTRAR_ABI_BYTES32;
      const txHash = await wallet.writeContract({
        address: c.registrar,
        abi,
        functionName: "setName",
        args: [plan.label],
      });

      console.log(`  ${c.chain.name}: tx submitted: ${txHash}`);
      const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
      console.log(
        `  ${c.chain.name}: ✓ confirmed in block ${receipt.blockNumber} (${receipt.status})`,
      );
    }
  }

  console.log("\n✓ done.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
