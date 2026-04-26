import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  labelhash,
  namehash,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const CONTROLLER: Address = "0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968";
const PUBLIC_RESOLVER: Address = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";
const NAME_WRAPPER: Address = "0x0635513f179D50A207757E05759CbD106d7dFcE8";
const ENS_REGISTRY: Address = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

const PARENT_LABEL = "agentlab";
const PARENT_NAME = `${PARENT_LABEL}.eth`;
const SUB_LABEL = "tradewise";
const SUB_NAME = `${SUB_LABEL}.${PARENT_NAME}`;
const DURATION = 31_536_000n; // 1 year

const IDENTITY_REGISTRY: Address = "0x6aF06f682A7Ba7Db32587FDedF51B9190EF738fA";
const AGENT_ID = 1;
const AGENT_CARD_URL =
  process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/.well-known/agent-card.json`
    : "https://hackagent-nine.vercel.app/.well-known/agent-card.json";

const CONTROLLER_ABI = [
  {
    type: "function",
    name: "available",
    stateMutability: "view",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "rentPrice",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "string" },
      { name: "duration", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "base", type: "uint256" },
          { name: "premium", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "makeCommitment",
    stateMutability: "pure",
    inputs: [
      {
        name: "registration",
        type: "tuple",
        components: [
          { name: "label", type: "string" },
          { name: "owner", type: "address" },
          { name: "duration", type: "uint256" },
          { name: "secret", type: "bytes32" },
          { name: "resolver", type: "address" },
          { name: "data", type: "bytes[]" },
          { name: "reverseRecord", type: "uint8" },
          { name: "referrer", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "commit",
    stateMutability: "nonpayable",
    inputs: [{ name: "commitment", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "payable",
    inputs: [
      {
        name: "registration",
        type: "tuple",
        components: [
          { name: "label", type: "string" },
          { name: "owner", type: "address" },
          { name: "duration", type: "uint256" },
          { name: "secret", type: "bytes32" },
          { name: "resolver", type: "address" },
          { name: "data", type: "bytes[]" },
          { name: "reverseRecord", type: "uint8" },
          { name: "referrer", type: "bytes32" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

const RESOLVER_ABI = [
  {
    type: "function",
    name: "setAddr",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "addr", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
] as const;

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

function ensip25Key(): string {
  return `agent-registration[eip155:11155111:${IDENTITY_REGISTRY}][${AGENT_ID}]`;
}

async function main() {
  const pkRaw = process.env.AGENT_PK;
  if (!pkRaw) throw new Error("AGENT_PK not set");
  const pk = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as Hex;
  const account = privateKeyToAccount(pk);
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL not set");

  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });

  console.log(`agent: ${account.address}`);

  const available = (await publicClient.readContract({
    address: CONTROLLER,
    abi: CONTROLLER_ABI,
    functionName: "available",
    args: [PARENT_LABEL],
  })) as boolean;
  console.log(`available(${PARENT_NAME}): ${available}`);
  if (!available) {
    console.log("Already registered (or unavailable). Skipping registration.");
  }

  const subnode = namehash(SUB_NAME);
  const parentNode = namehash(PARENT_NAME);
  const ensip25 = ensip25Key();
  console.log(`parent namehash: ${parentNode}`);
  console.log(`sub    namehash: ${subnode}`);
  console.log(`ENSIP-25 key:    ${ensip25}`);

  if (available) {
    const price = (await publicClient.readContract({
      address: CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "rentPrice",
      args: [PARENT_LABEL, DURATION],
    })) as { base: bigint; premium: bigint };
    const total = price.base + price.premium;
    console.log(`rent: base=${price.base} premium=${price.premium} total=${total} wei`);

    const secret = keccak256(toHex(`hackagent-${Date.now()}`));
    const data: Hex[] = [];

    const registration = {
      label: PARENT_LABEL,
      owner: account.address,
      duration: DURATION,
      secret,
      resolver: PUBLIC_RESOLVER,
      data,
      reverseRecord: 0,
      referrer:
        ("0x" + "00".repeat(32)) as Hex,
    } as const;

    const commitment = (await publicClient.readContract({
      address: CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "makeCommitment",
      args: [registration],
    })) as Hex;
    console.log(`commitment: ${commitment}`);

    const commitTx = await walletClient.writeContract({
      address: CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "commit",
      args: [commitment],
    });
    console.log(`commit tx: ${commitTx}`);
    await publicClient.waitForTransactionReceipt({ hash: commitTx });

    console.log("waiting 65s for commit minimum age...");
    await new Promise((r) => setTimeout(r, 65_000));

    const value = (total * 110n) / 100n;
    const registerTx = await walletClient.writeContract({
      address: CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "register",
      args: [registration],
      value,
    });
    console.log(`register tx: ${registerTx}`);
    await publicClient.waitForTransactionReceipt({ hash: registerTx });
  }

  const subLabelHash = labelhash(SUB_LABEL);
  const subTx = await walletClient.writeContract({
    address: ENS_REGISTRY,
    abi: ENS_REGISTRY_ABI,
    functionName: "setSubnodeRecord",
    args: [
      parentNode,
      subLabelHash,
      account.address,
      PUBLIC_RESOLVER,
      0n,
    ],
  });
  console.log(`setSubnodeRecord tx: ${subTx}`);
  await publicClient.waitForTransactionReceipt({ hash: subTx });

  const setAddrData = encodeFunctionData({
    abi: RESOLVER_ABI,
    functionName: "setAddr",
    args: [subnode, account.address],
  });
  const setEnsip25Data = encodeFunctionData({
    abi: RESOLVER_ABI,
    functionName: "setText",
    args: [subnode, ensip25, "1"],
  });
  const setCardData = encodeFunctionData({
    abi: RESOLVER_ABI,
    functionName: "setText",
    args: [subnode, "agent-card", AGENT_CARD_URL],
  });
  const setDescData = encodeFunctionData({
    abi: RESOLVER_ABI,
    functionName: "setText",
    args: [
      subnode,
      "description",
      "tradewise — Uniswap quote concierge, paid in x402 USDC on Base Sepolia.",
    ],
  });
  const setUrlData = encodeFunctionData({
    abi: RESOLVER_ABI,
    functionName: "setText",
    args: [subnode, "url", "https://hackagent-nine.vercel.app"],
  });

  for (const [label, data] of [
    ["setAddr", setAddrData],
    ["setText(ENSIP-25)", setEnsip25Data],
    ["setText(agent-card)", setCardData],
    ["setText(description)", setDescData],
    ["setText(url)", setUrlData],
  ] as const) {
    const tx = await walletClient.sendTransaction({ to: PUBLIC_RESOLVER, data });
    console.log(`${label} tx: ${tx}`);
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }

  void NAME_WRAPPER;

  console.log("done.");
  console.log(`https://sepolia.app.ens.domains/${SUB_NAME}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
