"use client";

import { useState } from "react";
import { createWalletClient, custom, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";

type Props = {
  tokenId: bigint;
  oracle: Address;
  expiresAt: number; // unix timestamp (seconds)
  inftAddress: Address;
  account: Address;
  onSigned: (sig: Hex) => void;
  disabled?: boolean;
};

const DELEGATION_TYPE = [
  { name: "tokenId", type: "uint256" },
  { name: "oracle", type: "address" },
  { name: "expiresAt", type: "uint64" },
] as const;

/**
 * DelegationButton — generates an EIP-712 Delegation signature.
 *
 * Domain: AgentINFT contract on Sepolia.
 * Type:   Delegation(uint256 tokenId, address oracle, uint64 expiresAt)
 *
 * On success calls `onSigned(sig)` with the 65-byte hex signature.
 */
export default function DelegationButton({
  tokenId,
  oracle,
  expiresAt,
  inftAddress,
  account,
  onSigned,
  disabled,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const oracleShort = `${oracle.slice(0, 6)}…${oracle.slice(-4)}`;
  const expiresDate = new Date(expiresAt * 1000).toLocaleDateString();

  async function handleClick() {
    if (!window.ethereum) {
      setError("no wallet detected");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const walletClient = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum),
      });

      const sig = await walletClient.signTypedData({
        account,
        domain: {
          name: "AgentINFT",
          version: "1",
          chainId: sepolia.id,
          verifyingContract: inftAddress,
        },
        types: {
          Delegation: DELEGATION_TYPE,
        },
        primaryType: "Delegation",
        message: {
          tokenId,
          oracle,
          expiresAt: BigInt(expiresAt),
        },
      });

      onSigned(sig);
    } catch (err) {
      const e = err as { shortMessage?: string; message?: string };
      setError(e.shortMessage ?? e.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || busy}
        className="btn btn-primary"
      >
        {busy
          ? "signing…"
          : `Authorize oracle ${oracleShort} (until ${expiresDate})`}
      </button>
      {error ? (
        <p className="text-xs text-(--color-amber) break-words">{error}</p>
      ) : null}
    </div>
  );
}
