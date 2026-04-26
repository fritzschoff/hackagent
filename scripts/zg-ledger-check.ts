import { JsonRpcProvider, Wallet, formatEther } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

async function main() {
  const rpc = process.env.ZG_GALILEO_RPC_URL!;
  const pk = process.env.AGENT_PK!;
  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
  console.log("address:", await wallet.getAddress());
  console.log("wallet OG:", formatEther(await provider.getBalance(await wallet.getAddress())));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const broker = await createZGComputeNetworkBroker(wallet as any);

  try {
    const ledger = await broker.ledger.getLedger();
    console.log("ledger:", JSON.stringify(ledger, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v, 2));
  } catch (err) {
    console.log("getLedger failed:", err instanceof Error ? err.message : err);
  }

  try {
    const accounts = await broker.inference.getProvidersWithBalance("inference");
    console.log("providers with balance:", accounts);
  } catch (err) {
    console.log("getProvidersWithBalance failed:", err instanceof Error ? err.message : err);
  }
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
