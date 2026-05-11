// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPerpExchange {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function openPosition(
        int256 size,
        uint256 collateral
    ) external returns (bytes32 positionId);
    function closePosition(bytes32 positionId) external returns (int256 pnl);
    function fundingRatePerSecond() external view returns (int256);
    function collateralOf(address) external view returns (uint256);
}

/// @notice M1 funding-rate arb treasury for the Tradewise agent.
///
/// Custodies USDC, delegates trade execution to an agent EOA against a perp
/// exchange interface (Hyperliquid-style in production, MockPerpExchange in
/// tests/sepolia). Realized P&L can be streamed to the RevenueSplitter so
/// shareholders earn pro-rata yield. A heartbeat-based kill-switch lets
/// anyone force the treasury to exit and return funds to shareholders if
/// the agent goes silent for more than `heartbeatTimeout` seconds — this is
/// the load-bearing safety primitive the KeeperHub round-two pitch hangs on.
///
/// Single-position model for M1. Multi-position is M4.
contract TradingTreasury is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDC;
    address public immutable splitter;

    IPerpExchange public exchange;
    address public agent;
    address public owner;

    /// Maximum seconds the agent can go without pinging before anyone can
    /// trigger `emergencyExit`. The 6h default matches the brief's
    /// dead-man's-switch story.
    uint64 public heartbeatTimeout = 6 hours;
    uint64 public lastHeartbeat;

    /// Once true, no new positions can be opened. Existing position can
    /// still be closed and funds withdrawn.
    bool public killed;

    /// Open position state. positionId == 0 means flat.
    bytes32 public positionId;
    int256 public positionSize;
    uint256 public positionCollateral;

    event Funded(address indexed from, uint256 amount);
    event Heartbeat(uint64 timestamp);
    event PositionOpened(
        bytes32 indexed positionId,
        int256 size,
        uint256 collateral
    );
    event PositionClosed(bytes32 indexed positionId, int256 pnl);
    event RevenueDistributed(uint256 amount);
    event EmergencyExited(address indexed by, uint256 returned, string reason);
    event AgentRotated(address indexed oldAgent, address indexed newAgent);
    event ExchangeRotated(address indexed oldExchange, address indexed newExchange);
    event Killed();
    event HeartbeatTimeoutChanged(uint64 newTimeout);

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
        address exchange_,
        address splitter_,
        address agent_
    ) {
        require(usdc_ != address(0), "usdc zero");
        require(exchange_ != address(0), "exchange zero");
        require(splitter_ != address(0), "splitter zero");
        require(agent_ != address(0), "agent zero");
        USDC = IERC20(usdc_);
        exchange = IPerpExchange(exchange_);
        splitter = splitter_;
        agent = agent_;
        owner = msg.sender;
        lastHeartbeat = uint64(block.timestamp);
    }

    // ─── funding ────────────────────────────────────────────────────────

    /// Pull USDC into the treasury. Caller (typically the founder or the
    /// future treasury-aware SharesSale) must approve first.
    function fund(uint256 amount) external {
        require(amount > 0, "zero");
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    // ─── trading (agent-only, requires heartbeat freshness) ─────────────

    /// Move USDC from the treasury into exchange collateral.
    function depositToExchange(uint256 amount) external onlyAgent notKilled {
        require(amount > 0, "zero");
        USDC.forceApprove(address(exchange), amount);
        exchange.deposit(amount);
        _heartbeat();
    }

    /// Pull collateral back from the exchange into the treasury.
    function withdrawFromExchange(uint256 amount) external onlyAgent {
        require(amount > 0, "zero");
        exchange.withdraw(amount);
        _heartbeat();
    }

    /// Open the single arb position. `size > 0` long, `size < 0` short
    /// (perp exchange convention). Reverts if a position is already open.
    function openPosition(
        int256 size,
        uint256 collateral
    ) external onlyAgent notKilled nonReentrant returns (bytes32) {
        require(positionId == bytes32(0), "position open");
        require(size != 0, "zero size");
        bytes32 pid = exchange.openPosition(size, collateral);
        positionId = pid;
        positionSize = size;
        positionCollateral = collateral;
        emit PositionOpened(pid, size, collateral);
        _heartbeat();
        return pid;
    }

    /// Close the open position. Returns the realized P&L (signed; positive
    /// means treasury gained collateral on the exchange's books). Funds are
    /// not yet pulled back to the treasury — call `withdrawFromExchange`
    /// next to repatriate them.
    function closePosition()
        external
        onlyAgent
        nonReentrant
        returns (int256 pnl)
    {
        bytes32 pid = positionId;
        require(pid != bytes32(0), "no position");
        pnl = exchange.closePosition(pid);
        positionId = bytes32(0);
        positionSize = 0;
        positionCollateral = 0;
        emit PositionClosed(pid, pnl);
        _heartbeat();
    }

    /// Forward `amount` of free treasury USDC to the splitter so it flows
    /// pro-rata to shareholders. Agent decides cadence + amount; in M1 this
    /// is manual / KeeperHub-driven, in M3 it could be policy-bound (e.g.
    /// "distribute 50% of realized P&L every 7 days").
    function distributeRevenue(uint256 amount) external onlyAgent nonReentrant {
        require(amount > 0, "zero");
        require(USDC.balanceOf(address(this)) >= amount, "insufficient");
        USDC.safeTransfer(splitter, amount);
        emit RevenueDistributed(amount);
        _heartbeat();
    }

    // ─── heartbeat / kill-switch ────────────────────────────────────────

    /// Ping the heartbeat without any other action. Agent should call this
    /// from a KeeperHub workflow on a regular cadence even when there's no
    /// trade activity.
    function heartbeat() external onlyAgent {
        _heartbeat();
    }

    function _heartbeat() internal {
        uint64 now64 = uint64(block.timestamp);
        lastHeartbeat = now64;
        emit Heartbeat(now64);
    }

    /// True iff `block.timestamp - lastHeartbeat > heartbeatTimeout`.
    function heartbeatStale() public view returns (bool) {
        return block.timestamp > lastHeartbeat + heartbeatTimeout;
    }

    /// Anyone can call this when the heartbeat is stale; owner can call it
    /// any time. Closes the open position (if any), pulls all exchange
    /// collateral back into the treasury, and forwards every free USDC to
    /// the splitter so shareholders can claim their pro-rata share. After
    /// emergency exit, the treasury is killed — no further trading.
    function emergencyExit(string calldata reason) external nonReentrant {
        bool isOwner = msg.sender == owner;
        require(isOwner || heartbeatStale(), "not authorized");

        if (positionId != bytes32(0)) {
            int256 pnl = exchange.closePosition(positionId);
            emit PositionClosed(positionId, pnl);
            positionId = bytes32(0);
            positionSize = 0;
            positionCollateral = 0;
        }

        uint256 onExchange = exchange.collateralOf(address(this));
        if (onExchange > 0) {
            exchange.withdraw(onExchange);
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

    // ─── admin ──────────────────────────────────────────────────────────

    function rotateAgent(address newAgent) external onlyOwner {
        require(newAgent != address(0), "zero");
        address old = agent;
        agent = newAgent;
        emit AgentRotated(old, newAgent);
    }

    function rotateExchange(address newExchange) external onlyOwner notKilled {
        require(newExchange != address(0), "zero");
        require(positionId == bytes32(0), "position open");
        address old = address(exchange);
        exchange = IPerpExchange(newExchange);
        emit ExchangeRotated(old, newExchange);
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
}
