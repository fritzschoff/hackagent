"use client";

import { useState } from "react";
import SiteNav from "@/components/site-nav";

export default function EnsDebugPage() {
  const [name, setName] = useState("tradewise.agentlab.eth");
  const [key, setKey] = useState("last-seen-at");
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function go() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/ens-debug?name=${encodeURIComponent(name)}&key=${encodeURIComponent(key)}`,
      );
      setResult(await res.json());
    } catch (err) {
      setResult({ error: String(err) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 md:px-10 pb-24">
      <SiteNav active="docs" />
      <header className="pt-6 pb-10 border-b-2 border-(--color-fg)">
        <p className="tag mb-2">debug · ens ccip-read</p>
        <h1 className="display text-3xl">/ens-debug</h1>
        <p className="mt-3 text-sm text-(--color-muted)">
          Resolves an ENS text record through the W2 offchain gateway and shows
          the full OffchainLookup roundtrip — revert, gateway URL, signed
          response, ecrecovered signer.
        </p>
      </header>
      <section className="mt-10 card-flat space-y-4">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border px-3 py-2 text-sm bg-transparent"
            placeholder="name"
          />
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="border px-3 py-2 text-sm bg-transparent"
            placeholder="text key"
          />
          <button onClick={go} disabled={loading} className="link link-amber">
            {loading ? "resolving..." : "resolve"}
          </button>
        </div>
        {result ? (
          <pre className="text-[11px] bg-(--color-bg-soft) p-4 rounded overflow-x-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
        ) : null}
      </section>
    </main>
  );
}
