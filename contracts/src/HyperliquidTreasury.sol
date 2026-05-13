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
///   - USDC custody assumes HyperEVM-USDC ≡ HL-spot-USDC (the standard
///     HL mapping). Treasury holds the ERC-20 on HyperEVM; moving
///     between the spot and perp ledgers happens via
///     `usdClassTransfer` (action 7).
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

    /// HL perp asset index (e.g. 4 = ETH on testnet at time of writing).
    uint32 public immutable asset;

    address public agent;
    address public owner;

    /// 6h default mirrors TradingTreasury; both treasuries are watched
    /// by the same KeeperHub kill-switch shape.
    uint64 public heartbeatTimeout = 6 hours;
    uint64 public lastHeartbeat;
    bool public killed;

    /// Synthetic position id. HL is asset-indexed, not position-indexed,
    /// so we hash (asset, openedAt, side, size) to give the agent a
    /// stable handle. `bytes32(0)` means flat. Source of truth for the
    /// actual size is always `L1Read.position(this, asset)` — `szi`
    /// there can lag the synthetic state by one HyperEVM block.
    bytes32 public positionId;
    uint64 public positionOpenedAt;

    event Funded(address indexed from, uint256 amount);
    event BridgedToPerp(uint64 amount);
    event BridgedToSpot(uint64 amount);
    event PositionOpened(
        bytes32 indexed positionId,
        bool isBuy,
        uint64 limitPx,
        uint64 size,
        uint8 tif
    );
    event PositionClosed(bytes32 indexed positionId, uint64 limitPx);
    event CloseOrderSubmitFailed(bytes32 indexed positionId);
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
    /// AgentShares on Base into HyperEVM USDC also lands here.
    function fund(uint256 amount) external {
        require(amount > 0, "zero");
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    // ─── HL spot ↔ perp routing ──────────────────────────────────────────

    /// Move USDC from the treasury's HL spot ledger into perp margin so
    /// the next order has room. Caller must have already deposited the
    /// HyperEVM USDC ERC-20 (via `fund`); HL treats the contract's spot
    /// ledger as equal to the ERC-20 balance.
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

    /// Submit a limit order to HL. Returns the synthetic positionId the
    /// agent and dashboard can use as a handle. Does NOT block on HL fill
    /// — order may rest or be rejected; check L1Read.position() to confirm.
    function openPosition(
        bool isBuy,
        uint64 limitPx,
        uint64 size,
        uint8 tif
    )
        external
        onlyAgent
        notKilled
        nonReentrant
        returns (bytes32)
    {
        require(positionId == bytes32(0), "position open");
        require(size > 0 && limitPx > 0, "zero params");
        require(
            tif == HyperliquidActions.TIF_GTC ||
                tif == HyperliquidActions.TIF_IOC ||
                tif == HyperliquidActions.TIF_ALO,
            "bad tif"
        );
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

        uint64 nowTs = uint64(block.timestamp);
        bytes32 pid = keccak256(
            abi.encode(asset, nowTs, isBuy, size, limitPx)
        );
        positionId = pid;
        positionOpenedAt = nowTs;
        emit PositionOpened(pid, isBuy, limitPx, size, tif);
        _heartbeat();
        return pid;
    }

    /// Close the open position via a reduce-only IOC. Reads current HL
    /// size from the precompile to determine direction + size, so this
    /// works even if the synthetic state lags a partial fill.
    function closePosition(
        uint64 limitPx
    ) external onlyAgent nonReentrant returns (bytes32) {
        require(positionId != bytes32(0), "no position");
        require(limitPx > 0, "zero px");
        L1Read.Position memory pos = L1Read.position(address(this), asset);
        require(pos.szi != 0, "HL position empty");
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
        bytes32 pid = positionId;
        positionId = bytes32(0);
        positionOpenedAt = 0;
        emit PositionClosed(pid, limitPx);
        _heartbeat();
        return pid;
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

        if (positionId != bytes32(0) && closeLimitPx > 0) {
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
                    emit CloseOrderSubmitFailed(positionId);
                }
            }
            positionId = bytes32(0);
            positionOpenedAt = 0;
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
