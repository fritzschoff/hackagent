"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseUnits,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import ComplianceManifestAbi from "@/lib/abis/ComplianceManifest.json";
import NetworkBanner from "@/components/network-banner";

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const MAX_UINT256 = (1n << 256n) - 1n;
const SEPOLIA_HEX_ID = "0xaa36a7";

function extractError(err: unknown): string {
  if (err && typeof err === "object") {
    const r = err as { shortMessage?: string; message?: string };
    return r.shortMessage ?? r.message ?? String(err);
  }
  return String(err);
}

type Props = {
  registry: Address;
  usdc: Address;
  agentId: string;
  agentBond: string;
  challengerBond: string;
  status: "none" | "committed" | "challenged" | "slashed" | "cleared";
};

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export default function ComplianceControls(props: Props) {
  const agentId = BigInt(props.agentId);
  const agentBond = BigInt(props.agentBond);
  const minChallengerBond = agentBond > 0n ? agentBond : 1_000_000n; // 1 USDC default
  const [account, setAccount] = useState<Address | null>(null);
  const [chainOk, setChainOk] = useState<boolean>(false);
  const [usdcBal, setUsdcBal] = useState<bigint | null>(null);
  const [evidence, setEvidence] = useState<string>("");
  const [bondInput, setBondInput] = useState<string>(
    formatUnits(minChallengerBond, 6),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<Hex | null>(null);

  const publicClient = useMemo(
    () => createPublicClient({ chain: sepolia, transport: http() }),
    [],
  );

  const refresh = useCallback(
    async (addr: Address) => {
      try {
        const u = (await publicClient.readContract({
          address: props.usdc,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [addr],
        })) as bigint;
        setUsdcBal(u);
      } catch (err) {
        console.error("[compliance] refresh:", err);
      }
    },
    [publicClient, props.usdc],
  );

  const handleConnect = useCallback(async () => {
    setError(null);
    if (!window.ethereum) {
      setError("install MetaMask");
      return;
    }
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const addr = (accounts[0] ?? "") as Address;
      const id = (await window.ethereum.request({
        method: "eth_chainId",
      })) as string;
      setAccount(addr);
      setChainOk(id.toLowerCase() === SEPOLIA_HEX_ID);
      await refresh(addr);
    } catch (err) {
      setError(extractError(err));
    }
  }, [refresh]);

  useEffect(() => {
    if (window.ethereum?.on) {
      window.ethereum.on("accountsChanged", (...args: unknown[]) => {
        const next = ((args[0] as string[])[0] ?? null) as Address | null;
        setAccount(next);
        if (next) refresh(next);
      });
      window.ethereum.on("chainChanged", (...args: unknown[]) => {
        const id = args[0] as string;
        setChainOk(id.toLowerCase() === SEPOLIA_HEX_ID);
      });
    }
  }, [refresh]);

  const requestSwitch = useCallback(async () => {
    if (!window.ethereum) return;
    setError(null);
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_HEX_ID }],
      });
      setChainOk(true);
    } catch (err) {
      setError(extractError(err));
    }
  }, []);

  const ensureAllowance = useCallback(
    async (
      walletClient: ReturnType<typeof createWalletClient>,
      addr: Address,
      amount: bigint,
    ) => {
      const cur = (await publicClient.readContract({
        address: props.usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [addr, props.registry],
      })) as bigint;
      if (cur >= amount) return;
      setBusy("approving USDC…");
      const tx = await walletClient.writeContract({
        address: props.usdc,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [props.registry, MAX_UINT256],
        chain: sepolia,
        account: addr,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
    },
    [publicClient, props.registry, props.usdc],
  );

  const onChallenge = useCallback(async () => {
    if (!account || !window.ethereum) return;
    setError(null);
    setLastTx(null);
    try {
      const amount = parseUnits(bondInput, 6);
      if (amount < minChallengerBond) {
        throw new Error(
          `bond must be >= ${formatUnits(minChallengerBond, 6)} USDC`,
        );
      }
      if (!evidence || !evidence.startsWith("http") && !evidence.startsWith("ipfs:") && !evidence.startsWith("og://")) {
        throw new Error("evidence must be a URL (https://, ipfs://, og://)");
      }
      const wc = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum),
      });
      await ensureAllowance(wc, account, amount);
      setBusy("posting challenge…");
      const tx = await wc.writeContract({
        address: props.registry,
        abi: ComplianceManifestAbi,
        functionName: "challenge",
        args: [agentId, amount, evidence],
        account,
      });
      setLastTx(tx);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await refresh(account);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  }, [
    account,
    agentId,
    bondInput,
    ensureAllowance,
    evidence,
    minChallengerBond,
    props.registry,
    publicClient,
    refresh,
  ]);

  const onResolveUphold = useCallback(async () => {
    if (!account || !window.ethereum) return;
    setError(null);
    setLastTx(null);
    try {
      const wc = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum),
      });
      setBusy("resolving (slash)…");
      const tx = await wc.writeContract({
        address: props.registry,
        abi: ComplianceManifestAbi,
        functionName: "resolve",
        args: [agentId, true],
        account,
      });
      setLastTx(tx);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await refresh(account);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  }, [account, agentId, props.registry, publicClient, refresh]);

  const onResolveDismiss = useCallback(async () => {
    if (!account || !window.ethereum) return;
    setError(null);
    setLastTx(null);
    try {
      const wc = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum),
      });
      setBusy("resolving (dismiss)…");
      const tx = await wc.writeContract({
        address: props.registry,
        abi: ComplianceManifestAbi,
        functionName: "resolve",
        args: [agentId, false],
        account,
      });
      setLastTx(tx);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await refresh(account);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  }, [account, agentId, props.registry, publicClient, refresh]);

  const isChallenged = props.status === "challenged";
  const isCommitted = props.status === "committed";
  const isSlashed = props.status === "slashed";

  return (
    <div className="card-flat space-y-4">
      {!account ? (
        <button onClick={handleConnect} className="btn btn-primary">
          connect wallet →
        </button>
      ) : (
        <p className="text-xs font-mono">
          <span className="text-(--color-fg)">
            {account.slice(0, 6)}…{account.slice(-4)}
          </span>
          {usdcBal !== null ? (
            <span className="text-(--color-muted)">
              {" "}
              · {formatUnits(usdcBal, 6)} USDC
            </span>
          ) : null}
        </p>
      )}

      <NetworkBanner
        requiredHexId={SEPOLIA_HEX_ID}
        requiredName="Sepolia"
        visible={!!account && !chainOk}
        onSwitch={requestSwitch}
        busy={busy !== null}
      />

      {account && chainOk && isCommitted ? (
        <div className="space-y-3">
          <p className="tag">challenge this manifest</p>
          <p className="text-xs text-(--color-muted) leading-relaxed">
            Post a counter-bond ≥ agent bond (
            {formatUnits(minChallengerBond, 6)} USDC) and a URL pointing to
            evidence the manifest is incomplete or false. Validator resolves —
            if upheld, you receive 70% of the agent&apos;s slashed bond +
            your stake refunded.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              value={bondInput}
              onChange={(e) => setBondInput(e.target.value)}
              disabled={busy !== null}
              className="w-24"
              data-testid="challenge-bond"
            />
            <span className="tag">USDC</span>
          </div>
          <input
            type="text"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            disabled={busy !== null}
            placeholder="https://… or ipfs://… or og://…"
            className="w-full"
            data-testid="challenge-evidence"
          />
          <button
            onClick={onChallenge}
            disabled={busy !== null}
            className="btn btn-danger"
            data-testid="challenge-submit"
          >
            challenge →
          </button>
        </div>
      ) : null}

      {account && chainOk && isChallenged ? (
        <div className="space-y-3">
          <p className="tag">validator resolution</p>
          <p className="text-xs text-(--color-muted) leading-relaxed">
            Visible to the registered validator only. Uphold slashes 70/30,
            dismiss refunds the agent the challenger&apos;s bond.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onResolveUphold}
              disabled={busy !== null}
              className="btn btn-danger"
            >
              uphold (slash) →
            </button>
            <button
              onClick={onResolveDismiss}
              disabled={busy !== null}
              className="btn"
            >
              dismiss
            </button>
          </div>
        </div>
      ) : null}

      {isSlashed ? (
        <p className="text-xs text-(--color-amber) leading-relaxed">
          Manifest was challenged and the challenge upheld. The agent&apos;s
          bond was slashed and the manifest is on-chain-recorded as
          non-compliant.
        </p>
      ) : null}

      {busy ? (
        <p className="text-xs text-(--color-muted) italic">
          <span className="caret" />
          {busy}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-(--color-amber) break-words">{error}</p>
      ) : null}
      {lastTx ? (
        <p className="text-xs">
          <a
            href={`https://sepolia.etherscan.io/tx/${lastTx}`}
            target="_blank"
            rel="noreferrer"
            className="link"
          >
            tx →
          </a>
        </p>
      ) : null}
    </div>
  );
}
