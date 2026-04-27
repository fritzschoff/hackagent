/**
 * Mints the tradewise INFT pointing at the agent's encrypted memory blob on
 * 0G Storage.
 *
 *   pnpm tsx scripts/mint-inft.ts
 *
 * For demo purposes the "encrypted" blob is just a sealed JSON written to 0G
 * Storage via the existing writeBlob path; real ERC-7857 demands TEE-attested
 * re-encryption on transfer, which is left as future work.
 *
 * Sepolia signer: PRICEWATCH_PK (the deployer of V2 + INFT — has the gas).
 * 0G Galileo signer: AGENT_PK / ZG_PRIVATE_KEY (has Galileo OG balance).
 *
 * Required env: PRICEWATCH_PK, AGENT_PK, SEPOLIA_RPC_URL, ZG_GALILEO_RPC_URL,
 * INFT_ADDRESS, INFT_AGENT_ID. Optional: INFT_MINT_TO (default: user's demo
 * wallet 0x71226c538679eD4A72E803b3E2C93aD7403DA094).
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import AgentINFTAbi from "../lib/abis/AgentINFT.json";
import { writeState } from "../lib/zg-storage";

const DEFAULT_MINT_TO: Address =
  "0x71226c538679eD4A72E803b3E2C93aD7403DA094";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

async function main() {
  const rpcUrl = envOrThrow("SEPOLIA_RPC_URL");
  const pkRaw = envOrThrow("PRICEWATCH_PK");
  const pk = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as Hex;
  const inftAddress = envOrThrow("INFT_ADDRESS") as Address;
  const agentId = BigInt(envOrThrow("INFT_AGENT_ID"));
  const mintToRaw = process.env.INFT_MINT_TO ?? DEFAULT_MINT_TO;
  if (!/^0x[a-fA-F0-9]{40}$/.test(mintToRaw)) {
    throw new Error(`invalid INFT_MINT_TO: ${mintToRaw}`);
  }
  const mintTo = mintToRaw as Address;

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

  console.log(`Sepolia signer (deployer): ${account.address}`);
  console.log(`INFT contract:             ${inftAddress}`);
  console.log(`agentId:                   ${agentId}`);
  console.log(`mint recipient:            ${mintTo}`);

  const existing = (await publicClient.readContract({
    address: inftAddress,
    abi: AgentINFTAbi,
    functionName: "tokenIdForAgent",
    args: [agentId],
  })) as bigint;
  if (existing > 0n) {
    console.log(`already minted: tokenId=${existing}`);
    return;
  }

  const memoryBlob = {
    agent: "tradewise.agentlab.eth",
    role: "uniswap quote concierge",
    skills: ["x402", "0g-compute", "keeperhub", "ens-ensip25"],
    persona: "terse, signed, dated",
    sealedBy: "agent-eoa-via-zg-broker",
    sealedAt: new Date().toISOString(),
  };

  console.log("anchoring memory blob to 0G Storage...");
  const written = await writeState("inft-memory", memoryBlob);
  if (!written?.rootHash) {
    throw new Error("0G Storage anchor failed; cannot mint");
  }
  const root = written.rootHash as Hex;
  const uri = `og://${written.rootHash}`;
  console.log(`memory rootHash:  ${root}`);
  console.log(`memory uri:       ${uri}`);
  console.log(`anchored=${written.anchored} segments=${written.segmentsUploaded}`);

  console.log("minting INFT...");
  const txHash = await walletClient.writeContract({
    address: inftAddress,
    abi: AgentINFTAbi,
    functionName: "mint",
    args: [mintTo, agentId, root, uri],
  });
  console.log(`mint tx: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  console.log(`block: ${receipt.blockNumber}`);

  const tokenId = (await publicClient.readContract({
    address: inftAddress,
    abi: AgentINFTAbi,
    functionName: "tokenIdForAgent",
    args: [agentId],
  })) as bigint;
  console.log(`\ndone.\ntokenId: ${tokenId}`);
  console.log(`https://sepolia.etherscan.io/tx/${txHash}`);
  console.log(
    `https://hackagent-nine.vercel.app/inft (after env sync, INFT_TOKEN_ID=${tokenId})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
