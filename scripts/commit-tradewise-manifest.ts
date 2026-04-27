/**
 * Issue #6 — commit the tradewise compliance manifest on chain.
 *
 *   pnpm tsx scripts/commit-tradewise-manifest.ts
 *
 * The manifest is a signed declaration of every external data source the
 * agent touches (URL, ToS hash, license tier). It is uploaded to 0G Storage
 * (so the full document is publicly readable), and only the keccak256 root
 * + URI are anchored on the ComplianceManifest contract. Optionally posts a
 * USDC bond at commit time so the manifest has slashable teeth.
 *
 * Required env: PRICEWATCH_PK, SEPOLIA_RPC_URL, COMPLIANCE_REGISTRY (or
 * read from edge config), TRADEWISE_AGENT_ID (or read from edge config).
 * Optional: COMPLIANCE_BOND_USDC (default 1.00 USDC), SEPOLIA_USDC.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import ComplianceManifestAbi from "../lib/abis/ComplianceManifest.json";
import { getSepoliaAddresses } from "../lib/edge-config";
import { writeState } from "../lib/zg-storage";
import { buildManifestRoot, TRADEWISE_MANIFEST } from "../lib/compliance";

const ERC20_ABI = [
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
] as const;

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

async function main() {
  const rpcUrl = envOrThrow("SEPOLIA_RPC_URL");
  const pkRaw = envOrThrow("PRICEWATCH_PK");
  const pk = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as Hex;

  const addresses = await getSepoliaAddresses();
  const registry =
    (process.env.COMPLIANCE_REGISTRY as Address | undefined) ??
    addresses.complianceManifestAddress ??
    null;
  if (!registry) throw new Error("COMPLIANCE_REGISTRY missing");

  const usdc =
    (process.env.SEPOLIA_USDC as Address | undefined) ??
    addresses.sepoliaUsdcAddress ??
    null;

  const agentId = process.env.TRADEWISE_AGENT_ID
    ? BigInt(process.env.TRADEWISE_AGENT_ID)
    : BigInt(addresses.agentId);
  if (!agentId || agentId === 0n) throw new Error("agentId missing");

  const bondUsdc = process.env.COMPLIANCE_BOND_USDC ?? "1.00";
  const bondAmount =
    parseUnits(bondUsdc, 6) > 0n ? parseUnits(bondUsdc, 6) : 0n;

  // Use the canonical static doc so the on-chain root is reproducible by
  // anyone running buildManifestRoot(TRADEWISE_MANIFEST) at any time.
  const doc = { ...TRADEWISE_MANIFEST, agentId: Number(agentId) };

  console.log("[compliance] doc sources:", doc.sources.length);
  console.log("[compliance] uploading manifest to 0G Storage…");
  const upload = await writeState("compliance-manifest", doc);
  if (!upload) {
    console.warn(
      "[compliance] 0G upload returned null — fallback URI will reference root only",
    );
  }
  const manifestRoot = buildManifestRoot(doc);
  const manifestUri = upload
    ? `og://${upload.rootHash}`
    : `mem://${manifestRoot}`;
  console.log("[compliance] manifestRoot:", manifestRoot);
  console.log("[compliance] manifestUri :", manifestUri);

  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  if (bondAmount > 0n && usdc) {
    const allowance = (await publicClient.readContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account.address, registry],
    })) as bigint;
    if (allowance < bondAmount) {
      console.log("[compliance] approving USDC bond…");
      const approveTx = await walletClient.writeContract({
        address: usdc,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [registry, bondAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });
      console.log("[compliance] approve tx:", approveTx);
    }
  } else if (bondAmount > 0n) {
    console.warn("[compliance] USDC address missing — committing without bond");
  }

  console.log(
    `[compliance] commitManifest agentId=${agentId} bond=${bondAmount}`,
  );
  const commitTx = await walletClient.writeContract({
    address: registry,
    abi: ComplianceManifestAbi,
    functionName: "commitManifest",
    args: [agentId, manifestRoot, manifestUri, usdc ? bondAmount : 0n],
  });
  await publicClient.waitForTransactionReceipt({ hash: commitTx });
  console.log("[compliance] commit tx:", commitTx);
  console.log("[compliance] done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
