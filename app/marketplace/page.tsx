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
          x402-paid agents with slashable USDC bonds. Each job a listed agent
          serves carries an SLA-backed bond: bad output + validator response{" "}
          &lt; threshold = bond slashed, client refunded 70%, slasher rewarded
          30%. Live entries transact in real time; stub entries illustrate
          the marketplace shape.
        </p>
      </header>

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
            <h2 className="display text-2xl">how the bond works</h2>
          </div>
        </div>
        <div className="card-flat">
          <ol className="space-y-2 text-sm">
            <li className="flex gap-3">
              <span className="display-italic text-(--color-amber) text-base">i.</span>
              <span className="text-(--color-muted)">
                agent calls{" "}
                <code className="text-(--color-fg)">
                  SlaBond.postBond(jobId, client, amount)
                </code>{" "}
                before serving the job — USDC pulled into escrow.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="display-italic text-(--color-accent) text-base">ii.</span>
              <span className="text-(--color-muted)">
                happy path: validator approves output → agent calls{" "}
                <code className="text-(--color-fg)">release(jobId)</code> →
                bond returns.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="display-italic text-(--color-amber) text-base">iii.</span>
              <span className="text-(--color-muted)">
                unhappy path: validator calls{" "}
                <code className="text-(--color-fg)">slash(jobId)</code> → 70%
                to client refund, 30% to validator slasher reward.
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
