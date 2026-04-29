"use client";

import { useState, useCallback } from "react";
import { createWalletClient, custom, type Address, type Hex } from "viem";
import { keccak256, toBytes, encodePacked } from "viem";
import { sepolia } from "viem/chains";

type Props = {
  tokenId: bigint;
  /** The on-chain owner address — passed from server. Shown only when viewer is owner. */
  owner: Address;
  /** The currently connected wallet account. */
  account: Address;
};

function buildRevealDigest(
  tokenId: bigint,
  nonce: string,
  expiresAt: number,
): Hex {
  // keccak256("inft-reveal" || tokenId[32] || nonce[utf8] || expiresAt[8])
  const prefix = toBytes("inft-reveal");
  const tidBytes = new Uint8Array(32);
  let n = tokenId;
  for (let j = 31; j >= 0; j--) {
    tidBytes[j] = Number(n & 0xffn);
    n >>= 8n;
  }
  const nonceBytes = toBytes(nonce);
  const eaBytes = new Uint8Array(8);
  let ea = BigInt(expiresAt);
  for (let j = 7; j >= 0; j--) {
    eaBytes[j] = Number(ea & 0xffn);
    ea >>= 8n;
  }

  const combined = new Uint8Array(
    prefix.length + tidBytes.length + nonceBytes.length + eaBytes.length,
  );
  let off = 0;
  combined.set(prefix, off); off += prefix.length;
  combined.set(tidBytes, off); off += tidBytes.length;
  combined.set(nonceBytes, off); off += nonceBytes.length;
  combined.set(eaBytes, off);

  return keccak256(combined);
}

/**
 * RevealPanel — owner-only component.
 * Renders nothing when the current account is not the token owner.
 * On click: signs an EIP-191 message, POSTs to /api/inft/transfer/reveal,
 * and displays the returned plaintext as a JSON code block.
 */
export default function RevealPanel({ tokenId, owner, account }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plaintext, setPlaintext] = useState<string | null>(null);

  const isOwner = account.toLowerCase() === owner.toLowerCase();
  if (!isOwner) return null;

  const handleReveal = useCallback(async () => {
    if (!window.ethereum) {
      setError("no wallet detected");
      return;
    }
    setBusy(true);
    setError(null);
    setPlaintext(null);

    try {
      const nonce = crypto.randomUUID();
      const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 min

      const digest = buildRevealDigest(tokenId, nonce, expiresAt);

      const walletClient = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum),
      });

      // EIP-191 personal_sign over the keccak256 digest
      const ownerSig = (await walletClient.signMessage({
        account,
        message: { raw: digest },
      })) as Hex;

      const res = await fetch("/api/inft/transfer/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: tokenId.toString(),
          ownerSig,
          nonce,
          expiresAt,
        }),
      });

      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error ?? `reveal failed: ${res.status}`);
      }

      const data = (await res.json()) as { plaintext?: string };
      setPlaintext(data.plaintext ?? JSON.stringify(data, null, 2));
    } catch (err) {
      const e = err as { shortMessage?: string; message?: string };
      setError(e.shortMessage ?? e.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [account, tokenId]);

  return (
    <div className="card-flat space-y-3">
      <div className="flex items-baseline gap-3">
        <span className="tag">memory reveal</span>
        <span className="text-xs text-(--color-muted)">owner only</span>
      </div>

      {!plaintext ? (
        <button
          type="button"
          onClick={handleReveal}
          disabled={busy}
          className="btn btn-primary"
        >
          {busy ? "decrypting…" : "[reveal memory]"}
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-(--color-muted)">
            decrypted memory (AES-128 · oracle re-encrypted for you)
          </p>
          <pre className="bg-(--color-surface) border border-(--color-rule) rounded p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-80 overflow-y-auto">
            {plaintext}
          </pre>
          <button
            type="button"
            onClick={() => setPlaintext(null)}
            className="btn text-xs"
          >
            clear
          </button>
        </div>
      )}

      {error ? (
        <p className="text-xs text-(--color-amber) break-words">{error}</p>
      ) : null}
    </div>
  );
}
