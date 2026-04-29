"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseUnits,
  formatUnits,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import AgentBidsAbi from "@/lib/abis/AgentBids.json";
import NetworkBanner from "@/components/network-banner";
import DelegationButton from "@/components/delegation-button";
import TransferModal from "@/components/transfer-modal";

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

const ERC721_ABI = [
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

const MAX_UINT256 = (1n << 256n) - 1n;
const SEPOLIA_HEX_ID = "0xaa36a7";

// Delegation expires 7 days from now by default
const DELEGATION_TTL_SECS = 7 * 24 * 60 * 60;

function extractError(err: unknown): string {
  if (err && typeof err === "object") {
    const r = err as { shortMessage?: string; message?: string };
    return r.shortMessage ?? r.message ?? String(err);
  }
  return String(err);
}

/**
 * Build the seller-sig nonce: 48 random bytes = 96 hex chars.
 */
function randomNonce(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}` as Hex;
}

type StandingBid = {
  bidder: Address;
  amount: string;
};

type Props = {
  tokenId: string;
  bidsAddress: Address;
  inftAddress: Address;
  usdcAddress: Address;
  inftOwner: Address;
  /** Oracle address from INFT.ORACLE() — used for the delegation sig. */
  oracleAddress: Address | null;
  rpcUrl?: string;
  standingBids: StandingBid[];
};

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export default function BidControls(props: Props) {
  const tokenId = BigInt(props.tokenId);
  const standingBids: { bidder: Address; amount: bigint }[] = props.standingBids.map(
    (b) => ({ bidder: b.bidder, amount: BigInt(b.amount) }),
  );

  const [account, setAccount] = useState<Address | null>(null);
  const [chainOk, setChainOk] = useState<boolean>(false);
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [bidAmount, setBidAmount] = useState<string>("0.50");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<Hex | null>(null);

  // Delegation state for the place-bid flow
  const [delegationSig, setDelegationSig] = useState<Hex | null>(null);
  const [delegationExpiresAt, setDelegationExpiresAt] = useState<number>(
    () => Math.floor(Date.now() / 1000) + DELEGATION_TTL_SECS,
  );

  // Transfer modal state
  const [modalBidder, setModalBidder] = useState<Address | null>(null);
  const [sellerNonce, setSellerNonce] = useState<Hex>(() => randomNonce());

  const isOwner = account
    ? account.toLowerCase() === props.inftOwner.toLowerCase()
    : false;
  const myBid = account
    ? standingBids.find((b) => b.bidder.toLowerCase() === account.toLowerCase())
    : undefined;

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: sepolia,
        transport: props.rpcUrl ? http(props.rpcUrl) : http(),
      }),
    [props.rpcUrl],
  );

  const refreshBalance = useCallback(
    async (addr: Address) => {
      try {
        const bal = (await publicClient.readContract({
          address: props.usdcAddress,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [addr],
        })) as bigint;
        setUsdcBalance(bal);
      } catch {
        setUsdcBalance(null);
      }
    },
    [publicClient, props.usdcAddress],
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
      setChainOk(chainId.toLowerCase() === SEPOLIA_HEX_ID);
      if (chainId.toLowerCase() !== SEPOLIA_HEX_ID) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: SEPOLIA_HEX_ID }],
          });
          setChainOk(true);
        } catch (switchErr) {
          setError(
            `wrong network. switch to Sepolia. (${(switchErr as Error).message})`,
          );
        }
      }
      await refreshBalance(addr);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [refreshBalance]);

  useEffect(() => {
    if (window.ethereum?.on) {
      window.ethereum.on("accountsChanged", (...args: unknown[]) => {
        const accounts = args[0] as string[];
        const next = (accounts[0] ?? null) as Address | null;
        setAccount(next);
        if (next) refreshBalance(next);
      });
      window.ethereum.on("chainChanged", (...args: unknown[]) => {
        const id = args[0] as string;
        setChainOk(id.toLowerCase() === SEPOLIA_HEX_ID);
      });
    }
  }, [refreshBalance]);

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
      const current = (await publicClient.readContract({
        address: props.usdcAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [addr, props.bidsAddress],
      })) as bigint;
      if (current >= amount) return;
      setBusy("approving USDC…");
      const tx = await walletClient.writeContract({
        address: props.usdcAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [props.bidsAddress, MAX_UINT256],
        chain: sepolia,
        account: addr,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
    },
    [publicClient, props.usdcAddress, props.bidsAddress],
  );

  const ensureInftApproval = useCallback(
    async (
      walletClient: ReturnType<typeof createWalletClient>,
      addr: Address,
    ) => {
      const ok = (await publicClient.readContract({
        address: props.inftAddress,
        abi: ERC721_ABI,
        functionName: "isApprovedForAll",
        args: [addr, props.bidsAddress],
      })) as boolean;
      if (ok) return;
      setBusy("approving INFT transfer…");
      const tx = await walletClient.writeContract({
        address: props.inftAddress,
        abi: ERC721_ABI,
        functionName: "setApprovalForAll",
        args: [props.bidsAddress, true],
        chain: sepolia,
        account: addr,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
    },
    [publicClient, props.inftAddress, props.bidsAddress],
  );

  /**
   * placeBid — new signature: placeBid(tokenId, amount, delegationExpiresAt, delegationSig).
   * Flow: DelegationButton signs first → then USDC approval → then placeBid.
   */
  const onPlace = useCallback(async () => {
    if (!account) return;
    if (!window.ethereum) return;
    if (!delegationSig) {
      setError("sign the delegation first");
      return;
    }
    setError(null);
    setLastTx(null);
    try {
      const amount = parseUnits(bidAmount, 6);
      if (amount === 0n) throw new Error("amount is zero");
      const walletClient = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum),
      });
      await ensureAllowance(walletClient, account, amount);
      setBusy("placing bid…");
      const tx = await walletClient.writeContract({
        address: props.bidsAddress,
        abi: AgentBidsAbi,
        functionName: "placeBid",
        args: [tokenId, amount, BigInt(delegationExpiresAt), delegationSig],
        account,
        chain: sepolia,
      });
      setLastTx(tx);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await refreshBalance(account);
      setDelegationSig(null); // reset for next bid
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  }, [
    account,
    bidAmount,
    delegationSig,
    delegationExpiresAt,
    ensureAllowance,
    props.bidsAddress,
    publicClient,
    refreshBalance,
    tokenId,
  ]);

  const onWithdraw = useCallback(async () => {
    if (!account || !window.ethereum) return;
    setError(null);
    setLastTx(null);
    try {
      const walletClient = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum),
      });
      setBusy("withdrawing…");
      const tx = await walletClient.writeContract({
        address: props.bidsAddress,
        abi: AgentBidsAbi,
        functionName: "withdrawBid",
        args: [tokenId],
        account,
        chain: sepolia,
      });
      setLastTx(tx);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await refreshBalance(account);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  }, [account, props.bidsAddress, publicClient, refreshBalance, tokenId]);

  /** Open the TransferModal for the chosen bidder. */
  const openModal = useCallback((bidder: Address) => {
    setSellerNonce(randomNonce());
    setModalBidder(bidder);
    setError(null);
  }, []);

  const oracleAddr = props.oracleAddress;

  return (
    <>
      {/* Transfer modal */}
      {modalBidder && account ? (
        <TransferModal
          tokenId={tokenId}
          bidder={modalBidder}
          bidsAddress={props.bidsAddress}
          account={account}
          sellerNonce={sellerNonce}
          onClose={() => setModalBidder(null)}
          onComplete={() => {
            setModalBidder(null);
            setLastTx(null);
          }}
        />
      ) : null}

      <div className="card-flat space-y-4">
        {!account ? (
          <button
            onClick={handleConnect}
            className="btn btn-primary"
            data-testid="connect-wallet"
          >
            connect wallet →
          </button>
        ) : (
          <p className="text-xs font-mono">
            <span className="text-(--color-fg)">
              {account.slice(0, 6)}…{account.slice(-4)}
            </span>
            {usdcBalance !== null ? (
              <span className="text-(--color-muted)">
                {" "}
                · {formatUnits(usdcBalance, 6)} USDC
              </span>
            ) : null}
            {isOwner ? (
              <span className="ml-2 pill pill-warn">owner</span>
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

        {account && chainOk ? (
          <>
            {!isOwner ? (
              <div className="space-y-3">
                {/* Step 1: Delegation signature */}
                {oracleAddr ? (
                  <div className="space-y-1">
                    <p className="text-xs text-(--color-muted)">
                      step 1 — authorize the oracle to re-encrypt on transfer
                    </p>
                    {delegationSig ? (
                      <p className="text-xs text-(--color-accent) font-mono">
                        delegation signed ✓
                      </p>
                    ) : (
                      <DelegationButton
                        tokenId={tokenId}
                        oracle={oracleAddr}
                        expiresAt={delegationExpiresAt}
                        inftAddress={props.inftAddress}
                        account={account}
                        onSigned={(sig) => setDelegationSig(sig)}
                        disabled={busy !== null}
                      />
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-(--color-muted) italic">
                    oracle not set on this INFT — delegation skipped
                  </p>
                )}

                {/* Step 2: Place bid */}
                <div className="space-y-1">
                  <p className="text-xs text-(--color-muted)">
                    step 2 — place bid
                  </p>
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      type="text"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                      disabled={busy !== null}
                      className="w-24"
                      data-testid="bid-amount"
                    />
                    <span className="tag">USDC</span>
                    <button
                      onClick={onPlace}
                      disabled={busy !== null || (!oracleAddr ? false : !delegationSig)}
                      className="btn btn-primary"
                      data-testid="place-bid"
                    >
                      {myBid ? "top up →" : "place bid →"}
                    </button>
                    {myBid ? (
                      <button
                        onClick={onWithdraw}
                        disabled={busy !== null}
                        className="btn"
                      >
                        withdraw {formatUnits(myBid.amount, 6)}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : standingBids.length === 0 ? (
              <p className="text-xs text-(--color-muted) italic">
                no standing bids yet — wait for a bidder
              </p>
            ) : (
              <ul className="space-y-1">
                {standingBids.map((b) => (
                  <li
                    key={b.bidder}
                    className="flex items-center gap-2 text-xs font-mono py-1 border-b border-(--color-rule) last:border-0"
                  >
                    <span>
                      {b.bidder.slice(0, 6)}…{b.bidder.slice(-4)}
                    </span>
                    <span className="display-italic text-base text-(--color-accent)">
                      ${formatUnits(b.amount, 6)}
                    </span>
                    <button
                      onClick={() => openModal(b.bidder)}
                      disabled={busy !== null}
                      className="ml-auto btn btn-primary"
                      data-testid="accept-bid"
                    >
                      accept →
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
    </>
  );
}
