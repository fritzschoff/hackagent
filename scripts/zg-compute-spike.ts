import { JsonRpcProvider, Wallet, formatEther } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

async function main() {
  const rpc = process.env.ZG_GALILEO_RPC_URL;
  const pk = process.env.AGENT_PK;
  if (!rpc || !pk) throw new Error("set ZG_GALILEO_RPC_URL and AGENT_PK");

  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
  console.log("wallet:", await wallet.getAddress());
  const bal = await provider.getBalance(await wallet.getAddress());
  console.log("balance:", formatEther(bal), "OG");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const broker = await createZGComputeNetworkBroker(wallet as any);
  console.log("broker ready");

  const services = await broker.inference.listService();
  // tuple shape: [provider, type, url, inputPrice, outputPrice, ts, model, verifiability, attestationJson, signer, registered]
  type ServiceTuple = readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    boolean,
  ];
  const chat = (services as unknown as ServiceTuple[]).find((s) => s[1] === "chatbot");
  if (!chat) {
    console.log("no chatbot service available");
    return;
  }
  const providerAddr = chat[0];
  console.log("using provider:", providerAddr, "model:", chat[6]);

  try {
    console.log("depositing 3 OG to ledger (one-time minimum)...");
    await broker.ledger.depositFund(3);
    console.log("deposit ok");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Account already exists") || msg.includes("already")) {
      console.log("ledger already funded; continuing");
    } else {
      console.error("depositFund failed:", msg);
    }
  }

  try {
    console.log("acknowledging provider...");
    await broker.inference.acknowledgeProviderSigner(providerAddr);
    console.log("ack ok");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already")) {
      console.log("provider already acknowledged; continuing");
    } else {
      console.error("acknowledge failed:", msg);
      throw err;
    }
  }

  const meta = await broker.inference.getServiceMetadata(providerAddr);
  console.log("endpoint:", meta.endpoint, "model:", meta.model);

  const body = {
    model: meta.model,
    messages: [
      {
        role: "system",
        content:
          "You are tradewise, an autonomous agent that quotes Uniswap swaps. Reply tersely.",
      },
      {
        role: "user",
        content:
          'Should an agent worry about UniswapX minimum quote sizes when offering test swaps? One sentence.',
      },
    ],
    max_tokens: 80,
  };

  const headers = await broker.inference.getRequestHeaders(
    providerAddr,
    JSON.stringify(body),
  );
  console.log("auth header keys:", Object.keys(headers).join(", "));

  console.log("calling chat completion...");
  const res = await fetch(`${meta.endpoint}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  console.log("http:", res.status);
  const text = await res.text();
  console.log("response body (first 600):");
  console.log(text.slice(0, 600));

  if (res.ok) {
    try {
      const json = JSON.parse(text) as {
        choices?: { message?: { content?: string } }[];
        id?: string;
      };
      const completion = json.choices?.[0]?.message?.content ?? "";
      console.log("\n=== completion ===\n", completion);
      const teeKey = res.headers.get("ZG-Res-Key") ?? res.headers.get("zg-res-key");
      console.log("ZG-Res-Key:", teeKey);
      if (json.id) {
        const usageJson = JSON.stringify({
          input_tokens: (json as { usage?: { prompt_tokens?: number } }).usage?.prompt_tokens ?? 0,
          output_tokens: (json as { usage?: { completion_tokens?: number } }).usage?.completion_tokens ?? 0,
        });
        try {
          const verified = await broker.inference.processResponse(
            providerAddr,
            json.id,
            usageJson,
          );
          console.log("processResponse ->", verified);
        } catch (err) {
          console.error("processResponse failed:", err instanceof Error ? err.message : err);
        }
      }
    } catch {
      console.log("(non-json response)");
    }
  }
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
