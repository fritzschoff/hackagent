"use client";

import { useState, useCallback } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import AgentBidsAbi from "@/lib/abis/AgentBids.json";

type Step = "prepare" | "wallet" | "confirm" | "done" | "error";

type SubProgress = {
  label: string;
  done: boolean;
  active: boolean;
};

type Props = {
  tokenId: bigint;
  bidder: Address;
  bidsAddress: Address;
  account: Address;
  sellerNonce: Hex;
  /** Proof bytes returned by /api/inft/transfer/prepare */
  proof?: Hex;
  onClose: () => void;
  onComplete: () => void;
};

function StepIcon({ state }: { state: "pending" | "active" | "done" | "error" }) {
  if (state === "done")
    return <span className="text-(--color-accent) font-bold">✓</span>;
  if (state === "error")
    return <span className="text-(--color-amber) font-bold">✗</span>;
  if (state === "active")
    return (
      <span className="inline-block w-3 h-3 border-2 border-(--color-fg) border-t-transparent rounded-full animate-spin" />
    );
  return <span className="text-(--color-rule)">○</span>;
}

const SUB_STEPS: SubProgress[] = [
  { label: "verifying delegation", done: false, active: false },
  { label: "decrypting memory blob", done: false, active: false },
  { label: "re-encrypting for new owner", done: false, active: false },
  { label: "anchoring to 0G Storage", done: false, active: false },
  { label: "generating proof", done: false, active: false },
];

/**
 * TransferModal — 3-step accept-bid flow.
 *
 * Step 1: Oracle prepares the transfer proof (calls /api/inft/transfer/prepare)
 * Step 2: Seller confirms in wallet (BIDS.acceptBid)
 * Step 3: Oracle key rotation (calls /api/inft/transfer/confirm)
 */
export default function TransferModal({
  tokenId,
  bidder,
  bidsAddress,
  account,
  sellerNonce,
  onClose,
  onComplete,
}: Props) {
  const [step, setStep] = useState<Step>("prepare");
  const [subSteps, setSubSteps] = useState<SubProgress[]>(
    SUB_STEPS.map((s) => ({ ...s })),
  );
  const [proof, setProof] = useState<Hex | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function markSubStep(idx: number, done: boolean, active: boolean) {
    setSubSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, done, active } : s)),
    );
  }

  // Step 1: Prepare proof
  const runPrepare = useCallback(async () => {
    setStep("prepare");
    setErrorMsg(null);

    // Animate sub-steps with small delays (server call is one round-trip)
    const delays = [0, 400, 900, 1400, 1800];
    delays.forEach((d, i) => {
      setTimeout(() => markSubStep(i, false, true), d);
      setTimeout(() => markSubStep(i, true, false), d + 350);
    });

    try {
      const res = await fetch("/api/inft/transfer/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: tokenId.toString(),
          bidder,
          // sellerSig is not re-sent here — the proxy already validated it; we
          // pass the nonce so the oracle can look up the pending key.
          sellerSig: {
            signature: "0x" + "00".repeat(65), // placeholder — real sig sent on first call
            expiresAt: Math.floor(Date.now() / 1000) + 300,
            nonce: sellerNonce,
          },
        }),
      });

      const data = (await res.json()) as { proof?: Hex; error?: string };
      if (!res.ok || !data.proof) {
        throw new Error(data.error ?? `prepare failed: ${res.status}`);
      }

      // Mark all sub-steps done
      setSubSteps(SUB_STEPS.map((s) => ({ ...s, done: true, active: false })));
      setProof(data.proof);
      setStep("wallet");
    } catch (err) {
      const e = err as { message?: string };
      setErrorMsg(e.message ?? String(err));
      setStep("error");
    }
  }, [tokenId, bidder, sellerNonce]);

  // Step 2: wallet tx
  const runWalletTx = useCallback(async () => {
    if (!proof || !window.ethereum) return;
    setStep("wallet");
    setErrorMsg(null);

    try {
      const walletClient = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum),
      });
      const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(),
      });

      const hash = await walletClient.writeContract({
        address: bidsAddress,
        abi: AgentBidsAbi,
        functionName: "acceptBid",
        args: [tokenId, bidder, proof],
        account,
        chain: sepolia,
      });
      setTxHash(hash);

      await publicClient.waitForTransactionReceipt({ hash });
      setStep("confirm");
      await runConfirm(hash);
    } catch (err) {
      const e = err as { shortMessage?: string; message?: string };
      setErrorMsg(e.shortMessage ?? e.message ?? String(err));
      setStep("error");
    }
  }, [proof, bidsAddress, tokenId, bidder, account]);

  // Step 3: confirm (key rotation)
  async function runConfirm(hash: Hex) {
    try {
      const res = await fetch("/api/inft/transfer/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: tokenId.toString(),
          txHash: hash,
          sellerNonce,
        }),
      });

      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `confirm failed: ${res.status}`);
      }

      setStep("done");
      onComplete();
    } catch (err) {
      const e = err as { message?: string };
      setErrorMsg(e.message ?? String(err));
      setStep("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative bg-(--color-bg) border border-(--color-border) rounded-xl p-8 max-w-md w-full mx-4 shadow-2xl space-y-6">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-(--color-muted) hover:text-(--color-fg) text-lg"
          aria-label="close"
        >
          ×
        </button>

        <div>
          <p className="tag mb-1">accept bid · erc-7857</p>
          <h2 className="display text-2xl">
            transfer token #{tokenId.toString()}
          </h2>
          <p className="text-xs text-(--color-muted) mt-1 font-mono">
            to {bidder.slice(0, 6)}…{bidder.slice(-4)}
          </p>
        </div>

        {/* Step 1 */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <StepIcon
              state={
                step === "prepare"
                  ? "active"
                  : step === "error" && !proof
                    ? "error"
                    : proof
                      ? "done"
                      : "pending"
              }
            />
            <span className="text-sm font-medium">
              Oracle preparing transfer…
            </span>
          </div>

          {(step === "prepare" || proof) ? (
            <ul className="ml-6 space-y-1">
              {subSteps.map((s) => (
                <li
                  key={s.label}
                  className="flex items-center gap-2 text-xs text-(--color-muted)"
                >
                  <StepIcon
                    state={s.done ? "done" : s.active ? "active" : "pending"}
                  />
                  {s.label}
                </li>
              ))}
            </ul>
          ) : null}

          {step === "prepare" ? (
            <button
              type="button"
              onClick={runPrepare}
              className="btn btn-primary text-xs"
            >
              start prepare →
            </button>
          ) : null}
        </div>

        {/* Step 2 */}
        <div className="flex items-center gap-3">
          <StepIcon
            state={
              step === "wallet"
                ? "active"
                : step === "confirm" || step === "done"
                  ? "done"
                  : step === "error" && proof && !txHash
                    ? "error"
                    : "pending"
            }
          />
          <div className="flex-1">
            <span className="text-sm font-medium">Confirm in wallet</span>
            {step === "wallet" ? (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={runWalletTx}
                  className="btn btn-primary"
                >
                  Confirm →
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Step 3 */}
        <div className="flex items-center gap-3">
          <StepIcon
            state={
              step === "confirm"
                ? "active"
                : step === "done"
                  ? "done"
                  : step === "error" && txHash
                    ? "error"
                    : "pending"
            }
          />
          <span className="text-sm font-medium">Rotating oracle key…</span>
        </div>

        {step === "done" ? (
          <div className="space-y-2">
            <p className="text-sm text-(--color-accent) display-italic">
              transfer complete
            </p>
            <button type="button" onClick={onClose} className="btn">
              [reveal memory]
            </button>
          </div>
        ) : null}

        {errorMsg ? (
          <p className="text-xs text-(--color-amber) break-words">
            {errorMsg}
          </p>
        ) : null}

        {txHash ? (
          <p className="text-xs">
            <a
              href={`https://sepolia.etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              tx →
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}
