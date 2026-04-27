/**
 * Issue #7 — authorize the KeeperHub Turnkey wallet to write text records
 * on the tradewise.agentlab.eth subname so the heartbeat + reputation-cache
 * workflows can call setText without owning the subname.
 *
 *   pnpm tsx scripts/approve-keeperhub-ens.ts
 *
 * NOTE: the ENS subname `tradewise.agentlab.eth` is owned by AGENT_EOA
 * (0x7a83…20A3), not by the deployer (PRICEWATCH_PK). The resolver's
 * `isApprovedFor` is keyed off `ens.owner(node)`, so the approve must be
 * sent from AGENT_PK.
 *
 * Required env: AGENT_PK (owns the subname on the ENS Registry),
 * SEPOLIA_RPC_URL.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  namehash,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const RESOLVER: Address = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";
const TURNKEY_WALLET: Address = "0xB28cC07F397Af54c89b2Ff06b6c595F282856539";
const ENS_NAME = "tradewise.agentlab.eth";

const RESOLVER_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "delegate", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isApprovedFor",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "node", type: "bytes32" },
      { name: "delegate", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const pkRaw = process.env.AGENT_PK;
  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL missing");
  if (!pkRaw) throw new Error("AGENT_PK missing");

  const pk = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as Hex;
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

  const node = namehash(ENS_NAME);
  console.log(`[ens-approve] subname        ${ENS_NAME}`);
  console.log(`[ens-approve] namehash       ${node}`);
  console.log(`[ens-approve] subname owner  ${account.address}`);
  console.log(`[ens-approve] delegate       ${TURNKEY_WALLET}`);

  const already = (await publicClient.readContract({
    address: RESOLVER,
    abi: RESOLVER_APPROVE_ABI,
    functionName: "isApprovedFor",
    args: [account.address, node, TURNKEY_WALLET],
  })) as boolean;

  if (already) {
    console.log("[ens-approve] already approved, nothing to do.");
    return;
  }

  console.log("[ens-approve] sending approve tx…");
  const hash = await walletClient.writeContract({
    address: RESOLVER,
    abi: RESOLVER_APPROVE_ABI,
    functionName: "approve",
    args: [node, TURNKEY_WALLET, true],
  });
  console.log(`[ens-approve] tx ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[ens-approve] block ${receipt.blockNumber} status ${receipt.status}`);

  const after = (await publicClient.readContract({
    address: RESOLVER,
    abi: RESOLVER_APPROVE_ABI,
    functionName: "isApprovedFor",
    args: [account.address, node, TURNKEY_WALLET],
  })) as boolean;
  console.log(`[ens-approve] isApprovedFor → ${after}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
