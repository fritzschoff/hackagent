import { getSepoliaAddresses } from "@/lib/edge-config";
import { readRecentFeedback, readAgent } from "@/lib/erc8004";
import SiteNav from "@/components/site-nav";

export const revalidate = 60;

const SEPOLIA_ETHERSCAN = "https://sepolia.etherscan.io";
const ENS_APP = "https://sepolia.app.ens.domains";

type AgentCard = {
  name: string;
  ens: string;
  agentId: bigint | null;
  agentEoa: string | null;
  description: string;
  pricePerCall: string;
  feedbackCount: number;
  bondSizeUsdc: string;
  uptime30d: string;
  isLive: boolean;
};

const MOCK_AGENTS: Omit<
  AgentCard,
  "feedbackCount" | "isLive" | "agentId" | "agentEoa"
>[] = [
  {
    name: "txwatcher",
    ens: "txwatcher.agentlab.eth",
    description:
      "Mempool watcher for ERC-20 large transfers. Webhooks per match.",
    pricePerCall: "$0.05",
    bondSizeUsdc: "$1.00",
    uptime30d: "98.4%",
  },
  {
    name: "creditscore",
    ens: "creditscore.agentlab.eth",
    description:
      "Cross-protocol DeFi credit score from 14 lending markets.",
    pricePerCall: "$0.30",
    bondSizeUsdc: "$5.00",
    uptime30d: "99.1%",
  },
  {
    name: "newswire",
    ens: "newswire.agentlab.eth",
    description:
      "On-chain governance + protocol-update headlines. RSS-compatible.",
    pricePerCall: "$0.04",
    bondSizeUsdc: "$0.50",
    uptime30d: "97.7%",
  },
  {
    name: "compliance",
    ens: "compliance.agentlab.eth",
    description:
      "OFAC + Tornado tag check on any address. Auditable trail.",
    pricePerCall: "$0.08",
    bondSizeUsdc: "$2.00",
    uptime30d: "99.8%",
  },
];

async function readLiveAgents(): Promise<AgentCard[]> {
  const addresses = await getSepoliaAddresses();
  const tradewiseId = BigInt(addresses.agentId);
  const pricewatchId = addresses.pricewatchAgentId
    ? BigInt(addresses.pricewatchAgentId)
    : null;

  const cards: AgentCard[] = [];

  if (tradewiseId > 0n) {
    const fb = await readRecentFeedback(50);
    const tradewiseFb = fb.filter((f) => f.agentId === tradewiseId);
    const agent = await readAgent(tradewiseId);
    cards.push({
      name: "tradewise",
      ens: "tradewise.agentlab.eth",
      agentId: tradewiseId,
      agentEoa: agent?.agentAddress ?? addresses.agentEOA,
      description:
        "Uniswap quote concierge. Pay-per-quote x402 USDC. INFT-tradeable.",
      pricePerCall: "$0.10–$0.20",
      feedbackCount: tradewiseFb.length,
      bondSizeUsdc: "$1.00",
      uptime30d: "live",
      isLive: true,
    });
  }

  if (pricewatchId !== null && pricewatchId > 0n) {
    const fb = await readRecentFeedback(50);
    const pwFb = fb.filter((f) => f.agentId === pricewatchId);
    const agent = await readAgent(pricewatchId);
    cards.push({
      name: "pricewatch",
      ens: "pricewatch.agentlab.eth",
      agentId: pricewatchId,
      agentEoa: agent?.agentAddress ?? null,
      description:
        "Token metadata sidecar. Symbol, decimals, last price, liquidity.",
      pricePerCall: "$0.02",
      feedbackCount: pwFb.length,
      bondSizeUsdc: "$0.20",
      uptime30d: "live",
      isLive: true,
    });
  }

  return cards;
}

export default async function MarketplacePage() {
  const liveAgents = await readLiveAgents();
  const mockAgents: AgentCard[] = MOCK_AGENTS.map((m) => ({
    ...m,
    feedbackCount: 0,
    agentId: null,
    agentEoa: null,
    isLive: false,
  }));
  const agents = [...liveAgents, ...mockAgents];

  return (
    <main className="mx-auto max-w-6xl px-6 md:px-10 pb-24">
      <SiteNav active="marketplace" />
      <header className="pt-6 pb-10 border-b-2 border-(--color-fg) reveal reveal-1">
        <p className="tag mb-2">sla-insured directory · sepolia</p>
        <h1 className="display text-[clamp(2.25rem,6vw,4rem)] leading-[0.95] tracking-tight">
          agent <span className="display-italic font-light">marketplace</span>
        </h1>
        <p className="mt-3 text-sm text-(--color-muted) max-w-2xl">
          A directory of autonomous agents you can call from any HTTP client.
          Each agent advertises its endpoint via ENS + agent-card.json, charges
          per call in x402 USDC, and posts an on-chain SLA bond that gets
          slashed if validators reject the response. Live entries transact in
          real time; stub entries illustrate the marketplace shape.
        </p>
      </header>

      <section className="mt-12 reveal reveal-2 card-flat">
        <p className="tag mb-3">roles · who&apos;s who in a single call</p>
        <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-y-3 gap-x-4 text-sm">
          <dt className="display-italic">client</dt>
          <dd className="text-(--color-muted) leading-relaxed">
            The caller — your script, agent, or any HTTP client with a wallet.
            Discovers the agent via ENS, makes a request, gets back a{" "}
            <code>402 Payment Required</code> with the price, signs a USDC
            transfer authorization, and re-submits.
          </dd>
          <dt className="display-italic">agent</dt>
          <dd className="text-(--color-muted) leading-relaxed">
            One of the cards below. Receives the call, settles the x402 payment
            on Base Sepolia (USDC is pulled from the client into the agent&apos;s
            payout address), serves the response, and may post an SLA bond on
            Sepolia for the job.
          </dd>
          <dt className="display-italic">validator</dt>
          <dd className="text-(--color-muted) leading-relaxed">
            A separate ERC-8004 actor — could be a peer agent, an oracle, or a
            human reviewer. Posts a score for the job to{" "}
            <code>ValidationRegistry</code>. If the score is below threshold,
            anyone can call <code>SlaBond.slash(jobId)</code>.
          </dd>
          <dt className="display-italic">slasher</dt>
          <dd className="text-(--color-muted) leading-relaxed">
            Anyone, on the unhappy path. Calling{" "}
            <code>slash(jobId)</code> after a bad validator score sends 70% of
            the bond to the client (refund) and 30% to{" "}
            <code>msg.sender</code> (slasher reward).
          </dd>
        </dl>
      </section>

      <section className="mt-12 reveal reveal-2">
        <div className="flex items-baseline gap-5 mb-5">
          <span className="section-marker">§01</span>
          <div>
            <h2 className="display text-2xl">live</h2>
            <p className="tag mt-1">{liveAgents.length} agents transacting</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {liveAgents.map((a) => (
            <AgentCardView key={a.ens} agent={a} />
          ))}
        </div>
      </section>

      <section className="mt-12 reveal reveal-3">
        <div className="flex items-baseline gap-5 mb-5">
          <span className="section-marker">§02</span>
          <div>
            <h2 className="display text-2xl">directory</h2>
            <p className="tag mt-1">{mockAgents.length} stub entries</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents
            .filter((a) => !a.isLive)
            .map((a) => (
              <AgentCardView key={a.ens} agent={a} />
            ))}
        </div>
      </section>

      <section className="mt-12 reveal reveal-4">
        <div className="flex items-baseline gap-5 mb-5">
          <span className="section-marker">§03</span>
          <div>
            <h2 className="display text-2xl">how to call a live agent</h2>
            <p className="tag mt-1">x402 round-trip · ~2s end to end</p>
          </div>
        </div>
        <div className="card-flat space-y-5 text-sm">
          <ol className="space-y-3">
            <li className="flex gap-3">
              <span className="display-italic text-(--color-amber) text-base shrink-0 w-7">
                1.
              </span>
              <div className="text-(--color-muted) leading-relaxed">
                <strong className="text-(--color-fg)">discover</strong>: resolve
                the agent&apos;s ENS name to its{" "}
                <code>agent-card.json</code> URL, which lists the job
                endpoint, supported tasks, and price tiers.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="display-italic text-(--color-amber) text-base shrink-0 w-7">
                2.
              </span>
              <div className="text-(--color-muted) leading-relaxed">
                <strong className="text-(--color-fg)">probe</strong>: POST your
                request to the job endpoint. The agent replies{" "}
                <code>402 Payment Required</code> with a base64{" "}
                <code>payment-required</code> header — that header contains the
                amount, asset, network, and <code>payTo</code> address.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="display-italic text-(--color-amber) text-base shrink-0 w-7">
                3.
              </span>
              <div className="text-(--color-muted) leading-relaxed">
                <strong className="text-(--color-fg)">pay & retry</strong>: sign
                a USDC <code>transferWithAuthorization</code> for the quoted
                amount on Base Sepolia, encode it into an{" "}
                <code>x-payment</code> header, and re-POST. Use any x402 client
                — <code>@x402/fetch</code>, <code>x402-axios</code>, or a hand-
                rolled signer.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="display-italic text-(--color-accent) text-base shrink-0 w-7">
                4.
              </span>
              <div className="text-(--color-muted) leading-relaxed">
                <strong className="text-(--color-fg)">receive</strong>: the
                facilitator settles the USDC transfer on Base Sepolia and the
                agent returns the response body plus a{" "}
                <code>payment-response</code> header containing the settlement
                tx hash.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="display-italic text-(--color-accent) text-base shrink-0 w-7">
                5.
              </span>
              <div className="text-(--color-muted) leading-relaxed">
                <strong className="text-(--color-fg)">validate (optional)</strong>
                : a validator posts a score on Sepolia. If you got bad output,
                anyone can slash the agent&apos;s SLA bond and you receive a
                70% USDC refund.
              </div>
            </li>
          </ol>

          <div className="pt-4 border-t border-(--color-rule) space-y-2">
            <p className="tag">try it · curl tradewise</p>
            <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-(--color-rule)/40 p-3 rounded">
              {`# 1. probe — get the 402 challenge
curl -i -X POST https://hackagent-nine.vercel.app/api/a2a/jobs \\
  -H "Content-Type: application/json" \\
  -d '{"task":"swap","tokenIn":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","tokenOut":"0x7683022d84F726a96c4A6611cD31DBf5409c0Ac9","amountIn":"1000000","maxSlippageBps":100}'

# 2. pay & retry with @x402/fetch (TS / Node)
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
const fetchWithX402 = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:84532", client: ourBaseSepoliaSigner }],
});
const res = await fetchWithX402(url, { method: "POST", body: JSON.stringify(intent) });`}
            </pre>
          </div>
        </div>
      </section>

      <section className="mt-12 reveal reveal-4">
        <div className="flex items-baseline gap-5 mb-5">
          <span className="section-marker">§04</span>
          <div>
            <h2 className="display text-2xl">the SLA bond</h2>
            <p className="tag mt-1">why the price-per-call is trustable</p>
          </div>
        </div>
        <div className="card-flat space-y-3 text-sm">
          <p className="text-(--color-muted) leading-relaxed">
            x402 settlement is final the moment the USDC transfer lands —
            there&apos;s no automatic refund if the agent returns garbage. The
            SLA bond closes that loop on-chain.
          </p>
          <ol className="space-y-2 pt-2">
            <li className="flex gap-3">
              <span className="display-italic text-(--color-amber) text-base">
                i.
              </span>
              <span className="text-(--color-muted)">
                Agent calls{" "}
                <code className="text-(--color-fg)">
                  SlaBond.postBond(jobId, client, amount)
                </code>{" "}
                before serving — USDC is pulled from the agent into escrow.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="display-italic text-(--color-accent) text-base">
                ii.
              </span>
              <span className="text-(--color-muted)">
                Happy path: validator approves the output, agent calls{" "}
                <code className="text-(--color-fg)">release(jobId)</code>, bond
                returns to the agent.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="display-italic text-(--color-amber) text-base">
                iii.
              </span>
              <span className="text-(--color-muted)">
                Unhappy path: a validator score below threshold lets anyone call{" "}
                <code className="text-(--color-fg)">slash(jobId)</code> → 70%
                USDC refund to the client, 30% to the slasher as the
                rate-limiting bounty.
              </span>
            </li>
          </ol>
        </div>
      </section>
    </main>
  );
}

function AgentCardView({ agent }: { agent: AgentCard }) {
  return (
    <article className="card flex flex-col gap-3">
      <header className="flex items-baseline gap-2">
        <h3 className="display text-xl">{agent.name}</h3>
        <span className="text-xs text-(--color-muted) font-mono">
          {agent.ens}
        </span>
        {agent.isLive ? (
          <span className="ml-auto pill pill-live">
            <span className="dot dot-pulse" /> live
          </span>
        ) : (
          <span className="ml-auto pill pill-idle">stub</span>
        )}
      </header>
      <p className="text-xs text-(--color-muted) leading-relaxed">
        {agent.description}
      </p>
      <dl className="grid grid-cols-2 gap-y-2 text-xs">
        <Row label="price" value={agent.pricePerCall} />
        <Row label="feedback" value={String(agent.feedbackCount)} />
        <Row label="bond" value={agent.bondSizeUsdc} />
        <Row label="30d uptime" value={agent.uptime30d} />
      </dl>
      {agent.isLive && agent.agentEoa ? (
        <div className="text-xs space-x-4 pt-2 border-t border-(--color-rule)">
          <a
            href={`${ENS_APP}/${agent.ens}`}
            target="_blank"
            rel="noreferrer"
            className="link"
          >
            ens →
          </a>
          <a
            href={`${SEPOLIA_ETHERSCAN}/address/${agent.agentEoa}`}
            target="_blank"
            rel="noreferrer"
            className="link"
          >
            wallet →
          </a>
        </div>
      ) : null}
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="tag">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </>
  );
}
