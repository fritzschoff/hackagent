import { JsonRpcProvider, Wallet } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

type ServiceTuple = readonly [
  string, // provider
  string, // type ("chatbot" | "image-editing" | …)
  string, // url
  string, // inputPricePerToken (string-encoded bigint)
  string, // outputPricePerToken
  string, // updatedAt
  string, // model
  string, // verifiability ("TeeML" | "TeeTLS" | …)
  string, // attestation json
  string, // signer
  boolean, // registered
];

type Broker = Awaited<ReturnType<typeof createZGComputeNetworkBroker>>;
type ZgState = {
  broker: Broker;
  provider: string;
  metadata: { endpoint: string; model: string };
} | null;

let cached: ZgState = null;
let initPromise: Promise<ZgState> | null = null;

async function init(): Promise<ZgState> {
  const rpc = process.env.ZG_GALILEO_RPC_URL;
  const pk = process.env.ZG_PRIVATE_KEY ?? process.env.AGENT_PK;
  if (!rpc || !pk) return null;
  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const broker = await createZGComputeNetworkBroker(wallet as any);
  const services = (await broker.inference.listService()) as unknown as ServiceTuple[];
  const chat = services.find((s) => s[1] === "chatbot");
  if (!chat) return null;
  const providerAddr = chat[0];
  try {
    await broker.inference.acknowledgeProviderSigner(providerAddr);
  } catch {
    // already acknowledged, or ledger not created (3 OG min);
    // first inference call below will surface the funding error.
  }
  const meta = await broker.inference.getServiceMetadata(providerAddr);
  return { broker, provider: providerAddr, metadata: meta };
}

async function getZg(): Promise<ZgState> {
  if (cached) return cached;
  if (!initPromise) {
    initPromise = init().then((v) => {
      cached = v;
      return v;
    });
  }
  return initPromise;
}

export type ReasoningResult = {
  text: string;
  model: string;
  provider: string;
  teeAttested: boolean;
};

export async function reasonAboutQuote(args: {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
}): Promise<ReasoningResult | null> {
  let zg: ZgState;
  try {
    zg = await getZg();
  } catch (err) {
    console.error(
      "[zg-compute] init failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
  if (!zg) return null;

  const body = {
    model: zg.metadata.model,
    messages: [
      {
        role: "system",
        content:
          "You are tradewise, an autonomous on-chain swap concierge. Given a quote, write one terse sentence explaining why it's a reasonable fill. No hedging.",
      },
      {
        role: "user",
        content: `Quote: ${args.amountIn} of ${args.tokenIn} -> ${args.amountOut} of ${args.tokenOut}. One sentence.`,
      },
    ],
    max_tokens: 60,
  };

  try {
    const headers = await zg.broker.inference.getRequestHeaders(
      zg.provider,
      JSON.stringify(body),
    );
    const res = await fetch(`${zg.metadata.endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[zg-compute] http ${res.status}: ${text.slice(0, 300)}`);
      return null;
    }
    const json = (await res.json()) as {
      id?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    const teeKey =
      res.headers.get("ZG-Res-Key") ?? res.headers.get("zg-res-key");

    let teeAttested = false;
    if (teeKey) {
      const usageJson = JSON.stringify({
        input_tokens: json.usage?.prompt_tokens ?? 0,
        output_tokens: json.usage?.completion_tokens ?? 0,
      });
      try {
        teeAttested = Boolean(
          await zg.broker.inference.processResponse(
            zg.provider,
            teeKey,
            usageJson,
          ),
        );
      } catch (err) {
        console.error(
          "[zg-compute] processResponse failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    return {
      text,
      model: zg.metadata.model,
      provider: zg.provider,
      teeAttested,
    };
  } catch (err) {
    console.error(
      "[zg-compute] reasoning failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
