"use client";

import { useState } from "react";
import SiteNav from "@/components/site-nav";

const NAMES = [
  {
    label: "tradewise.agentlab.eth",
    note: "the agent itself (W1 INFT cross-link)",
  },
  {
    label: "pricewatch.agentlab.eth",
    note: "the upstream price oracle agent",
  },
  {
    label: "agent-eoa.tradewise.agentlab.eth",
    note: "agent EOA wallet (W3 wildcard)",
  },
  {
    label: "pricewatch-deployer.agentlab.eth",
    note: "pricewatch deployer wallet (W3)",
  },
  {
    label: "validator.agentlab.eth",
    note: "validator wallet (W3)",
  },
  {
    label: "keeperhub.agentlab.eth",
    note: "keeperhub turnkey wallet (W3)",
  },
] as const;

const TEXT_KEYS = [
  { key: "last-seen-at", note: "Redis (KeeperHub heartbeat-pulse)" },
  { key: "memory-rotations", note: "Redis (W1 oracle, W2 cross-link)" },
  { key: "inft-tradeable", note: "AgentINFT.memoryReencrypted (W1)" },
  { key: "outstanding-bids", note: "AgentBids.biddersCount" },
  { key: "reputation-summary", note: "ReputationRegistry.feedbackCount" },
  { key: "avatar", note: "computed eip155:.../erc721:..." },
  { key: "agent-card", note: "Edge Config (static)" },
  { key: "description", note: "Edge Config (static)" },
  { key: "url", note: "Edge Config (static)" },
  { key: "addr", note: "forward resolution (returns 0x address)" },
] as const;

const KNOWN_REVERSE_ADDRS = [
  {
    addr: "0x7a83678e330a0C565e6272498FFDF421621820A3",
    expected: "agent-eoa.tradewise.agentlab.eth",
  },
  {
    addr: "0xBf5df5c89b1eCa32C1E8AC7ECdd93d44F86F2469",
    expected: "pricewatch-deployer.agentlab.eth",
  },
  {
    addr: "0x01340D5A7A6995513C0C3EdF0367236e5b9C83F6",
    expected: "validator.agentlab.eth",
  },
  {
    addr: "0xB28cC07F397Af54c89b2Ff06b6c595F282856539",
    expected: "keeperhub.agentlab.eth",
  },
] as const;

type Result =
  | {
      kind: "text" | "addr";
      name: string;
      key: string;
      value: string | null;
      latencyMs: number;
    }
  | {
      kind: "all";
      name: string;
      records: Record<string, string | null>;
      latencyMs: number;
    }
  | {
      kind: "reverse";
      address: string;
      value: string | null;
      latencyMs: number;
    }
  | { error: string };

export default function EnsDebugPage() {
  const [name, setName] = useState<string>(NAMES[0].label);
  const [key, setKey] = useState<string>(TEXT_KEYS[0].key);
  const [reverseAddr, setReverseAddr] = useState<string>(
    KNOWN_REVERSE_ADDRS[0].addr,
  );
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState<null | "single" | "all" | "reverse">(
    null,
  );

  async function resolveSingle() {
    setLoading("single");
    setResult(null);
    try {
      const res = await fetch(
        `/api/ens-debug?name=${encodeURIComponent(name)}&key=${encodeURIComponent(key)}`,
      );
      setResult(await res.json());
    } catch (err) {
      setResult({ error: String(err) });
    } finally {
      setLoading(null);
    }
  }

  async function resolveAll() {
    setLoading("all");
    setResult(null);
    try {
      const res = await fetch(
        `/api/ens-debug?name=${encodeURIComponent(name)}&all=1`,
      );
      setResult(await res.json());
    } catch (err) {
      setResult({ error: String(err) });
    } finally {
      setLoading(null);
    }
  }

  async function resolveReverse() {
    setLoading("reverse");
    setResult(null);
    try {
      const res = await fetch(
        `/api/ens-debug?reverse=${encodeURIComponent(reverseAddr)}`,
      );
      setResult(await res.json());
    } catch (err) {
      setResult({ error: String(err) });
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 md:px-10 pb-24">
      <SiteNav active="docs" />
      <header className="pt-6 pb-10 border-b-2 border-(--color-fg) reveal reveal-1">
        <p className="tag mb-2">demo · ens ccip-read · w2 + w3 cross-link</p>
        <h1 className="display text-[clamp(2rem,5vw,3.5rem)] leading-[0.95] tracking-tight">
          /ens-debug{" "}
          <span className="display-italic font-light text-(--color-muted)">
            / live gateway probe
          </span>
        </h1>
        <p className="mt-3 text-sm max-w-3xl text-(--color-muted)">
          Resolves any record on <code>*.agentlab.eth</code> through the
          deployed{" "}
          <a
            href="https://sepolia.etherscan.io/address/0x4F956e6521A4B87b9f9b2D5ED191fB6134Bc8C17"
            target="_blank"
            rel="noreferrer"
            className="link"
          >
            OffchainResolver
          </a>{" "}
          and the Vercel CCIP-Read gateway. The full roundtrip — Sepolia
          eth_call → OffchainLookup revert → gateway POST → ecrecover
          verification — happens server-side; you see the resolved value plus
          end-to-end latency.
        </p>
      </header>

      {/* ──────────────── Forward resolution ──────────────── */}
      <section className="mt-10 reveal reveal-2 space-y-3">
        <h2 className="display text-xl">forward resolution</h2>
        <div className="card-flat space-y-4">
          <p className="text-xs text-(--color-muted)">
            Pick an ENS name + a record key, or hit{" "}
            <em>resolve all known records</em> to fetch every dynamic+static
            record for the selected name in parallel.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-widest text-(--color-muted)">
                name
              </span>
              <select
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-(--color-border) bg-transparent px-3 py-2 text-sm font-mono"
              >
                {NAMES.map((n) => (
                  <option key={n.label} value={n.label}>
                    {n.label}
                  </option>
                ))}
              </select>
              <span className="block text-[11px] text-(--color-muted) min-h-[1em]">
                {NAMES.find((n) => n.label === name)?.note ?? ""}
              </span>
            </label>

            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-widest text-(--color-muted)">
                record key
              </span>
              <select
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="w-full border border-(--color-border) bg-transparent px-3 py-2 text-sm font-mono"
              >
                {TEXT_KEYS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.key}
                  </option>
                ))}
              </select>
              <span className="block text-[11px] text-(--color-muted) min-h-[1em]">
                {TEXT_KEYS.find((k) => k.key === key)?.note ?? ""}
              </span>
            </label>

            <div className="flex flex-col gap-2 self-end">
              <button
                onClick={resolveSingle}
                disabled={loading !== null}
                className="link link-amber whitespace-nowrap disabled:opacity-50"
              >
                {loading === "single" ? "resolving..." : "resolve →"}
              </button>
              <button
                onClick={resolveAll}
                disabled={loading !== null}
                className="link whitespace-nowrap disabled:opacity-50 text-xs"
              >
                {loading === "all" ? "resolving all..." : "resolve all records"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ──────────────── Reverse resolution ──────────────── */}
      <section className="mt-10 reveal reveal-3 space-y-3">
        <h2 className="display text-xl">reverse resolution</h2>
        <div className="card-flat space-y-4">
          <p className="text-xs text-(--color-muted)">
            Look up an address → ENS name. ENSIP-19 reverse records were set
            in W3 for our four operator wallets; viem checks the round-trip
            (forward addr must match) so this only returns a label if the W2
            gateway also resolves <code>addr(name)</code> back to the same
            address.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-widest text-(--color-muted)">
                address
              </span>
              <select
                value={reverseAddr}
                onChange={(e) => setReverseAddr(e.target.value)}
                className="w-full border border-(--color-border) bg-transparent px-3 py-2 text-sm font-mono"
              >
                {KNOWN_REVERSE_ADDRS.map((a) => (
                  <option key={a.addr} value={a.addr}>
                    {a.addr} — expects {a.expected}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={resolveReverse}
              disabled={loading !== null}
              className="link link-amber whitespace-nowrap self-end disabled:opacity-50"
            >
              {loading === "reverse" ? "resolving..." : "resolve reverse →"}
            </button>
          </div>
        </div>
      </section>

      {/* ──────────────── Result ──────────────── */}
      {result ? (
        <section className="mt-10 reveal reveal-4 space-y-3">
          <h2 className="display text-xl">result</h2>
          <ResultCard result={result} />
        </section>
      ) : null}

      <section className="mt-10 mb-4 text-xs text-(--color-muted) text-center">
        <p>
          full architecture in{" "}
          <a href="/docs#arch-w2" className="link">
            /docs ∇09–∇11
          </a>
          {" · "}
          source code:{" "}
          <a
            href="https://github.com/fritzschoff/hackagent/blob/main/lib/ens-gateway.ts"
            target="_blank"
            rel="noreferrer"
            className="link"
          >
            lib/ens-gateway.ts
          </a>
        </p>
      </section>
    </main>
  );
}

function ResultCard({ result }: { result: Result }) {
  if ("error" in result) {
    return (
      <div className="card-flat text-sm text-(--color-amber)">
        error: {result.error}
      </div>
    );
  }

  if (result.kind === "all") {
    const entries = Object.entries(result.records);
    return (
      <div className="card-flat space-y-3">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] uppercase tracking-widest text-(--color-muted)">
            resolved {entries.length} records for
          </span>
          <span className="font-mono text-sm">{result.name}</span>
          <span className="ml-auto text-xs text-(--color-muted)">
            total {result.latencyMs}ms
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-(--color-muted) text-left">
              <tr>
                <th className="pb-2 pr-4 font-normal">key</th>
                <th className="pb-2 font-normal">value</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([k, v]) => (
                <tr key={k} className="border-t border-(--color-border) align-top">
                  <td className="py-2 pr-4 whitespace-nowrap text-(--color-fg)">
                    {k}
                  </td>
                  <td className="py-2 break-all text-(--color-muted)">
                    {v ?? <span className="text-(--color-amber)">— null —</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (result.kind === "reverse") {
    return (
      <div className="card-flat space-y-2 text-sm">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] uppercase tracking-widest text-(--color-muted)">
            getEnsName
          </span>
          <span className="font-mono">{result.address}</span>
          <span className="ml-auto text-xs text-(--color-muted)">
            {result.latencyMs}ms
          </span>
        </div>
        <div className="font-mono text-base">
          → {result.value ?? <span className="text-(--color-amber)">null</span>}
        </div>
      </div>
    );
  }

  // single text or addr
  return (
    <div className="card-flat space-y-2 text-sm">
      <div className="flex items-baseline gap-3">
        <span className="text-[10px] uppercase tracking-widest text-(--color-muted)">
          {result.kind === "addr" ? "getEnsAddress" : "getEnsText"}
        </span>
        <span className="font-mono">
          {result.name}
          {result.kind === "text" ? ` / ${result.key}` : ""}
        </span>
        <span className="ml-auto text-xs text-(--color-muted)">
          {result.latencyMs}ms
        </span>
      </div>
      <div className="font-mono text-base break-all">
        →{" "}
        {result.value ?? <span className="text-(--color-amber)">null</span>}
      </div>
    </div>
  );
}
