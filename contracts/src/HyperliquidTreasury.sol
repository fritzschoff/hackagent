// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {L1Read} from "./L1Read.sol";
import {HyperliquidActions} from "./HyperliquidActions.sol";

/// @notice M2 treasury for the Tradewise funding-rate strategy, native
/// to HyperEVM. Replaces the M1 MockPerpExchange + TradingTreasury pair
/// when the strategy lives on HL.
///
/// Architecture (HL_FACTS.md §3):
///   - Treasury contract at 0xTREASURY on HyperEVM IS a HyperCore
///     account at 0xTREASURY. Orders submitted via CoreWriter are
///     attributed to it; positions/balances are read back via L1Read
///     precompiles.
///   - USDC ledgers are SEPARATE: the HyperEVM ERC-20 (native USDC
///     at 0xb883…630f mainnet) is a different ledger from the HL spot
///     account. To move ERC-20 → spot, plain `transfer()` to the
///     **system address** `0x20…00 || tokenIndexBE` (USDC = index 0
///     → `0x2000…0000`). To move spot → perp, CoreWriter
///     `usdClassTransfer` (action 7). The treasury does ERC-20 → spot
///     in `depositToSpot`, spot ↔ perp in `moveToPerp` / `moveToSpot`.
///   - Single asset per treasury for M2 (the strategy still uses one
///     pair). `asset` is set at deploy and immutable.
///
/// Trust model: same as M1. Off-chain agent EOA opens/closes via the
/// agent-only paths, and a KeeperHub kill-switch watches the
/// heartbeat; if it goes stale anyone can call `emergencyExit`, which
/// reduces the HL position with a market IOC, moves margin back to
/// spot, and forwards the on-treasury USDC to the splitter so
/// shareholders can claim.
contract HyperliquidTreasury is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDC;
    address public immutable splitter;

    /// HL perp asset index (e.g. 1 = ETH on mainnet at time of writing).
    uint32 public immutable asset;

    /// System address for USDC token index 0. Plain ERC-20 `transfer()`
    /// to this address bridges balance from HyperEVM → the contract's
    /// HyperCore spot account. The reverse path is the `spotSend` L1
    /// action (not yet wired — D1 dividend cycle uses off-chain
    /// `withdraw3` instead).
    address public constant USDC_SYSTEM_ADDRESS =
        0x2000000000000000000000000000000000000000;

    address public agent;
    address public owner;

    /// 6h default mirrors TradingTreasury; both treasuries are watched
    /// by the same KeeperHub kill-switch shape.
    uint64 public heartbeatTimeout = 6 hours;
    uint64 public lastHeartbeat;
    bool public killed;

    // Note: no synthetic position state. HL is the source of truth via
    // L1Read.position(this, asset); maintaining a parallel positionId
    // inside the contract created divergence opportunities on every
    // partial fill (audit M1). The strategy + dashboard read HL directly.

    event Funded(address indexed from, uint256 amount);
    event BridgedErc20ToSpot(uint256 amount);
    event BridgedToPerp(uint64 amount);
    event BridgedToSpot(uint64 amount);
    event PositionOpenSubmitted(
        bool isBuy,
        uint64 limitPx,
        uint64 size,
        uint8 tif
    );
    event PositionCloseSubmitted(uint64 limitPx, uint64 sizeAtSubmit);
    event CloseOrderSubmitFailed();
    event PerpSweepInitiated(uint64 amount);
    event PerpSweepFailed();
    event SpotSwept(uint256 amount);
    event RevenueDistributed(uint256 amount);
    event Heartbeat(uint64 timestamp);
    event EmergencyExited(address indexed by, uint256 returned, string reason);
    event AgentRotated(address indexed oldAgent, address indexed newAgent);
    event HeartbeatTimeoutChanged(uint64 newTimeout);
    event Killed();

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "not agent");
        _;
    }

    modifier notKilled() {
        require(!killed, "killed");
        _;
    }

    constructor(
        address usdc_,
        address splitter_,
        address agent_,
        uint32 asset_
    ) {
        require(usdc_ != address(0), "usdc zero");
        require(splitter_ != address(0), "splitter zero");
        require(agent_ != address(0), "agent zero");
        USDC = IERC20(usdc_);
        splitter = splitter_;
        agent = agent_;
        asset = asset_;
        owner = msg.sender;
        lastHeartbeat = uint64(block.timestamp);
    }

    // ─── funding ─────────────────────────────────────────────────────────

    /// Pull USDC into the treasury from `msg.sender`. Founder seeds the
    /// strategy this way; the future cross-chain bridge route from
    /// AgentShares on Base into HyperEVM USDC also lands here. Blocked
    /// once killed so funds aren't trapped in a dead contract — deploy
    /// a fresh treasury for the next strategy instead.
    function fund(uint256 amount) external notKilled {
        require(amount > 0, "zero");
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    // ─── HyperEVM → HyperCore spot ───────────────────────────────────────

    /// Move USDC from the treasury's HyperEVM ERC-20 balance into the
    /// treasury's HyperCore spot account. The mechanism is a plain
    /// ERC-20 `transfer()` to the USDC system address — HL credits the
    /// caller's spot ledger based on the emitted `Transfer` event.
    /// Async on the HL side; the next `L1Read.spotBalance` reflects it.
    function depositToSpot(uint256 amount) external onlyAgent notKilled {
        require(amount > 0, "zero");
        USDC.safeTransfer(USDC_SYSTEM_ADDRESS, amount);
        emit BridgedErc20ToSpot(amount);
        _heartbeat();
    }

    // ─── HL spot ↔ perp routing ──────────────────────────────────────────

    /// Move USDC from the treasury's HL spot ledger into perp margin so
    /// the next order has room. Caller must have already bridged the
    /// HyperEVM USDC ERC-20 into spot via `depositToSpot`; HL spot and
    /// HyperEVM ERC-20 are SEPARATE ledgers.
    function moveToPerp(uint64 amount) external onlyAgent notKilled {
        require(amount > 0, "zero");
        HyperliquidActions.send(
            HyperliquidActions.encodeUsdClassTransfer(amount, true)
        );
        emit BridgedToPerp(amount);
        _heartbeat();
    }

    /// Reverse — perp margin back to spot. Agent calls this before
    /// distributing revenue, since `distributeRevenue` operates against
    /// the HyperEVM ERC-20.
    function moveToSpot(uint64 amount) external onlyAgent {
        require(amount > 0, "zero");
        HyperliquidActions.send(
            HyperliquidActions.encodeUsdClassTransfer(amount, false)
        );
        emit BridgedToSpot(amount);
        _heartbeat();
    }

    // ─── trading ─────────────────────────────────────────────────────────

    /// Submit a limit order to HL. Does NOT block on HL fill — order may
    /// rest or be rejected; the caller (strategy + dashboard) reads
    /// L1Read.position() to confirm what actually opened.
    function openPosition(
        bool isBuy,
        uint64 limitPx,
        uint64 size,
        uint8 tif
    ) external onlyAgent notKilled nonReentrant {
        require(size > 0 && limitPx > 0, "zero params");
        require(
            tif == HyperliquidActions.TIF_GTC ||
                tif == HyperliquidActions.TIF_IOC ||
                tif == HyperliquidActions.TIF_ALO,
            "bad tif"
        );
        // No on-contract double-open guard: HL is the source of truth.
        // The strategy is the only legitimate caller and it reads
        // L1Read.position before deciding. A theoretical same-EVM-block
        // double-fire would be rejected at the HL margin level on the
        // second order.
        bytes memory action = HyperliquidActions.encodeLimitOrder(
            asset,
            isBuy,
            limitPx,
            size,
            false,
            tif,
            0
        );
        HyperliquidActions.send(action);
        emit PositionOpenSubmitted(isBuy, limitPx, size, tif);
        _heartbeat();
    }

    /// Submit a reduce-only IOC to close the agent's HL position.
    /// Direction + size come from L1Read.position — that is the only
    /// source of truth for what's actually open. If the precompile says
    /// flat, the call reverts; otherwise we submit a close of the full
    /// reported size. HL processes asynchronously so the order may
    /// partial-fill or get rejected — the strategy reads L1Read on the
    /// next tick to know.
    function closePosition(
        uint64 limitPx
    ) external onlyAgent nonReentrant {
        require(limitPx > 0, "zero px");
        L1Read.Position memory pos = L1Read.position(address(this), asset);
        require(pos.szi != 0, "no position");
        bool isBuy = pos.szi < 0; // buy to close short, sell to close long
        uint64 size = pos.szi < 0
            ? uint64(uint256(int256(-pos.szi)))
            : uint64(uint256(int256(pos.szi)));
        bytes memory action = HyperliquidActions.encodeLimitOrder(
            asset,
            isBuy,
            limitPx,
            size,
            true,
            HyperliquidActions.TIF_IOC,
            0
        );
        HyperliquidActions.send(action);
        emit PositionCloseSubmitted(limitPx, size);
        _heartbeat();
    }

    // ─── revenue ─────────────────────────────────────────────────────────

    /// Forward `amount` of the treasury's HyperEVM-USDC to the splitter.
    /// Agent calls this on the cadence the KeeperHub dividend workflow
    /// drives. Funds must already be on the spot ledger (= ERC-20 balance);
    /// call `moveToSpot` first if margin needs to be pulled back.
    function distributeRevenue(uint256 amount) external onlyAgent nonReentrant {
        require(amount > 0, "zero");
        require(USDC.balanceOf(address(this)) >= amount, "insufficient");
        USDC.safeTransfer(splitter, amount);
        emit RevenueDistributed(amount);
        _heartbeat();
    }

    // ─── heartbeat + kill switch ─────────────────────────────────────────

    function heartbeat() external onlyAgent {
        _heartbeat();
    }

    function _heartbeat() internal {
        uint64 nowTs = uint64(block.timestamp);
        lastHeartbeat = nowTs;
        emit Heartbeat(nowTs);
    }

    function heartbeatStale() public view returns (bool) {
        return block.timestamp > lastHeartbeat + heartbeatTimeout;
    }

    /// Anyone can call once heartbeat is stale; owner can call any time.
    /// Closes the HL position (best-effort IOC with the supplied
    /// `closeLimitPx`), kills the contract, and forwards every free
    /// USDC to the splitter so shareholders can claim. If the HL close
    /// fails (no liquidity, HL down), the contract still kills and
    /// drains — the HL position remains open and the operator can
    /// reconcile manually post-mortem.
    ///
    /// `closeLimitPx` should be a generous slippage price (e.g. for a
    /// short, the highest tolerable buy price). The kill-switch
    /// KeeperHub workflow supplies this from the current oracle price
    /// at trip time.
    function emergencyExit(
        uint64 closeLimitPx,
        string calldata reason
    ) external nonReentrant {
        bool isOwner = msg.sender == owner;
        require(isOwner || heartbeatStale(), "not authorized");

        if (closeLimitPx > 0) {
            // Both the precompile read AND the order submit are wrapped
            // so a paused HL / out-of-liquidity venue / unstable precompile
            // cannot wedge the kill. If the close order can't go in, the
            // contract still kills + drains; the HL position remains open
            // for manual reconciliation post-mortem.
            (L1Read.Position memory pos, bool readOk) = _tryReadPosition();
            if (readOk && pos.szi != 0) {
                bool isBuy = pos.szi < 0;
                uint64 size = pos.szi < 0
                    ? uint64(uint256(int256(-pos.szi)))
                    : uint64(uint256(int256(pos.szi)));
                bytes memory closeAction = HyperliquidActions.encodeLimitOrder(
                    asset,
                    isBuy,
                    closeLimitPx,
                    size,
                    true,
                    HyperliquidActions.TIF_IOC,
                    0
                );
                try this._sendActionExt(closeAction) {
                    // close submitted
                } catch {
                    emit CloseOrderSubmitFailed();
                }
            }
        }

        // Best-effort sweep of the perp ledger → spot ledger. HL processes
        // the usdClassTransfer action asynchronously, so the funds DON'T
        // arrive in this tx. After HL settles, anyone can call sweepSpot()
        // to forward them to the splitter. The kill itself never blocks
        // on this — if the read or the submit fails, we move on.
        (uint64 perpAvail, bool perpReadOk) = _tryReadWithdrawable();
        if (perpReadOk && perpAvail > 0) {
            bytes memory moveAction = HyperliquidActions.encodeUsdClassTransfer(
                perpAvail,
                false // perp → spot
            );
            try this._sendActionExt(moveAction) {
                emit PerpSweepInitiated(perpAvail);
            } catch {
                emit PerpSweepFailed();
            }
        }

        killed = true;
        emit Killed();

        uint256 bal = USDC.balanceOf(address(this));
        if (bal > 0) {
            USDC.safeTransfer(splitter, bal);
            emit RevenueDistributed(bal);
        }
        emit EmergencyExited(msg.sender, bal, reason);
    }

    /// Permissionless drain of any USDC that arrived on the spot ledger
    /// AFTER `emergencyExit` killed the contract. The perp → spot sweep
    /// initiated by `emergencyExit` processes asynchronously on HL; the
    /// USDC lands one HyperCore block later. Anyone can call this to
    /// finish the sweep without waiting for the operator (who's
    /// presumably the thing that failed in the first place).
    function sweepSpot() external nonReentrant {
        require(killed, "not killed");
        uint256 bal = USDC.balanceOf(address(this));
        require(bal > 0, "nothing to sweep");
        USDC.safeTransfer(splitter, bal);
        emit SpotSwept(bal);
    }

    /// Wrap L1Read.position in a try/catch so emergencyExit cannot be
    /// blocked by a precompile revert.
    function _tryReadPosition()
        internal
        view
        returns (L1Read.Position memory, bool)
    {
        try this._readPositionExt() returns (L1Read.Position memory p) {
            return (p, true);
        } catch {
            L1Read.Position memory zero;
            return (zero, false);
        }
    }

    /// External wrapper purely to make L1Read.position try/catch-able.
    function _readPositionExt() external view returns (L1Read.Position memory) {
        return L1Read.position(address(this), asset);
    }

    /// Wrap L1Read.withdrawable in try/catch so emergencyExit cannot be
    /// blocked by a precompile revert.
    function _tryReadWithdrawable() internal view returns (uint64, bool) {
        try this._readWithdrawableExt() returns (uint64 w) {
            return (w, true);
        } catch {
            return (0, false);
        }
    }

    function _readWithdrawableExt() external view returns (uint64) {
        return L1Read.withdrawable(address(this));
    }

    /// External wrapper purely to make HyperliquidActions.send try/catch-able.
    /// `onlySelf` so external callers can't broadcast arbitrary actions.
    function _sendActionExt(bytes calldata action) external {
        require(msg.sender == address(this), "only self");
        HyperliquidActions.send(action);
    }

    // ─── admin ───────────────────────────────────────────────────────────

    function rotateAgent(address newAgent) external onlyOwner {
        require(newAgent != address(0), "zero");
        address old = agent;
        agent = newAgent;
        emit AgentRotated(old, newAgent);
    }

    function setHeartbeatTimeout(uint64 secs) external onlyOwner {
        require(secs >= 1 hours && secs <= 7 days, "out of range");
        heartbeatTimeout = secs;
        emit HeartbeatTimeoutChanged(secs);
    }

    function kill() external onlyOwner {
        killed = true;
        emit Killed();
    }

    // ─── views (passthroughs to L1Read precompiles) ──────────────────────

    function oraclePx() external view returns (uint64) {
        return L1Read.oraclePx(asset);
    }

    function markPx() external view returns (uint64) {
        return L1Read.markPx(asset);
    }

    function hlPosition() external view returns (L1Read.Position memory) {
        return L1Read.position(address(this), asset);
    }

    function marginSummary()
        external
        view
        returns (L1Read.AccountMarginSummary memory)
    {
        return L1Read.accountMarginSummary(address(this), 0);
    }
}
