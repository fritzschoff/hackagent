/**
 * Mints the tradewise INFT, sealing the agent's memory blob via the oracle
 * library directly (no HTTP).
 *
 *   pnpm tsx scripts/mint-inft.ts
 *
 * Pulls AES-128 key store, encrypts the memory blob with AES-128-GCM, anchors
 * the ciphertext to 0G Storage, builds an EIP-191 mintProof signed by
 * INFT_ORACLE_PK, and submits the on-chain mint call.
 *
 * Sepolia signer: PRICEWATCH_PK (the deployer of V2 + INFT).
 * 0G Galileo signer: AGENT_PK / ZG_PRIVATE_KEY (Galileo OG balance for the anchor).
 *
 * Required env: PRICEWATCH_PK, AGENT_PK, INFT_ORACLE_PK, SEPOLIA_RPC_URL,
 * ZG_GALILEO_RPC_URL, INFT_ADDRESS, INFT_AGENT_ID, REDIS_URL.
 * Optional: INFT_MINT_TO (default: user's demo wallet).
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
import {
  aesKeyFresh,
  encryptBlob,
  anchorBlob,
  buildMintProof,
} from "../lib/inft-oracle";
import { storeKey } from "../lib/inft-redis";
import { hexToBytes, bytesToHex } from "@noble/curves/utils.js";

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

  envOrThrow("INFT_ORACLE_PK");
  envOrThrow("REDIS_URL");

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

  const nextTokenId = (await publicClient.readContract({
    address: inftAddress,
    abi: AgentINFTAbi,
    functionName: "totalSupply",
    args: [],
  }).catch(() => 0n)) as bigint;
  const tokenIdPredicted = nextTokenId + 1n;
  console.log(`predicted tokenId:         ${tokenIdPredicted}`);

  const memoryBlob = {
    agent: "tradewise.agentlab.eth",
    role: "uniswap quote concierge",
    skills: ["x402", "0g-compute", "keeperhub", "ens-ensip25"],
    persona: "terse, signed, dated",
    sealedBy: "agent-eoa-via-zg-broker",
    sealedAt: new Date().toISOString(),
  };

  console.log("generating fresh AES-128 key + encrypting memory blob...");
  const aesKey = aesKeyFresh();
  const ciphertext = encryptBlob(memoryBlob, aesKey);

  console.log("anchoring ciphertext to 0G Storage...");
  const anchored = await anchorBlob(ciphertext);
  console.log(`memory rootHash:  ${anchored.root}`);
  console.log(`memory uri:       ${anchored.uri}`);
  console.log(`anchor tx:        ${anchored.txHash}`);

  console.log("storing AES key in Redis (KEK-wrapped)...");
  await storeKey(tokenIdPredicted, aesKey);

  console.log("building EIP-191 mintProof signed by oracle key...");
  const dataHash = hexToBytes(anchored.root.slice(2));
  const nonce = new Uint8Array(48);
  crypto.getRandomValues(nonce);
  const mintProofBytes = buildMintProof(dataHash, nonce);
  const mintProof = ("0x" + bytesToHex(mintProofBytes)) as Hex;

  console.log("minting INFT...");
  const txHash = await walletClient.writeContract({
    address: inftAddress,
    abi: AgentINFTAbi,
    functionName: "mint",
    args: [mintTo, agentId, mintProof],
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
    `https://hackagent-nine.vercel.app/inft (after edge-config sync, INFT_TOKEN_ID=${tokenId})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
