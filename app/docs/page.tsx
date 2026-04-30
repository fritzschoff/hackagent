import Link from "next/link";
import SiteNav from "@/components/site-nav";

export const revalidate = 3600;

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 md:px-10 pb-24">
      <SiteNav active="docs" />
      <header className="pt-6 pb-10 border-b-2 border-(--color-fg) reveal reveal-1">
        <p className="tag mb-2">guide · for judges &amp; explorers</p>
        <h1 className="display text-[clamp(2.25rem,6vw,4rem)] leading-[0.95] tracking-tight">
          how it works{" "}
          <span className="display-italic font-light text-(--color-muted)">
            / docs
          </span>
        </h1>
        <p className="mt-3 text-sm max-w-2xl text-(--color-muted)">
          tradewise.agentlab.eth is a fully autonomous on-chain agent. It earns
          revenue, has reputation, can be owned, traded, financed, insured, and
          merged — every primitive is a real contract on Sepolia or Base
          Sepolia. This page is the map. <span className="display-italic">FAQ above</span>,{" "}
          <span className="display-italic">deep architecture below</span>.
        </p>
      </header>

      <nav className="mt-10 reveal reveal-2 flex flex-wrap gap-x-6 gap-y-2 text-xs">
        <span className="text-(--color-muted) tag">faq:</span>
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
      <nav className="mt-3 reveal reveal-2 flex flex-wrap gap-x-6 gap-y-2 text-xs">
        <span className="text-(--color-muted) tag">w1 inft:</span>
        <a href="#arch-overview" className="link">system overview</a>
        <a href="#arch-inft" className="link">erc-7857 oracle</a>
        <a href="#arch-transfer" className="link">transfer flow</a>
        <a href="#arch-stale" className="link">stale memory</a>
        <a href="#arch-merger-deep" className="link">merger flow</a>
        <a href="#arch-trust" className="link">trust model</a>
        <a href="#arch-stack" className="link">tech stack</a>
      </nav>
      <nav className="mt-3 reveal reveal-2 flex flex-wrap gap-x-6 gap-y-2 text-xs">
        <span className="text-(--color-muted) tag">w2 ens:</span>
        <a href="#arch-w2" className="link">ccip-read gateway</a>
        <a href="#arch-w2-flow" className="link">resolve flow</a>
        <a href="#arch-w2-records" className="link">live records</a>
      </nav>
      <nav className="mt-3 reveal reveal-2 flex flex-wrap gap-x-6 gap-y-2 text-xs">
        <span className="text-(--color-muted) tag">w3 names + keeperhub:</span>
        <a href="#arch-w3-names" className="link">primary names</a>
        <a href="#arch-w3-keeperhub" className="link">keeperhub workflows</a>
      </nav>
      <nav className="mt-3 reveal reveal-2 flex flex-wrap gap-x-6 gap-y-2 text-xs">
        <span className="text-(--color-muted) tag">all:</span>
        <a href="#arch-contracts" className="link">contract addresses</a>
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
              <a href="https://portal.cdp.coinbase.com/products/faucet" target="_blank" rel="noreferrer" className="link">
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
          <a href="https://github.com/fritzschoff/hackagent" target="_blank" rel="noreferrer" className="link">
            github repo
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

      {/* ────────────────────────────────────────────────────────────────── */}
      {/*                  DEEP DIVE — for judges                             */}
      {/* ────────────────────────────────────────────────────────────────── */}

      <div className="mt-20 pt-10 border-t-2 border-(--color-fg) reveal reveal-1">
        <p className="tag mb-2">deep dive</p>
        <h2 className="display text-[clamp(1.75rem,5vw,3rem)] leading-[0.95] tracking-tight">
          how everything actually works{" "}
          <span className="display-italic font-light text-(--color-muted)">
            / for judges
          </span>
        </h2>
        <p className="mt-3 text-sm max-w-2xl text-(--color-muted)">
          The FAQ above is the user manual. This is the systems doc — every
          contract, every off-chain service, every cryptographic envelope, the
          actual byte layout of the proof bytes. If you&apos;re evaluating
          this for a hackathon prize, read this section.
        </p>
      </div>

      <section id="arch-overview" className="mt-12 reveal reveal-2">
        <Header marker="∇01" title="system overview — what's running where" />
        <div className="card-flat space-y-4 text-sm leading-relaxed">
          <p>
            tradewise is a single web app on Vercel that talks to{" "}
            <em>seven</em> on-chain contract systems across two chains, plus
            three off-chain services. The architecture is meant to maximize the
            surface area where the agent acts as a real autonomous business —
            not just &quot;an LLM with a wallet.&quot;
          </p>
          <pre className="overflow-x-auto bg-(--color-bg-soft) p-4 rounded text-[11px] font-mono leading-snug">
{`         ┌──────────────────────────────────────────┐
         │           agentlab.eth dashboard         │
         │           (Next.js 16 on Vercel)         │
         └──────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
 ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
 │   SEPOLIA    │     │ BASE SEPOLIA │     │ 0G  GALILEO  │
 │  (identity)  │     │ (settlement) │     │  (storage +  │
 │              │     │              │     │   compute)   │
 │ • V2-b       │     │ • TRADE ERC20│     │ • Memory     │
 │ • Verifier   │     │ • SharesSale │     │   ciphertext │
 │ • INFT       │     │ • Splitter   │     │ • TEE LLM    │
 │ • Bids       │     │ • x402 USDC  │     │   inference  │
 │ • Merger     │     │              │     │              │
 │ • Reputation │     │              │     │              │
 │ • Credit     │     │              │     │              │
 │ • SLA        │     │              │     │              │
 │ • Compliance │     │              │     │              │
 └──────────────┘     └──────────────┘     └──────────────┘
        ▲                     ▲                     ▲
        │ contract calls      │ x402 settlement     │ anchor + indexer
        │                     │                     │
 ┌──────┴─────────────────────┴─────────────────────┴──────┐
 │              Vercel Functions  (Fluid Compute)          │
 │  ────────────────────────────────────────────────────   │
 │  /api/inft/oracle/*    INFT oracle — memory encryption  │
 │  /api/inft/transfer/*  user-facing rate-limited proxy   │
 │  /api/a2a/jobs         x402 paid quote endpoint         │
 │  /api/keeperhub/*      KeeperHub workflow webhooks      │
 └─────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
         ┌──────────────┐            ┌──────────────┐
         │   Upstash    │            │  KeeperHub   │
         │    Redis     │            │  (Turnkey +  │
         │   (oracle    │            │   workflows) │
         │   AES keys)  │            │              │
         └──────────────┘            └──────────────┘`}
          </pre>
          <p className="text-(--color-muted)">
            Two chains: <Code>11155111</Code> (Sepolia, identity-side){" "}
            and <Code>84532</Code> (Base Sepolia, settlement). Plus 0G Galileo{" "}
            <Code>16602</Code> for the encrypted memory blobs and TEE-attested
            inference.
          </p>
        </div>
      </section>

      <section id="arch-inft" className="mt-12 reveal reveal-3">
        <Header marker="∇02" title="erc-7857 with the missing piece — the oracle" />
        <div className="card-flat space-y-4 text-sm leading-relaxed">
          <p>
            <strong>The problem.</strong> ERC-7857 says: when an INFT
            transfers, the encrypted memory blob is re-encrypted to the new
            owner. Every public ERC-7857 demo we&apos;ve seen stops at the
            metadata schema. 0G&apos;s own reference verifier (the canonical
            implementation) leaves a literal{" "}
            <Code>// TODO: verify TEE&apos;s signature</Code> in its
            transfer-validity verifier and deploys with an empty oracle
            counterpart (the{" "}
            <a
              href="https://github.com/0gfoundation/0g-inft-oracle-server-ts"
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              0g-inft-oracle-server-ts
            </a>{" "}
            repo is a placeholder).
          </p>
          <p>
            <strong>What we ship.</strong> A full ERC-7857 transfer pipeline:
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-(--color-muted)">
            <li>
              <strong>AgentINFTVerifier</strong> on Sepolia. Implements 0G&apos;s{" "}
              <Code>IERC7857DataVerifier</Code> with the byte layout from their
              reference (plus a 32-byte tokenId field we added at offset 1 since
              the verifier&apos;s interface only sees{" "}
              <Code>bytes[]</Code>). <em>Adds</em> the on-chain oracle
              attestation check the reference left as TODO.
            </li>
            <li>
              <strong>AgentINFT</strong> with a new{" "}
              <Code>transferWithProof(to, tokenId, proof)</Code> entry point,
              an EIP-712 delegation table that lets bidders pre-authorize the
              oracle to act as their receiver-proxy, and a{" "}
              <Code>memoryReencrypted</Code> stale flag for raw{" "}
              <Code>transferFrom</Code> bypasses.
            </li>
            <li>
              <strong>Oracle service</strong> (Vercel functions). Holds
              per-token AES-128 keys in Redis (KEK-derived from the oracle
              private key via HKDF). On every transfer it: decrypts the current
              blob, generates a fresh AES key, re-encrypts the same plaintext,
              anchors the new ciphertext to 0G Storage, ECIES-wraps the new
              key to the buyer&apos;s pubkey, and signs a 65-byte attestation
              the on-chain verifier checks via{" "}
              <Code>ecrecover</Code>.
            </li>
          </ol>
          <p className="text-(--color-muted)">
            <strong>Trust posture.</strong> Same as 0G&apos;s reference (an
            EOA-signing oracle) but we actually <em>verify</em> the signature
            on-chain. Hardware-attested swap-in is a one-line change: replace
            the oracle pubkey in the verifier&apos;s constructor with a
            TEE-bound key. The contract surface is identical.
          </p>
        </div>
      </section>

      <section id="arch-transfer" className="mt-12 reveal reveal-3">
        <Header marker="∇03" title="proof byte layout & transfer flow" />
        <div className="card-flat space-y-4 text-sm leading-relaxed">
          <p>
            Every transfer carries a{" "}
            <span className="display-italic">single calldata blob</span>{" "}
            containing the entire re-encryption proof. The verifier parses it
            via assembly, recovers two ECDSA signatures (receiver + oracle),
            and checks a replay-protection nonce.
          </p>
          <p className="text-xs text-(--color-muted) tag mb-2">
            transfer proof byte layout — private TEE flavor (~423B + uri length)
          </p>
          <div className="overflow-x-auto bg-(--color-bg-soft) p-4 rounded">
            <table className="w-full text-[11px] font-mono">
              <thead className="text-(--color-muted) text-left">
                <tr>
                  <th className="pb-2 pr-4 font-normal">offset</th>
                  <th className="pb-2 pr-4 font-normal">field</th>
                  <th className="pb-2 font-normal">contents</th>
                </tr>
              </thead>
              <tbody>
                <ByteRow off="[0]" field="flags" desc="0x40 (bit 6 isPrivate=1, bit 7 TEE=0)" />
                <ByteRow off="[1..33)" field="tokenId (uint256)" desc="binds the proof to a specific INFT" />
                <ByteRow off="[33..98)" field="accessibility sig (65B)" desc="ECDSA over keccak(newRoot ‖ oldRoot ‖ nonce), EIP-191 prefixed. Recovers to receiver directly (live) or oracle (delegation path)." />
                <ByteRow off="[98..146)" field="nonce (48B)" desc="replay-protection key" />
                <ByteRow off="[146..178)" field="newDataHash" desc="0G Storage Merkle root of new ciphertext" />
                <ByteRow off="[178..210)" field="oldDataHash" desc="asserts proof binds to current state" />
                <ByteRow off="[210..226)" field="sealedKey (16B)" desc="first 16B of ECIES ciphertext" />
                <ByteRow off="[226..259)" field="ephemeralPubkey (33B)" desc="compressed secp256k1 (key-wrap context)" />
                <ByteRow off="[259..271)" field="ivWrap (12B)" desc="AES-GCM IV for the key wrap" />
                <ByteRow off="[271..287)" field="wrapTag (16B)" desc="AES-GCM auth tag for the key wrap" />
                <ByteRow off="[287..289)" field="uriLen (uint16 BE)" desc="length of newUri" />
                <ByteRow off="[289..289+L)" field="newUri (UTF-8)" desc="og://<root> pointer" />
                <ByteRow off="[289+L..)" field="oracleAttestation (65B)" desc="ECDSA over keccak(tokenId ‖ oldHash ‖ newHash ‖ sealedKey ‖ keccak(uri) ‖ nonce), EIP-191 prefixed. Recovers to the configured oracle pubkey." />
              </tbody>
            </table>
          </div>
          <p>
            <strong>Accept-bid sequence (3 wallet steps + 2 oracle calls):</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-(--color-muted)">
            <li>
              Bidder pre-authorizes the oracle as receiver-proxy via an EIP-712{" "}
              <Code>Delegation</Code> signature, stored on-chain in{" "}
              <Code>AgentINFT.delegations[bidder][tokenId]</Code>.{" "}
              <Code>AgentBids.placeBid</Code> bundles the delegation forward
              and the USDC escrow into one transaction.
            </li>
            <li>
              Seller clicks accept. Frontend calls{" "}
              <Code>/api/inft/transfer/prepare</Code>. Oracle decrypts current
              blob (Redis-stored AES-128 key), rotates to a fresh K_new,
              encrypts the same plaintext, anchors to 0G Storage, builds the
              proof bytes above. <em>Does not</em> rotate the Redis key yet —
              proof is returned to the frontend.
            </li>
            <li>
              Seller signs <Code>BIDS.acceptBid(tokenId, bidder, proof)</Code>.
              The contract checks the bid, calls{" "}
              <Code>INFT.transferWithProof</Code>, the verifier validates the
              proof, the INFT updates{" "}
              <Code>encryptedMemoryRoot[tokenId] = newRoot</Code>, ERC-721
              transfer happens atomically, USDC pays out to the seller. Single
              tx.
            </li>
            <li>
              Frontend POSTs <Code>/api/inft/transfer/confirm</Code>. Oracle
              waits for tx receipt, parses the{" "}
              <Code>Transferred</Code> event, then{" "}
              <em>commits</em> the rotated key in Redis. Two-phase commit
              prevents key rotation if the chain tx never lands.
            </li>
            <li>
              <em>Optional</em>: new owner clicks reveal. Wallet signs an
              EIP-191 message,{" "}
              <Code>/api/inft/transfer/reveal</Code> verifies ownership against
              the on-chain <Code>ownerOf</Code>, decrypts with the new K, and
              returns the plaintext memory blob.
            </li>
          </ol>
        </div>
      </section>

      <section id="arch-stale" className="mt-12 reveal reveal-3">
        <Header marker="∇04" title="stale memory — why raw transferFrom is intentionally weird" />
        <div className="card-flat space-y-3 text-sm leading-relaxed">
          <p>
            ERC-7857 wants every transfer to carry re-encryption. ERC-721
            marketplaces (OpenSea etc.) call{" "}
            <Code>safeTransferFrom</Code> directly. We compromise: raw{" "}
            <Code>transferFrom</Code> still works, but flips{" "}
            <Code>memoryReencrypted[tokenId] = false</Code> and emits{" "}
            <Code>MemoryStaled</Code>. The new owner gets the token but
            cannot decrypt the memory.
          </p>
          <p className="text-(--color-muted)">
            The <Link href="/inft" className="link">/inft</Link> page renders a
            red &quot;memory is stale&quot; badge when the flag is false. This
            is a feature, not a bug — it demonstrates exactly{" "}
            <em>why</em> the proof path matters, side-by-side with the proof
            path&apos;s green &quot;rotations: N&quot; counter.
          </p>
          <p className="text-(--color-muted)">
            Recovery: previous owner can volunteer the AES key off-chain, or
            transfer the INFT back via <Code>transferWithProof</Code> (which
            re-rotates the key under the original owner).
          </p>
        </div>
      </section>

      <section id="arch-merger-deep" className="mt-12 reveal reveal-3">
        <Header marker="∇05" title="merger — dual proofs, custody, lineage" />
        <div className="card-flat space-y-3 text-sm leading-relaxed">
          <p>
            <Code>AgentMerger.recordMerge(...)</Code> takes proofs for both
            source tokens. The merged-agent owner pre-authorizes the oracle to
            act as receiver-proxy <em>for the merger contract</em> (which has
            no key) via{" "}
            <Code>setDelegationByOwner(MERGER, tokenId, oracle, expiresAt)</Code>{" "}
            — owner&apos;s tx is the authorization, no signature needed since
            the receiver is a contract.
          </p>
          <p className="text-(--color-muted)">
            Oracle prepare-merge: decrypts both source blobs, encrypts the
            combined memory under a fresh K_m, anchors once, builds two proofs
            (both with <Code>newDataHash = mergedRoot</Code>). The merger
            contract calls <Code>transferWithProof</Code> twice, source tokens
            land in custody, lineage stored on chain, merged agent inherits{" "}
            <Code>effectiveFeedbackCount = sum of constituents</Code>.
          </p>
        </div>
      </section>

      <section id="arch-trust" className="mt-12 reveal reveal-3">
        <Header marker="∇06" title="trust model & cryptographic primitives" />
        <div className="card-flat space-y-4 text-sm leading-relaxed">
          <table className="text-xs w-full">
            <thead className="text-(--color-muted) text-left">
              <tr>
                <th className="pb-2 pr-4">layer</th>
                <th className="pb-2 pr-4">algorithm</th>
                <th className="pb-2">why</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              <tr className="border-t border-(--color-border)">
                <td className="py-2 pr-4">Memory blob</td>
                <td className="py-2 pr-4">AES-128-GCM</td>
                <td className="py-2 text-(--color-muted)">
                  matches <Code>bytes16 sealedKey</Code> in 0G reference
                </td>
              </tr>
              <tr className="border-t border-(--color-border)">
                <td className="py-2 pr-4">Key wrap</td>
                <td className="py-2 pr-4">ECIES-secp256k1 + HKDF + AES-128-GCM</td>
                <td className="py-2 text-(--color-muted)">
                  bidder pubkey recoverable from delegation sig — no extra
                  registration
                </td>
              </tr>
              <tr className="border-t border-(--color-border)">
                <td className="py-2 pr-4">Oracle attestation</td>
                <td className="py-2 pr-4">secp256k1 ECDSA + EIP-191</td>
                <td className="py-2 text-(--color-muted)">
                  on-chain <Code>ecrecover</Code> against pinned oracle pubkey
                </td>
              </tr>
              <tr className="border-t border-(--color-border)">
                <td className="py-2 pr-4">KEK at rest</td>
                <td className="py-2 pr-4">AES-256-GCM, per-token HKDF</td>
                <td className="py-2 text-(--color-muted)">
                  <Code>HKDF(oracle_sk, salt=&quot;inft-kek-v1&quot;,
                  info=tokenId)</Code> isolates compromise
                </td>
              </tr>
              <tr className="border-t border-(--color-border)">
                <td className="py-2 pr-4">Replay protection</td>
                <td className="py-2 pr-4">48-byte nonces, on-chain map</td>
                <td className="py-2 text-(--color-muted)">
                  shared between mint and transfer paths; cross-path replay is
                  impossible because the oracle signs path-specific preimages
                </td>
              </tr>
            </tbody>
          </table>
          <p className="text-(--color-muted) leading-relaxed">
            <strong>Single trust anchor:</strong> the oracle&apos;s secp256k1
            private key. Compromise = an attacker can mint forged transfer
            proofs, but only for INFTs they already own (the verifier checks
            old root binds to current state, which only the legitimate owner
            controls). The <em>blast radius</em> is limited to the oracle&apos;s
            signing power, not the AES keys (which require Redis breach AND
            KEK derivation).
          </p>
        </div>
      </section>

      <section id="arch-stack" className="mt-12 reveal reveal-3">
        <Header marker="∇07" title="tech stack — what each thing actually is" />
        <div className="card-flat text-sm leading-relaxed">
          <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-y-4">
            <Dt>Solidity</Dt>
            <Dd>
              <Code>0.8.28</Code> via Foundry. Uses transient storage (EIP-1153)
              for the proof-path flag in <Code>AgentINFT._update</Code>.
              OpenZeppelin v5 base contracts.
            </Dd>
            <Dt>Frontend</Dt>
            <Dd>
              Next.js 16 App Router on Vercel (Fluid Compute). All wallet
              interactions through viem. EIP-712 sign-typed-data for
              delegations.
            </Dd>
            <Dt>Oracle service</Dt>
            <Dd>
              Vercel functions under <Code>/api/inft/oracle/*</Code>. Pure
              TypeScript; secp256k1 + AES-GCM via{" "}
              <Code>@noble/curves</Code> and <Code>@noble/ciphers</Code> (no
              native deps). Redis-backed key store (Upstash).
            </Dd>
            <Dt>0G Storage</Dt>
            <Dd>
              <Code>@0glabs/0g-ts-sdk</Code> 0.3.3. Note: SDK&apos;s built-in{" "}
              <Code>submit</Code> reverts due to a contract upgrade after
              publish — we ship a custom Flow ABI bypass that computes the
              Merkle root locally, anchors via raw <Code>writeContract</Code>{" "}
              call, polls storage nodes for FileInfo, then re-enters the SDK
              with <Code>skipTx + finalityRequired:false</Code> to dispatch
              segments.
            </Dd>
            <Dt>0G Compute</Dt>
            <Dd>
              <Code>@0glabs/0g-serving-broker</Code>. Every paid x402 quote
              triggers a TEE-attested inference call (Qwen-2.5-7B); the
              <Code>ZG-Res-Key</Code> response header is processed via{" "}
              <Code>broker.inference.processResponse</Code> to confirm
              attestation.
            </Dd>
            <Dt>x402</Dt>
            <Dd>
              <Code>@x402/next</Code> middleware wraps the agent&apos;s quote
              endpoint. Hosted facilitator at{" "}
              <Code>facilitator.x402.rs</Code> handles USDC settlement on Base
              Sepolia (we pay zero gas).
            </Dd>
            <Dt>KeeperHub</Dt>
            <Dd>
              MCP-driven workflows. Webhook-triggered (not cron). Existing
              workflows: heartbeat, reputation cache, swap mirror, compliance
              attest. Future workflows in W3 spec.
            </Dd>
          </dl>
        </div>
      </section>

      {/* ────────────── W2 ENS gateway sections ────────────── */}

      <section id="arch-w2" className="mt-12 reveal reveal-3">
        <Header marker="∇09" title="w2 — ccip-read ens gateway" />
        <div className="card-flat space-y-4 text-sm leading-relaxed">
          <p>
            Before W2: every <Code>last-seen-at</Code> heartbeat,{" "}
            <Code>reputation-summary</Code>, and dynamic ENS text record was
            a real <Code>setText</Code> tx burning Sepolia gas. After W2: a
            single <Code>OffchainResolver</Code> contract reverts every{" "}
            <Code>resolve()</Code> call with EIP-3668{" "}
            <Code>OffchainLookup</Code>, viem/wagmi clients follow it
            transparently, and our Vercel gateway computes record values
            live (Redis + on-chain reads + Edge Config), signs the response
            with <Code>INFT_GATEWAY_PK</Code>, and{" "}
            <Code>resolveWithProof</Code> verifies the sig with{" "}
            <Code>ecrecover</Code> on chain. <strong>Zero gas per read.</strong>
          </p>
          <p className="text-(--color-muted)">
            ENSIP-10 wildcard: a single resolver at the parent{" "}
            <Code>agentlab.eth</Code> serves every <Code>*.agentlab.eth</Code>
            and every nested <Code>*.*.agentlab.eth</Code>. New agents get
            ENS records for free with no per-name registration.
          </p>
          <p className="text-(--color-muted)">
            <strong>Trust posture (W2-α):</strong> gateway is an EOA we sign
            with. Compromise ⇒ malicious resolution. Worst case is stale
            telemetry, never falsified ownership (ownership stays in the L1
            registry, the resolver doesn&apos;t override it). Future swap to
            W2-β (storage-proof verifier) replaces only the
            <Code>resolveWithProof</Code> body — no API change.
          </p>
        </div>
      </section>

      <section id="arch-w2-flow" className="mt-12 reveal reveal-3">
        <Header marker="∇10" title="resolve flow — what happens when you query an ens text record" />
        <div className="card-flat space-y-3 text-sm leading-relaxed">
          <pre className="overflow-x-auto bg-(--color-bg-soft) p-4 rounded text-[11px] font-mono leading-snug">
{`wallet / dApp                viem.getEnsText({ name, key })
       │
       │  1. eth_call resolve(name, data) on agentlab.eth's resolver
       ▼
OffchainResolver (Sepolia)   reverts: OffchainLookup(this, [gatewayURL],
       │                              callData, callbackFn, extraData)
       │
       │  2. viem auto-handles the revert (EIP-3668)
       │     GET https://hackagent-nine.vercel.app/api/ens-gateway/{sender}/{data}.json
       ▼
gateway HTTP route           - ABI-decode (name, data)
                             - parse selector: text / addr / ...
                             - compute value: Redis + chain + Edge Config
                             - sign: keccak256(0x1900 || resolver || expires
                                              || keccak(extraData) || keccak(result))
                             - returns: { data: encode(expires, result, sig) }
       │
       │  3. viem calls back: resolveWithProof(response, extraData)
       ▼
OffchainResolver.resolveWithProof
                             - check expires > now
                             - ecrecover sig === expectedGatewaySigner
                             - return result bytes
       │
       │  4. viem decodes: { string } or { bytes }
       ▼
caller receives the value`}
          </pre>
        </div>
      </section>

      <section id="arch-w2-records" className="mt-12 reveal reveal-3">
        <Header marker="∇11" title="live records served by the gateway" />
        <div className="card-flat text-sm leading-relaxed">
          <table className="w-full text-xs mt-2">
            <thead className="text-(--color-muted) text-left">
              <tr>
                <th className="pb-2 pr-4 font-normal">key</th>
                <th className="pb-2 pr-4 font-normal">source</th>
                <th className="pb-2 font-normal">cross-link</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              <RecordRow keyName="last-seen-at" source="Redis agent:1:last-seen" link="W3 KeeperHub heartbeat-pulse" />
              <RecordRow keyName="reputation-summary" source="Redis with on-chain ReputationRegistry.feedbackCount fallback" link="W3 KeeperHub reputation-pulse" />
              <RecordRow keyName="outstanding-bids" source="On-chain AgentBids.biddersCount(tokenId)" link="W1 contract" />
              <RecordRow keyName="inft-tradeable" source="On-chain AgentINFT.memoryReencrypted(tokenId)" link="W1 — '1' fresh, '0' stale" />
              <RecordRow keyName="memory-rotations" source="Redis inft:meta:1:rotations" link="W1 oracle" />
              <RecordRow keyName="avatar" source="computed: eip155:11155111/erc721:<INFT>/<tokenId>" link="W1 INFT" />
              <RecordRow keyName="addr" source="WALLET_LABELS map (forward resolution)" link="W3 nested wallet labels" />
              <RecordRow keyName="agent-card / description / url" source="Edge Config (static)" link="—" />
            </tbody>
          </table>
          <p className="mt-4 text-(--color-muted)">
            The <Link href="/ens-debug" className="link">/ens-debug</Link> page lets you
            type any (name, key) pair and watch the gateway resolve it
            live, latency included. Try{" "}
            <Code>tradewise.agentlab.eth</Code> /{" "}
            <Code>memory-rotations</Code> — the count goes up after every
            successful <Code>transferWithProof</Code> on Sepolia.
          </p>
        </div>
      </section>

      {/* ────────────── W3 primary names + keeperhub sections ────────────── */}

      <section id="arch-w3-names" className="mt-12 reveal reveal-3">
        <Header marker="∇12" title="w3 — ensip-19 multichain primary names" />
        <div className="card-flat space-y-3 text-sm leading-relaxed">
          <p>
            Every wallet we own gets a primary name on Sepolia. Etherscan,
            MetaMask, and any wallet UI that does ENS reverse resolution
            shows the name instead of hex.
          </p>
          <table className="text-xs w-full">
            <thead className="text-(--color-muted) text-left">
              <tr>
                <th className="pb-2 pr-4 font-normal">role</th>
                <th className="pb-2 pr-4 font-normal">address</th>
                <th className="pb-2 font-normal">ens reverse name</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              <NameRow role="agent EOA" addr="0x7a83…20A3" name="agent-eoa.tradewise.agentlab.eth" />
              <NameRow role="pricewatch deployer" addr="0xBf5d…2469" name="pricewatch-deployer.agentlab.eth" />
              <NameRow role="validator" addr="0x0134…83F6" name="validator.agentlab.eth" />
              <NameRow role="keeperhub turnkey" addr="0xB28c…6539" name="keeperhub.agentlab.eth" />
            </tbody>
          </table>
          <p className="text-(--color-muted)">
            Forward <Code>addr(label)</Code> resolution is handled
            dynamically by the W2 gateway — we never wrote forward records
            on chain. Reverse records are set via the canonical Sepolia
            ReverseRegistrar (<Code>0xA0a1…C0C6</Code>); each wallet pays
            its own gas for the one-time <Code>setName</Code> call. The
            Turnkey wallet uses KeeperHub&apos;s{" "}
            <Code>execute_contract_call</Code> to broadcast.
          </p>
        </div>
      </section>

      <section id="arch-w3-keeperhub" className="mt-12 reveal reveal-3">
        <Header marker="∇13" title="w3 — keeperhub orchestration" />
        <div className="card-flat space-y-4 text-sm leading-relaxed">
          <p>
            KeeperHub is the agent&apos;s automation layer. Every paid
            x402 quote fires a workflow; chain events fire workflows; the
            agent uses KeeperHub the same way a SaaS company uses Zapier.
          </p>
          <table className="text-xs w-full">
            <thead className="text-(--color-muted) text-left">
              <tr>
                <th className="pb-2 pr-4 font-normal">workflow</th>
                <th className="pb-2 pr-4 font-normal">trigger</th>
                <th className="pb-2 font-normal">action</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              <WfRow name="Heartbeat" trigger="paid x402 quote (debounced 5min)" action="webhook → Redis (agent:1:last-seen)" />
              <WfRow name="ReputationCache" trigger="paid x402 quote (debounced 5min)" action="webhook → Redis (reputation:summary:1)" />
              <WfRow name="Swap (existing)" trigger="paid x402 swap quote" action="Web3 Write Universal Router" />
              <WfRow name="ENSPrimaryNameSetter (new)" trigger="manual + onboarding" action="Web3 Write ReverseRegistrar.setName(label)" />
              <WfRow name="ENSAvatarSync (new)" trigger="INFT mint/transfer confirm-transfer" action="Web3 Write PublicResolver.setText(avatar)" />
              <WfRow name="GatewayCacheInvalidator (new)" trigger="INFT MemoryReencrypted/Staled" action="webhook → /api/ens-gateway/cache/invalidate" />
            </tbody>
          </table>
          <p className="text-(--color-muted)">
            <strong>Heartbeat + ReputationCache used to write to chain</strong>{" "}
            (<Code>setText</Code> on the ENS PublicResolver per quote, ~14k
            gas burned per fire). PR #13 swapped their <Code>Web3 Write</Code>
            nodes for <Code>Webhook POST</Code> nodes pointing at our app —
            same trigger, same KeeperHub run visibility, but writes Redis
            instead of chain. Workflows still appear on{" "}
            <Link href="/keeperhub" className="link">/keeperhub</Link> with
            green checkmarks; gas drain went from real to zero.
          </p>
          <p className="text-(--color-muted)">
            <strong>Cross-link:</strong>{" "}
            <Code>ENSAvatarSync</Code> and{" "}
            <Code>GatewayCacheInvalidator</Code> are triggered by the W1
            INFT oracle&apos;s <Code>/api/inft/oracle/confirm-transfer</Code>
            route the moment a <Code>transferWithProof</Code> tx is mined.
            Avatar gets re-pointed at the new tokenId; ENS gateway cache for
            <Code>memory-rotations</Code> et al. is purged so the next
            ENS query returns fresh values.
          </p>
        </div>
      </section>

      <section id="arch-contracts" className="mt-12 reveal reveal-3">
        <Header marker="∇14" title="contract addresses — full ledger" />
        <div className="card-flat text-xs font-mono space-y-2 overflow-x-auto">
          <p className="font-sans text-sm text-(--color-muted) mb-3">
            Deployed 2026-04-29 / 2026-04-30 as part of W1 + W2 + W3
            (issue #11 / spec
            2026-04-28-agent-identity-package-design.md).
          </p>
          <p className="font-sans text-xs text-(--color-muted) mt-2">w1 inft</p>
          <Row label="IdentityRegistryV2-b" addr="0xc456e7123BD79F96aDb590b97b9d0E2B0c2B09D5" />
          <Row label="AgentINFTVerifier   " addr="0x6D7a819022b41879D82a5FA035F71F8461a608d3" />
          <Row label="AgentINFT           " addr="0x103B2F28480c57ba49efeF50379Ef674d805DeDA" />
          <Row label="AgentBids           " addr="0x58C4F095474430314611D0784BeDF93bDB0b8453" />
          <Row label="AgentMerger         " addr="0x809cA3DB368a7d29DB98e0520688705D3eB413D1" />
          <Row label="INFT_ORACLE (off-chain signer)" addr="0x002d887C28cE85D9AB16BFaA26C670a8e0667A70" />
          <p className="font-sans text-xs text-(--color-muted) mt-4">w2 ens gateway</p>
          <Row label="OffchainResolver    " addr="0x4F956e6521A4B87b9f9b2D5ED191fB6134Bc8C17" />
          <Row label="INFT_GATEWAY (off-chain signer)" addr="0xe358F777daF973E64d0F9b2e73bc34e4C7F65c9b" />
          <Row label="ENS Registry (Sepolia)" addr="0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" />
          <p className="font-sans text-xs text-(--color-muted) mt-4">w3 wallets with primary names</p>
          <Row label="agent-eoa.tradewise.agentlab.eth" addr="0x7a83678e330a0C565e6272498FFDF421621820A3" />
          <Row label="pricewatch-deployer.agentlab.eth" addr="0xBf5df5c89b1eCa32C1E8AC7ECdd93d44F86F2469" />
          <Row label="validator.agentlab.eth" addr="0x01340D5A7A6995513C0C3EdF0367236e5b9C83F6" />
          <Row label="keeperhub.agentlab.eth (turnkey)" addr="0xB28cC07F397Af54c89b2Ff06b6c595F282856539" />
          <p className="font-sans text-xs text-(--color-muted) mt-4">misc</p>
          <Row label="USDC (Sepolia)      " addr="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" />
          <p className="font-sans text-sm text-(--color-muted) pt-3">
            Memory blob anchor for tokenId=1:{" "}
            <a
              href="https://storagescan-galileo.0g.ai/file/0x3ed1812bac1c7c1424b86c8d2ce307b4b6a018ff8e8bb7b70035f0b80eb35ec6"
              target="_blank"
              rel="noreferrer"
              className="link break-all"
            >
              0x3ed1812bac1c7c1424b86c8d2ce307b4b6a018ff8e8bb7b70035f0b80eb35ec6
            </a>
          </p>
        </div>
      </section>

      <section className="mt-12 mb-4 reveal reveal-3 text-xs text-(--color-muted) text-center">
        <p>
          source code:{" "}
          <a
            href="https://github.com/fritzschoff/hackagent"
            target="_blank"
            rel="noreferrer"
            className="link"
          >
            github.com/fritzschoff/hackagent
          </a>
        </p>
        <p className="mt-1">
          full design spec:{" "}
          <a
            href="https://github.com/fritzschoff/hackagent/blob/main/docs/superpowers/specs/2026-04-28-agent-identity-package-design.md"
            target="_blank"
            rel="noreferrer"
            className="link"
          >
            agent-identity-package-design.md
          </a>
        </p>
      </section>
    </main>
  );
}

function Row({ label, addr }: { label: string; addr: string }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      <span className="text-(--color-muted) shrink-0 w-44">{label}</span>
      <a
        href={`https://sepolia.etherscan.io/address/${addr}`}
        target="_blank"
        rel="noreferrer"
        className="link break-all"
      >
        {addr}
      </a>
    </div>
  );
}

function ByteRow({ off, field, desc }: { off: string; field: string; desc: string }) {
  return (
    <tr className="border-t border-(--color-border) align-top">
      <td className="py-2 pr-4 whitespace-nowrap text-(--color-fg)">{off}</td>
      <td className="py-2 pr-4 whitespace-nowrap text-(--color-fg)">{field}</td>
      <td className="py-2 text-(--color-muted)">{desc}</td>
    </tr>
  );
}

function RecordRow({ keyName, source, link }: { keyName: string; source: string; link: string }) {
  return (
    <tr className="border-t border-(--color-border) align-top">
      <td className="py-2 pr-4 whitespace-nowrap text-(--color-fg)">{keyName}</td>
      <td className="py-2 pr-4 text-(--color-muted)">{source}</td>
      <td className="py-2 text-(--color-muted)">{link}</td>
    </tr>
  );
}

function NameRow({ role, addr, name }: { role: string; addr: string; name: string }) {
  return (
    <tr className="border-t border-(--color-border) align-top">
      <td className="py-2 pr-4 whitespace-nowrap text-(--color-muted)">{role}</td>
      <td className="py-2 pr-4 whitespace-nowrap text-(--color-fg)">{addr}</td>
      <td className="py-2 text-(--color-fg)">{name}</td>
    </tr>
  );
}

function WfRow({ name, trigger, action }: { name: string; trigger: string; action: string }) {
  return (
    <tr className="border-t border-(--color-border) align-top">
      <td className="py-2 pr-4 whitespace-nowrap text-(--color-fg)">{name}</td>
      <td className="py-2 pr-4 text-(--color-muted)">{trigger}</td>
      <td className="py-2 text-(--color-muted)">{action}</td>
    </tr>
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
