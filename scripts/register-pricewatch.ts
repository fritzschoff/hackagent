/**
 * One-shot bootstrap script for the pricewatch sidecar agent.
 *
 *   pnpm tsx scripts/register-pricewatch.ts
 *
 * Performs:
 *   1. Registers `pricewatch` in ERC-8004 IdentityRegistry on Sepolia (agentId=2).
 *   2. Creates the `pricewatch.agentlab.eth` ENS subname on Sepolia.
 *   3. Sets resolver, addr, ENSIP-25 text record, agent-card text record.
 *
 * Requires env: SEPOLIA_RPC_URL, AGENT_PK (parent owner of agentlab.eth),
 * PRICEWATCH_PK, NEXT_PUBLIC_APP_URL (or fallback default).
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  labelhash,
  namehash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import IdentityRegistryAbi from "../lib/abis/IdentityRegistry.json";
import {
  PARENT_ENS,
  RESOLVER_ABI,
  SEPOLIA_ENS_REGISTRY,
  SEPOLIA_PUBLIC_RESOLVER,
  ensip25Key,
} from "../lib/ens-constants";

const SUB_LABEL = "pricewatch";
const SUB_NAME = `${SUB_LABEL}.${PARENT_ENS}`;

const ENS_REGISTRY_ABI = [
  {
    type: "function",
    name: "setSubnodeRecord",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "label", type: "bytes32" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
    ],
    outputs: [],
  },
] as const;

function envPk(name: string): Hex {
  const raw = process.env[name];
  if (!raw) throw new Error(`missing ${name}`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

// Helper kept inline in main() to avoid viem chain-binding type loss when
// passing wallet/public clients through function args.

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL not set");

  const agentPk = envPk("AGENT_PK"); // owns agentlab.eth parent
  const pricewatchPk = envPk("PRICEWATCH_PK");
  const identityRegistry = process.env.IDENTITY_REGISTRY as
    | `0x${string}`
    | undefined;
  if (!identityRegistry) {
    throw new Error(
      "IDENTITY_REGISTRY not set — paste the deployed Sepolia address",
    );
  }

  const agent = privateKeyToAccount(agentPk);
  const pricewatch = privateKeyToAccount(pricewatchPk);
  console.log(`agent (parent owner): ${agent.address}`);
  console.log(`pricewatch:           ${pricewatch.address}`);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const agentWallet = createWalletClient({
    account: agent,
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const pricewatchWallet = createWalletClient({
    account: pricewatch,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  // 1. Register in ERC-8004 (idempotent via agentIdOf check)
  let agentId = (await publicClient.readContract({
    address: identityRegistry,
    abi: IdentityRegistryAbi,
    functionName: "agentIdOf",
    args: [pricewatch.address],
  })) as bigint;
  if (agentId === 0n) {
    const regTx = await pricewatchWallet.writeContract({
      address: identityRegistry,
      abi: IdentityRegistryAbi,
      functionName: "register",
      args: [SUB_NAME, pricewatch.address],
    });
    console.log(`IdentityRegistry.register tx: ${regTx}`);
    await publicClient.waitForTransactionReceipt({ hash: regTx });
    agentId = (await publicClient.readContract({
      address: identityRegistry,
      abi: IdentityRegistryAbi,
      functionName: "agentIdOf",
      args: [pricewatch.address],
    })) as bigint;
  } else {
    console.log(`pricewatch already registered: agentId=${agentId}`);
  }
  console.log(`pricewatch agentId: ${agentId}`);

  // 2. Create subnode on agentlab.eth (controlled by agent wallet)
  const parentNode = namehash(PARENT_ENS);
  const subLabelHash = labelhash(SUB_LABEL);
  const subnode = namehash(SUB_NAME);
  const subTx = await agentWallet.writeContract({
    address: SEPOLIA_ENS_REGISTRY,
    abi: ENS_REGISTRY_ABI,
    functionName: "setSubnodeRecord",
    args: [
      parentNode,
      subLabelHash,
      pricewatch.address,
      SEPOLIA_PUBLIC_RESOLVER,
      0n,
    ],
  });
  console.log(`setSubnodeRecord tx: ${subTx}`);
  await publicClient.waitForTransactionReceipt({ hash: subTx });

  // 3. Resolver records (signed by pricewatch — it now owns the subnode)
  const cardUrl = `${
    process.env.NEXT_PUBLIC_APP_URL ?? "https://hackagent-nine.vercel.app"
  }/api/a2a/pricewatch/jobs`;
  const ensip25 = agentId
    ? ensip25Key({
        identityRegistry,
        agentId: Number(agentId),
        chainId: sepolia.id,
      })
    : null;

  const records: { label: string; key: string; value: string }[] = [
    {
      label: "ENSIP-25",
      key: ensip25 ?? "agent-registration[unset]",
      value: agentId ? "1" : "",
    },
    { label: "agent-card", key: "agent-card", value: cardUrl },
    {
      label: "description",
      key: "description",
      value: "pricewatch — token metadata sidecar; $0.02/call x402 USDC.",
    },
  ];

  for (const r of records) {
    if (!r.key || (r.label === "ENSIP-25" && !agentId)) continue;
    const data = encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [subnode, r.key, r.value],
    });
    const tx = await pricewatchWallet.sendTransaction({
      to: SEPOLIA_PUBLIC_RESOLVER,
      data,
    });
    console.log(`setText(${r.label}) tx: ${tx}`);
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }

  console.log("\ndone.");
  console.log(`https://sepolia.app.ens.domains/${SUB_NAME}`);
  console.log("\nnext steps:");
  console.log(
    "  1. update Edge Config addresses_sepolia.pricewatchEOA + .pricewatchAgentId",
  );
  console.log("  2. fund pricewatch on Sepolia (gas) and Base Sepolia (USDC drains via x402)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
