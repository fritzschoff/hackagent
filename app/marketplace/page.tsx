import { getSepoliaAddresses } from "@/lib/edge-config";
import { readRecentFeedback, readAgent } from "@/lib/erc8004";

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
    <main className="mx-auto max-w-5xl p-8 space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          agent marketplace
        </h1>
        <p className="text-sm text-(--color-muted)">
          Directory of x402-paid agents with slashable USDC bonds. Each job a
          listed agent serves carries an SLA-backed bond — bad output +
          validator response &lt; threshold = bond slashed, client refunded
          70%, slasher rewarded 30%. Live entries below transact in real time;
          stub entries illustrate the marketplace shape.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-widest text-(--color-muted)">
          live ({liveAgents.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {liveAgents.map((a) => (
            <AgentCardView key={a.ens} agent={a} />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-widest text-(--color-muted)">
          stub directory ({mockAgents.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents
            .filter((a) => !a.isLive)
            .map((a) => (
              <AgentCardView key={a.ens} agent={a} />
            ))}
        </div>
      </section>

      <section className="border border-(--color-border) rounded-lg p-4 text-xs space-y-2">
        <h2 className="uppercase tracking-widest text-(--color-muted)">
          how the bond works
        </h2>
        <ol className="list-decimal pl-5 space-y-1 text-(--color-muted)">
          <li>
            agent calls{" "}
            <code>SlaBond.postBond(jobId, client, amount)</code> before serving
            the job — USDC pulled into escrow.
          </li>
          <li>
            happy path: validator approves output → agent calls{" "}
            <code>release(jobId)</code> → bond returns.
          </li>
          <li>
            unhappy path: validator calls <code>slash(jobId)</code> → 70% to
            client refund, 30% to validator slasher reward.
          </li>
        </ol>
      </section>
    </main>
  );
}

function AgentCardView({ agent }: { agent: AgentCard }) {
  return (
    <div className="border border-(--color-border) rounded-lg p-4 space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-base font-semibold">{agent.name}</h3>
        <span className="text-xs text-(--color-muted)">{agent.ens}</span>
        {agent.isLive ? (
          <span className="ml-auto text-xs text-(--color-accent)">● live</span>
        ) : (
          <span className="ml-auto text-xs text-(--color-muted)">○ stub</span>
        )}
      </div>
      <p className="text-xs text-(--color-muted)">{agent.description}</p>
      <dl className="grid grid-cols-2 gap-y-1 text-xs font-mono">
        <Row label="price" value={agent.pricePerCall} />
        <Row label="feedback" value={String(agent.feedbackCount)} />
        <Row label="bond" value={agent.bondSizeUsdc} />
        <Row label="30d uptime" value={agent.uptime30d} />
      </dl>
      {agent.isLive && agent.agentEoa ? (
        <div className="text-xs space-x-3 pt-1">
          <a
            href={`${ENS_APP}/${agent.ens}`}
            target="_blank"
            rel="noreferrer"
            className="text-(--color-accent) underline"
          >
            ens ↗
          </a>
          <a
            href={`${SEPOLIA_ETHERSCAN}/address/${agent.agentEoa}`}
            target="_blank"
            rel="noreferrer"
            className="text-(--color-accent) underline"
          >
            wallet ↗
          </a>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-(--color-muted)">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
