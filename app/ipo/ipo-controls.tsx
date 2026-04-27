"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatUnits,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import SharesSaleAbi from "@/lib/abis/SharesSale.json";
import RevenueSplitterAbi from "@/lib/abis/RevenueSplitter.json";

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
const BASE_SEPOLIA_HEX_ID = "0x14a34"; // 84532

type Props = {
  shares: Address;
  splitter: Address;
  sale: Address;
  usdc: Address;
  pricePerShareUsdc: string;
};

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

function extractError(err: unknown): string {
  if (err && typeof err === "object") {
    const r = err as { shortMessage?: string; message?: string };
    return r.shortMessage ?? r.message ?? String(err);
  }
  return String(err);
}

export default function IpoControls(props: Props) {
  const pricePerShare = BigInt(props.pricePerShareUsdc);

  const [account, setAccount] = useState<Address | null>(null);
  const [chainOk, setChainOk] = useState<boolean>(false);
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [shareBalance, setShareBalance] = useState<bigint | null>(null);
  const [claimable, setClaimable] = useState<bigint | null>(null);
  const [buyAmount, setBuyAmount] = useState<string>("1");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<Hex | null>(null);

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: baseSepolia,
        transport: http(),
      }),
    [],
  );

  const refreshState = useCallback(
    async (addr: Address) => {
      try {
        const [u, s, c] = await Promise.all([
          publicClient.readContract({
            address: props.usdc,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [addr],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: props.shares,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [addr],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: props.splitter,
            abi: RevenueSplitterAbi,
            functionName: "claimable",
            args: [addr],
          }) as Promise<bigint>,
        ]);
        setUsdcBalance(u);
        setShareBalance(s);
        setClaimable(c);
      } catch (err) {
        console.error("[ipo] refreshState:", err);
      }
    },
    [publicClient, props.usdc, props.shares, props.splitter],
  );

  const handleConnect = useCallback(async () => {
    setError(null);
    if (!window.ethereum) {
      setError("install MetaMask or another injected wallet");
      return;
    }
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const addr = (accounts[0] ?? "") as Address;
      const chainId = (await window.ethereum.request({
        method: "eth_chainId",
      })) as string;
      setAccount(addr);
      const onBase = chainId.toLowerCase() === BASE_SEPOLIA_HEX_ID;
      setChainOk(onBase);
      if (!onBase) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: BASE_SEPOLIA_HEX_ID }],
          });
          setChainOk(true);
        } catch (switchErr) {
          setError(`switch wallet to Base Sepolia (${extractError(switchErr)})`);
        }
      }
      await refreshState(addr);
    } catch (err) {
      setError(extractError(err));
    }
  }, [refreshState]);

  useEffect(() => {
    if (window.ethereum?.on) {
      window.ethereum.on("accountsChanged", (...args: unknown[]) => {
        const accounts = args[0] as string[];
        const next = (accounts[0] ?? null) as Address | null;
        setAccount(next);
        if (next) refreshState(next);
      });
      window.ethereum.on("chainChanged", (...args: unknown[]) => {
        const id = args[0] as string;
        setChainOk(id.toLowerCase() === BASE_SEPOLIA_HEX_ID);
      });
    }
  }, [refreshState]);

  const onBuy = useCallback(async () => {
    if (!account || !window.ethereum) return;
    setError(null);
    setLastTx(null);
    try {
      const wholeShares = BigInt(buyAmount || "0");
      if (wholeShares <= 0n) throw new Error("shares must be > 0");
      const cost = wholeShares * pricePerShare;
      const walletClient = createWalletClient({
        chain: baseSepolia,
        transport: custom(window.ethereum),
      });
      const allowance = (await publicClient.readContract({
        address: props.usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account, props.sale],
      })) as bigint;
      if (allowance < cost) {
        setBusy("approving USDC…");
        const approveTx = await walletClient.writeContract({
          address: props.usdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [props.sale, MAX_UINT256],
          account,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }
      setBusy("buying shares…");
      const tx = await walletClient.writeContract({
        address: props.sale,
        abi: SharesSaleAbi,
        functionName: "buy",
        args: [wholeShares],
        account,
      });
      setLastTx(tx);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await refreshState(account);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  }, [account, buyAmount, pricePerShare, props.sale, props.usdc, publicClient, refreshState]);

  const onClaim = useCallback(async () => {
    if (!account || !window.ethereum) return;
    setError(null);
    setLastTx(null);
    try {
      const walletClient = createWalletClient({
        chain: baseSepolia,
        transport: custom(window.ethereum),
      });
      setBusy("claiming…");
      const tx = await walletClient.writeContract({
        address: props.splitter,
        abi: RevenueSplitterAbi,
        functionName: "claim",
        account,
      });
      setLastTx(tx);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await refreshState(account);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  }, [account, props.splitter, publicClient, refreshState]);

  const buyCost = (() => {
    try {
      return BigInt(buyAmount || "0") * pricePerShare;
    } catch {
      return 0n;
    }
  })();

  return (
    <div className="space-y-4">
      <div className="border border-(--color-border) rounded-lg p-4 space-y-3">
        {!account ? (
          <button
            onClick={handleConnect}
            className="px-3 py-2 text-sm bg-(--color-accent) text-black rounded font-mono"
          >
            connect wallet
          </button>
        ) : (
          <p className="text-xs font-mono text-(--color-muted)">
            {account.slice(0, 6)}…{account.slice(-4)}
            {chainOk ? "" : " · wrong network (need Base Sepolia)"}
            {usdcBalance !== null
              ? ` · ${formatUnits(usdcBalance, 6)} USDC`
              : ""}
            {shareBalance !== null
              ? ` · ${shareBalance / 10n ** 18n} TRADE`
              : ""}
          </p>
        )}

        {account && chainOk ? (
          <>
            <div className="flex flex-wrap gap-2 items-center">
              <label className="text-xs text-(--color-muted)">buy</label>
              <input
                type="text"
                value={buyAmount}
                onChange={(e) => setBuyAmount(e.target.value)}
                disabled={busy !== null}
                className="px-2 py-1 text-sm font-mono bg-transparent border border-(--color-border) rounded w-20"
              />
              <span className="text-xs text-(--color-muted)">
                shares · cost ≈ ${formatUnits(buyCost, 6)} USDC
              </span>
              <button
                onClick={onBuy}
                disabled={busy !== null}
                className="px-3 py-1 text-sm bg-(--color-accent) text-black rounded font-mono disabled:opacity-50"
              >
                buy
              </button>
            </div>

            <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-(--color-border)">
              <span className="text-xs text-(--color-muted)">claimable</span>
              <span className="text-sm font-mono">
                {claimable !== null
                  ? `${formatUnits(claimable, 6)} USDC`
                  : "—"}
              </span>
              <button
                onClick={onClaim}
                disabled={busy !== null || !claimable || claimable === 0n}
                className="ml-auto px-3 py-1 text-sm bg-(--color-accent) text-black rounded font-mono disabled:opacity-50"
              >
                claim
              </button>
            </div>
          </>
        ) : null}

        {busy ? (
          <p className="text-xs text-(--color-muted)">{busy}</p>
        ) : null}
        {error ? (
          <p className="text-xs text-red-500 break-words">{error}</p>
        ) : null}
        {lastTx ? (
          <p className="text-xs">
            <a
              href={`https://sepolia.basescan.org/tx/${lastTx}`}
              target="_blank"
              rel="noreferrer"
              className="text-(--color-accent) underline"
            >
              tx ↗
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}

void parseUnits;
