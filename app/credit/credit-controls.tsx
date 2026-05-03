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
import { sepolia } from "viem/chains";
import ReputationCreditAbi from "@/lib/abis/ReputationCredit.json";
import NetworkBanner from "@/components/network-banner";
import { agentBorrow, agentRepay } from "./actions";

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
  creditAddress: Address;
  usdcAddress: Address;
  agentId: string;
  agentAddress: Address;
  isLiquidatable: boolean;
  hasOpenLoan: boolean;
};

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export default function CreditControls(props: Props) {
  const agentId = BigInt(props.agentId);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainOk, setChainOk] = useState<boolean>(false);
  const [usdcBal, setUsdcBal] = useState<bigint | null>(null);
  const [shares, setShares] = useState<bigint | null>(null);
  const [depositAmount, setDepositAmount] = useState<string>("10");
  const [borrowAmount, setBorrowAmount] = useState<string>("5");
  const [repayAmount, setRepayAmount] = useState<string>("5");
  const [agentBorrowAmount, setAgentBorrowAmount] = useState<string>("5");
  const [agentRepayAmount, setAgentRepayAmount] = useState<string>("5");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<Hex | null>(null);

  const isAgent = account
    ? account.toLowerCase() === props.agentAddress.toLowerCase()
    : false;

  const publicClient = useMemo(
    () => createPublicClient({ chain: sepolia, transport: http() }),
    [],
  );

  const refresh = useCallback(
    async (addr: Address) => {
      try {
        const [u, s] = await Promise.all([
          publicClient.readContract({
            address: props.usdcAddress,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [addr],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: props.creditAddress,
            abi: ReputationCreditAbi,
            functionName: "sharesOf",
            args: [addr],
          }) as Promise<bigint>,
        ]);
        setUsdcBal(u);
        setShares(s);
      } catch (err) {
        console.error("[credit] refresh:", err);
      }
    },
    [publicClient, props.creditAddress, props.usdcAddress],
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
      const onSep = id.toLowerCase() === SEPOLIA_HEX_ID;
      setChainOk(onSep);
      if (!onSep) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: SEPOLIA_HEX_ID }],
          });
          setChainOk(true);
        } catch (e) {
          setError(`switch to Sepolia (${extractError(e)})`);
        }
      }
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
        address: props.usdcAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [addr, props.creditAddress],
      })) as bigint;
      if (cur >= amount) return;
      setBusy("approving USDC…");
      const tx = await walletClient.writeContract({
        address: props.usdcAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [props.creditAddress, MAX_UINT256],
        account: addr,
        chain: sepolia,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
    },
    [publicClient, props.creditAddress, props.usdcAddress],
  );

  const onDeposit = useCallback(async () => {
    if (!account || !window.ethereum) return;
    setError(null);
    setLastTx(null);
    try {
      const amount = parseUnits(depositAmount, 6);
      if (amount === 0n) throw new Error("zero");
      const wc = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum),
      });
      await ensureAllowance(wc, account, amount);
      setBusy("depositing…");
      const tx = await wc.writeContract({
        address: props.creditAddress,
        abi: ReputationCreditAbi,
        functionName: "deposit",
        args: [amount],
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
  }, [account, depositAmount, ensureAllowance, props.creditAddress, publicClient, refresh]);

  const onWithdraw = useCallback(async () => {
    if (!account || !window.ethereum || !shares || shares === 0n) return;
    setError(null);
    setLastTx(null);
    try {
      const wc = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum),
      });
      setBusy("withdrawing all…");
      const tx = await wc.writeContract({
        address: props.creditAddress,
        abi: ReputationCreditAbi,
        functionName: "withdraw",
        args: [shares],
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
  }, [account, props.creditAddress, publicClient, refresh, shares]);

  const onBorrow = useCallback(async () => {
    if (!account || !window.ethereum) return;
    setError(null);
    setLastTx(null);
    try {
      const amount = parseUnits(borrowAmount, 6);
      if (amount === 0n) throw new Error("zero");
      const wc = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum),
      });
      setBusy("borrowing…");
      const tx = await wc.writeContract({
        address: props.creditAddress,
        abi: ReputationCreditAbi,
        functionName: "borrow",
        args: [agentId, amount],
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
  }, [account, agentId, borrowAmount, props.creditAddress, publicClient, refresh]);

  const onRepay = useCallback(async () => {
    if (!account || !window.ethereum) return;
    setError(null);
    setLastTx(null);
    try {
      const amount = parseUnits(repayAmount, 6);
      if (amount === 0n) throw new Error("zero");
      const wc = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum),
      });
      await ensureAllowance(wc, account, amount);
      setBusy("repaying…");
      const tx = await wc.writeContract({
        address: props.creditAddress,
        abi: ReputationCreditAbi,
        functionName: "repay",
        args: [agentId, amount],
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
  }, [account, agentId, ensureAllowance, props.creditAddress, publicClient, refresh, repayAmount]);

  const onAgentBorrow = useCallback(async () => {
    setError(null);
    setLastTx(null);
    setBusy("agent borrowing (server-signed)…");
    try {
      const res = await agentBorrow(agentBorrowAmount);
      if (!res.ok) {
        setError(res.error);
      } else {
        setLastTx(res.txHash);
        if (account) await refresh(account);
      }
    } finally {
      setBusy(null);
    }
  }, [account, agentBorrowAmount, refresh]);

  const onAgentRepay = useCallback(async () => {
    setError(null);
    setLastTx(null);
    setBusy("agent repaying (server-signed)…");
    try {
      const res = await agentRepay(agentRepayAmount);
      if (!res.ok) {
        setError(res.error);
      } else {
        setLastTx(res.txHash);
        if (account) await refresh(account);
      }
    } finally {
      setBusy(null);
    }
  }, [account, agentRepayAmount, refresh]);

  const onLiquidate = useCallback(async () => {
    if (!account || !window.ethereum) return;
    setError(null);
    setLastTx(null);
    try {
      const wc = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum),
      });
      setBusy("liquidating…");
      const tx = await wc.writeContract({
        address: props.creditAddress,
        abi: ReputationCreditAbi,
        functionName: "liquidate",
        args: [agentId],
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
  }, [account, agentId, props.creditAddress, publicClient, refresh]);

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
          {shares !== null ? (
            <span className="text-(--color-muted)">
              {" "}
              · {formatUnits(shares, 6)} shares
            </span>
          ) : null}
          {isAgent ? <span className="ml-2 pill pill-warn">agent</span> : null}
        </p>
      )}

      <NetworkBanner
        requiredHexId={SEPOLIA_HEX_ID}
        requiredName="Sepolia"
        visible={!!account && !chainOk}
        onSwitch={requestSwitch}
        busy={busy !== null}
      />

      <div className="space-y-2 pb-4 border-b border-(--color-rule)">
        <p className="tag">instruct the agent (server-signed)</p>
        <p className="text-xs text-(--color-muted) max-w-2xl leading-relaxed">
          The credit contract requires <code>msg.sender</code> to equal the
          agent&apos;s identity-registry wallet. In production the agent&apos;s
          runtime decides when to draw credit; for the demo, these buttons send
          the borrow/repay transaction signed by <code>AGENT_PK</code>{" "}
          server-side — no MetaMask required, but the on-chain caller is still
          the agent.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text"
            value={agentBorrowAmount}
            onChange={(e) => setAgentBorrowAmount(e.target.value)}
            disabled={busy !== null || props.hasOpenLoan}
            className="w-20"
          />
          <span className="tag">USDC</span>
          <button
            onClick={onAgentBorrow}
            disabled={busy !== null || props.hasOpenLoan}
            className="btn btn-primary"
          >
            ask agent to borrow →
          </button>
          {props.hasOpenLoan ? (
            <span className="text-xs text-(--color-muted)">
              agent already has an open loan — repay first
            </span>
          ) : null}
        </div>
        {props.hasOpenLoan ? (
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              value={agentRepayAmount}
              onChange={(e) => setAgentRepayAmount(e.target.value)}
              disabled={busy !== null}
              className="w-20"
            />
            <span className="tag">USDC</span>
            <button
              onClick={onAgentRepay}
              disabled={busy !== null}
              className="btn"
            >
              ask agent to repay →
            </button>
          </div>
        ) : null}
      </div>

      {account && chainOk ? (
        <>
          <div className="space-y-2">
            <p className="tag">lender (you · any EOA)</p>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="text"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                disabled={busy !== null}
                className="w-20"
              />
              <span className="tag">USDC</span>
              <button
                onClick={onDeposit}
                disabled={busy !== null}
                className="btn btn-primary"
              >
                deposit →
              </button>
              <button
                onClick={onWithdraw}
                disabled={busy !== null || !shares || shares === 0n}
                className="btn"
              >
                withdraw all
              </button>
            </div>
          </div>

          {isAgent ? (
            <div className="space-y-2 pt-3 border-t border-(--color-rule)">
              <p className="tag">borrower · connected as agent EOA</p>
              {!props.hasOpenLoan ? (
                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    type="text"
                    value={borrowAmount}
                    onChange={(e) => setBorrowAmount(e.target.value)}
                    disabled={busy !== null}
                    className="w-20"
                  />
                  <span className="tag">USDC</span>
                  <button
                    onClick={onBorrow}
                    disabled={busy !== null}
                    className="btn btn-primary"
                  >
                    borrow →
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    type="text"
                    value={repayAmount}
                    onChange={(e) => setRepayAmount(e.target.value)}
                    disabled={busy !== null}
                    className="w-20"
                  />
                  <span className="tag">USDC</span>
                  <button
                    onClick={onRepay}
                    disabled={busy !== null}
                    className="btn btn-primary"
                  >
                    repay →
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {props.isLiquidatable ? (
            <div className="pt-3 border-t border-(--color-rule) flex items-center gap-3 flex-wrap">
              <span className="text-xs text-(--color-amber)">
                liquidatable — feedback dropped below threshold
              </span>
              <button
                onClick={onLiquidate}
                disabled={busy !== null}
                className="ml-auto btn btn-danger"
              >
                liquidate
              </button>
            </div>
          ) : null}
        </>
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
