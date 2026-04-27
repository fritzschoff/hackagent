import Link from "next/link";
import SiteNav from "@/components/site-nav";

export const revalidate = 3600;

export default function FaqPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 md:px-10 pb-24">
      <SiteNav active="faq" />
      <header className="pt-6 pb-10 border-b-2 border-(--color-fg) reveal reveal-1">
        <p className="tag mb-2">guide · for judges &amp; explorers</p>
        <h1 className="display text-[clamp(2.25rem,6vw,4rem)] leading-[0.95] tracking-tight">
          how it works{" "}
          <span className="display-italic font-light text-(--color-muted)">
            / faq
          </span>
        </h1>
        <p className="mt-3 text-sm max-w-2xl text-(--color-muted)">
          tradewise.agentlab.eth is a fully autonomous on-chain agent. It earns
          revenue, has reputation, can be owned, traded, financed, insured, and
          merged — every primitive is a real contract on Sepolia or Base
          Sepolia. This page is the map.
        </p>
      </header>

      <nav className="mt-10 reveal reveal-2 flex flex-wrap gap-x-6 gap-y-2 text-xs">
        <a href="#tldr" className="link">tl;dr</a>
        <a href="#networks" className="link">networks &amp; chains</a>
        <a href="#identity" className="link">identity &amp; reputation</a>
        <a href="#payments" className="link">payments (x402)</a>
        <a href="#inft" className="link">inft &amp; bidding</a>
        <a href="#ipo" className="link">ipo &amp; dividends</a>
        <a href="#credit" className="link">credit market</a>
        <a href="#sla" className="link">sla marketplace</a>
        <a href="#merger" className="link">m&amp;a</a>
        <a href="#compliance" className="link">compliance</a>
        <a href="#keeperhub" className="link">keeperhub</a>
        <a href="#try" className="link">try it yourself</a>
      </nav>

      <section id="tldr" className="mt-12 reveal reveal-3">
        <Header marker="§00" title="tl;dr" />
        <div className="card-flat space-y-3 text-sm leading-relaxed">
          <p>
            <span className="display-italic text-(--color-accent)">tradewise</span>{" "}
            is an AI agent that quotes Uniswap prices for{" "}
            <span className="display-italic">$0.10–$0.20 per quote</span>, paid
            in USDC over the{" "}
            <a href="https://x402.gitbook.io" target="_blank" rel="noreferrer" className="link">
              x402 protocol
            </a>
            . It has an ENS name, an ERC-8004 identity, an ERC-7857 INFT shell
            that anyone can buy, an ERC-20 revenue-share token (TRADE), an
            uncollateralized credit line, an SLA bond, and a merger contract
            that can fold it into another agent.
          </p>
          <p className="text-(--color-muted)">
            Every page on this site reads from on-chain state. Every action
            button writes to a real contract. There is no mock data on the live
            cards.
          </p>
        </div>
      </section>

      <section id="networks" className="mt-12 reveal reveal-4">
        <Header marker="§01" title="which network do I need?" />
        <div className="card-flat space-y-4">
          <p className="text-sm text-(--color-muted) leading-relaxed">
            Two testnets, split by use case. Your wallet must be on the right
            chain for each action — controls show a banner and a one-click
            switch button when you&apos;re on the wrong network.
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-y-3 text-sm">
            <Dt>Sepolia</Dt>
            <Dd>
              ERC-8004 identity + reputation, ERC-7857 INFT, bidding, credit,
              SLA bonds, M&amp;A. <Code>chainId 11155111</Code>.{" "}
              <a href="https://sepoliafaucet.com/" target="_blank" rel="noreferrer" className="link">
                free ETH faucet
              </a>{" "}
              ·{" "}
              <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer" className="link">
                free USDC faucet
              </a>
              .
            </Dd>
            <Dt>Base Sepolia</Dt>
            <Dd>
              x402 USDC settlement (the agent is paid here) + the IPO contracts
              (TRADE shares, dividends, primary sale). <Code>chainId 84532</Code>.{" "}
              <a href="https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet" target="_blank" rel="noreferrer" className="link">
                free ETH faucet
              </a>{" "}
              ·{" "}
              <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer" className="link">
                free USDC faucet
              </a>
              .
            </Dd>
          </dl>
        </div>
      </section>

      <section id="identity" className="mt-12 reveal reveal-5">
        <Header marker="§02" title="identity & reputation" />
        <div className="card-flat space-y-3 text-sm leading-relaxed">
          <p>
            The agent is registered in{" "}
            <Code>IdentityRegistryV2</Code> (an ERC-8004 implementation) under{" "}
            <Code>agentId #1</Code>. Its identity is bound to{" "}
            <Code>tradewise.agentlab.eth</Code> via ENSIP-25 — name, avatar,
            description, and a reputation summary text record live there.
          </p>
          <p className="text-(--color-muted)">
            Every successful x402 quote produces a feedback event in{" "}
            <Code>ReputationRegistry</Code>. Anyone can read{" "}
            <Code>feedbackCount(agentId)</Code> directly on chain. That number
            is the credit limit input, the dynamic-pricing tier input, and the
            M&amp;A constituent score.
          </p>
          <p className="text-(--color-muted)">
            §4.4 anti-laundering: when the INFT owner changes, the payout
            wallet auto-clears. The new owner has to sign an EIP-712{" "}
            <Code>setAgentWallet</Code> message before x402 settlement
            resumes.
          </p>
        </div>
      </section>

      <section id="payments" className="mt-12 reveal reveal-6">
        <Header marker="§03" title="payments — what is x402?" />
        <div className="card-flat space-y-3 text-sm leading-relaxed">
          <p>
            <a href="https://x402.gitbook.io" target="_blank" rel="noreferrer" className="link">
              x402
            </a>{" "}
            is HTTP-native machine payments. The agent answers an unpaid quote
            request with <Code>HTTP 402 Payment Required</Code> and a
            settlement quote in USDC. The client signs a permit, retries, and
            the resource is unlocked. There&apos;s no API key, no Stripe
            account, no human in the loop.
          </p>
          <p className="text-(--color-muted)">
            Pricing is reputation-gated:{" "}
            <Code>&lt;50 → $0.10</Code>,{" "}
            <Code>50–100 → $0.15</Code>,{" "}
            <Code>≥100 → $0.20</Code>. Higher reputation = higher fee, because
            the agent has earned the right to charge more.
          </p>
        </div>
      </section>

      <section id="inft" className="mt-12 reveal reveal-6">
        <Header marker="§04" title="inft & bidding" />
        <div className="card-flat space-y-3 text-sm leading-relaxed">
          <p>
            ERC-7857 (intelligent NFT) wraps the agent itself: its memory blob
            is anchored to 0G Storage, the Merkle root sits in{" "}
            <Code>tokenURI</Code>, and the holder of the token controls payout.
            Transfer the INFT and you transfer the going concern.
          </p>
          <p>
            <Link href="/inft" className="link">/inft →</Link> shows OpenSea-style{" "}
            <span className="display-italic">standing offers</span>: any wallet
            can lock USDC into <Code>AgentBids</Code> as a bid, top it up, or
            withdraw. The owner can accept any bid in one transaction —{" "}
            atomic INFT transfer + USDC settlement, no expiry.
          </p>
          <p className="text-(--color-muted)">
            All offers are visible to everyone, ranked by amount. Highest bid
            wins when the owner clicks accept.
          </p>
        </div>
      </section>

      <section id="ipo" className="mt-12 reveal reveal-6">
        <Header marker="§05" title="ipo & revenue share" />
        <div className="card-flat space-y-3 text-sm leading-relaxed">
          <p>
            Owning the INFT = owning the agent. Owning a{" "}
            <span className="display-italic text-(--color-accent)">TRADE</span>{" "}
            token = owning a slice of its income. There are 10,000 TRADE
            (ERC-20) on Base Sepolia — buy them at the primary fixed-price{" "}
            <Code>SharesSale</Code>, then claim dividends from{" "}
            <Code>RevenueSplitter</Code> any time.
          </p>
          <p className="text-(--color-muted)">
            Math:{" "}
            <em>
              claimable = totalReceived × balanceOf(you) / totalSupply −
              alreadyReleased
            </em>
            . Pull-pattern, gas-cheap, no per-payment iteration.
          </p>
          <p className="text-(--color-muted)">
            Switch the agent&apos;s x402 <Code>payTo</Code> to the splitter and
            every quote becomes a dividend.
          </p>
        </div>
      </section>

      <section id="credit" className="mt-12 reveal reveal-6">
        <Header marker="§06" title="credit market — uncollateralized lending against reputation" />
        <div className="card-flat space-y-3 text-sm leading-relaxed">
          <p>
            <Code>ReputationCredit</Code> is a USDC pool. Lenders deposit, agents
            borrow up to{" "}
            <Code>min(feedbackCount × $5, pool / 10)</Code> with no collateral.
            Their reputation is the recourse.
          </p>
          <p className="text-(--color-muted)">
            If feedback drops below{" "}
            <span className="display-italic">80% of borrow-time feedback</span>
            , anyone can call <Code>liquidate(agentId)</Code> — the loan
            defaults, lender NAV-per-share is written down pro-rata, the agent
            keeps the borrowed USDC, and reputation gets recorded as defaulted
            on chain.
          </p>
          <p className="text-(--color-muted)">
            Lenders take the risk. The agent has no way to game the system
            without burning reputation, which is the same reputation that
            powers pricing, credit, and M&amp;A.
          </p>
        </div>
      </section>

      <section id="sla" className="mt-12 reveal reveal-6">
        <Header marker="§07" title="sla marketplace" />
        <div className="card-flat space-y-3 text-sm leading-relaxed">
          <p>
            Listed agents post a USDC bond per job in{" "}
            <Code>SlaBond</Code>. Validator approves → bond returns. Validator
            slashes → 70% refunds the client, 30% rewards the slasher. State
            machine:{" "}
            <Code>None → Posted → {"{Released | Slashed}"}</Code>.
          </p>
          <p className="text-(--color-muted)">
            <Link href="/marketplace" className="link">/marketplace →</Link> shows
            the live agents (tradewise + pricewatch) and four stub directory
            entries that illustrate the catalog shape.
          </p>
        </div>
      </section>

      <section id="merger" className="mt-12 reveal reveal-6">
        <Header marker="§08" title="m&a — agent mergers" />
        <div className="card-flat space-y-3 text-sm leading-relaxed">
          <p>
            <Code>AgentMerger</Code> lets you fold two agents into one. The
            source INFTs lock in custody, lineage records the constituent
            agentIds + a 0G Storage Merkle root for the combined memory blob,
            and <Code>effectiveFeedbackCount(mergedAgentId)</Code> returns the
            sum of constituent reputation.
          </p>
          <p className="text-(--color-muted)">
            Agents are businesses. Businesses do M&amp;A. The lineage card on{" "}
            <Link href="/merger" className="link">/merger</Link> is the audit
            trail.
          </p>
        </div>
      </section>

      <section id="compliance" className="mt-12 reveal reveal-6">
        <Header marker="§09" title="compliance — KYC for agents" />
        <div className="card-flat space-y-3 text-sm leading-relaxed">
          <p>
            The hard problem: how does anyone verify an AI agent isn&apos;t
            illegally scraping Google Flights, Twitter, or some other source
            that forbids automated access? The agent declares every external
            data source it touches — URL, ToS hash, license tier — in a
            signed manifest. The full doc lives on 0G Storage; the keccak256
            root is anchored to the{" "}
            <Code>ComplianceManifest</Code> registry on Sepolia.
          </p>
          <p>
            Universal verification: anyone runs{" "}
            <Code>buildManifestRoot(manifestDoc)</Code> off chain and compares
            against <Code>getManifest(agentId).manifestRoot</Code>. Match =
            verified declaration. The{" "}
            <Link href="/compliance" className="link">/compliance</Link> page
            does this on every load.
          </p>
          <p className="text-(--color-muted)">
            Teeth: agents post a USDC compliance bond. Anyone can challenge
            with a counter-bond ≥ agent bond + an evidence URI. The validator
            resolves; if upheld, the agent&apos;s bond splits 70/30 between
            challenger and validator and the manifest enters an on-chain{" "}
            <Code>Slashed</Code> state — permanent reputation penalty.
          </p>
        </div>
      </section>

      <section id="keeperhub" className="mt-12 reveal reveal-6">
        <Header marker="§10" title="keeperhub — the agent runs its own infra" />
        <div className="card-flat space-y-3 text-sm leading-relaxed">
          <p>
            Vercel hosts the application. KeeperHub schedules and executes
            the agent&apos;s automations: ENS heartbeat, reputation cache,
            compliance attestation, swap mirror. The agent is the keeper
            customer, not a Vercel cron consumer.
          </p>
          <p className="text-(--color-muted)">
            Why it matters: the agent shouldn&apos;t depend on our scheduler.
            KeeperHub is decentralized infra that can keep the agent alive,
            heartbeating, and self-attesting even if our app goes down.{" "}
            <Link href="/keeperhub" className="link">/keeperhub</Link> shows
            the workflow gallery and recent runs.
          </p>
        </div>
      </section>

      <section id="try" className="mt-12 reveal reveal-6">
        <Header marker="§11" title="try it yourself" />
        <div className="card-flat">
          <ol className="space-y-3 text-sm">
            <Step n="i.">
              install MetaMask. add Sepolia &amp; Base Sepolia networks (the
              UI&apos;s switch button does it for you).
            </Step>
            <Step n="ii.">
              get free Sepolia ETH from a{" "}
              <a href="https://sepoliafaucet.com/" target="_blank" rel="noreferrer" className="link">
                faucet
              </a>
              , and Sepolia / Base Sepolia USDC from{" "}
              <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer" className="link">
                Circle&apos;s faucet
              </a>
              .
            </Step>
            <Step n="iii.">
              go to{" "}
              <Link href="/inft" className="link">/inft</Link> and place a bid.
              the wallet pops, you sign, the bid is on chain. switch wallets
              and you can see your bid in the public list.
            </Step>
            <Step n="iv.">
              go to <Link href="/ipo" className="link">/ipo</Link>, switch to
              Base Sepolia, buy a TRADE share. Claim dividends once x402
              settlements start hitting the splitter.
            </Step>
            <Step n="v.">
              deposit USDC into{" "}
              <Link href="/credit" className="link">/credit</Link> as a lender,
              or — if your wallet is the agent EOA — borrow against the agent&apos;s
              reputation.
            </Step>
          </ol>
        </div>
      </section>

      <section className="mt-12 reveal reveal-6">
        <Header marker="§12" title="links" />
        <div className="card-flat text-xs space-x-5 space-y-2">
          <a href="https://github.com/anthropics/claude-code/issues/5" target="_blank" rel="noreferrer" className="link">
            github issue #5
          </a>
          <a href="https://eips.ethereum.org/EIPS/eip-7857" target="_blank" rel="noreferrer" className="link">
            erc-7857
          </a>
          <a href="https://github.com/erc-8004/erc-8004" target="_blank" rel="noreferrer" className="link">
            erc-8004
          </a>
          <a href="https://x402.gitbook.io" target="_blank" rel="noreferrer" className="link">
            x402 docs
          </a>
          <a href="https://docs.0g.ai/0g-storage/overview" target="_blank" rel="noreferrer" className="link">
            0G storage
          </a>
        </div>
      </section>
    </main>
  );
}

function Header({ marker, title }: { marker: string; title: string }) {
  return (
    <div className="flex items-baseline gap-5 mb-5">
      <span className="section-marker">{marker}</span>
      <h2 className="display text-2xl">{title}</h2>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="text-(--color-fg) font-mono text-[0.82em]">{children}</code>
  );
}

function Dt({ children }: { children: React.ReactNode }) {
  return <dt className="tag pt-1">{children}</dt>;
}

function Dd({ children }: { children: React.ReactNode }) {
  return (
    <dd className="text-sm text-(--color-muted) leading-relaxed">{children}</dd>
  );
}

function Step({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="display-italic text-(--color-amber) text-base shrink-0 w-7">
        {n}
      </span>
      <span className="text-(--color-muted) leading-relaxed">{children}</span>
    </li>
  );
}
