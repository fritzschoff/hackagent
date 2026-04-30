/**
 * Sets the OffchainResolver as agentlab.eth's resolver in the Sepolia ENS
 * registry. Owner of agentlab.eth must be the AGENT_PK wallet (verified
 * in pre-flight).
 *
 * Required env: AGENT_PK, SEPOLIA_RPC_URL, OFFCHAIN_RESOLVER_ADDRESS.
 */
import { createPublicClient, createWalletClient, http, namehash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

const REGISTRY_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "resolver",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "setResolver",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "resolver", type: "address" },
    ],
    outputs: [],
  },
] as const;

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

async function main() {
  const node = namehash("agentlab.eth");
  const newResolver = envOrThrow("OFFCHAIN_RESOLVER_ADDRESS") as `0x${string}`;
  const pkRaw = envOrThrow("AGENT_PK");
  const pk = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as Hex;
  const rpcUrl = envOrThrow("SEPOLIA_RPC_URL");

  const account = privateKeyToAccount(pk);
  const pub = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });

  const owner = (await pub.readContract({
    address: ENS_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [node],
  })) as `0x${string}`;
  console.log("agentlab.eth owner:    ", owner);
  console.log("AGENT (broadcaster):   ", account.address);

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`owner ${owner} != broadcaster ${account.address}; cannot setResolver`);
  }

  const currentResolver = (await pub.readContract({
    address: ENS_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "resolver",
    args: [node],
  })) as `0x${string}`;
  console.log("current resolver:      ", currentResolver);
  console.log("target resolver:       ", newResolver);

  if (currentResolver.toLowerCase() === newResolver.toLowerCase()) {
    console.log("\n✓ already set; nothing to do");
    return;
  }

  console.log("\n→ ENS.setResolver(agentlab.eth, OffchainResolver)...");
  const txHash = await wallet.writeContract({
    address: ENS_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "setResolver",
    args: [node, newResolver],
  });
  console.log("tx:", txHash);
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  console.log("block:", receipt.blockNumber);

  const verified = (await pub.readContract({
    address: ENS_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "resolver",
    args: [node],
  })) as `0x${string}`;
  console.log("resolver post-set:     ", verified);
  console.log("\n✓ done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
