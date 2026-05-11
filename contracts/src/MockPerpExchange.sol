// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Stub perp exchange for M1 testnet plumbing.
///
/// Mimics the bare minimum of a Hyperliquid-style perp venue:
///   - per-trader collateral balance (USDC)
///   - single open position per trader (matches TradingTreasury M1 model)
///   - settable mark price + funding rate
///
/// P&L on close = price-PnL + funding-PnL. price-PnL is `size * (markPrice -
/// entryPrice)` and funding-PnL is `size * fundingRatePerSecond * duration`,
/// both rounded toward zero and capped against the position's collateral.
/// Real Hyperliquid integration replaces this contract entirely in M2.
contract MockPerpExchange {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDC;

    /// USDC base units (6 decimals) per asset unit. Owner sets this to
    /// simulate price moves. Default 1e6 means 1 USDC per asset unit.
    uint256 public markPrice = 1e6;
    /// USDC base units per asset unit per second. Positive = longs pay shorts.
    /// e.g. 278 ≈ $1/hr funding on a 1-unit (size=1e18) position.
    int256 public fundingRatePerSecond;
    address public owner;

    mapping(address => uint256) public collateralOf;

    struct Position {
        bool open;
        int256 size; // signed asset units
        uint256 collateral; // USDC base units
        uint256 entryPrice; // 1e18-scaled
        uint64 openedAt;
    }
    mapping(address => Position) public positions;
    mapping(bytes32 => address) public positionOwner;

    uint256 private nonce;

    event Deposited(address indexed trader, uint256 amount);
    event Withdrawn(address indexed trader, uint256 amount);
    event Opened(
        address indexed trader,
        bytes32 indexed positionId,
        int256 size,
        uint256 collateral,
        uint256 entryPrice
    );
    event Closed(
        address indexed trader,
        bytes32 indexed positionId,
        int256 pnl
    );
    event MarkPriceSet(uint256 markPrice);
    event FundingRateSet(int256 fundingRatePerSecond);

    constructor(address usdc_) {
        require(usdc_ != address(0), "usdc zero");
        USDC = IERC20(usdc_);
        owner = msg.sender;
    }

    function deposit(uint256 amount) external {
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        collateralOf[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        uint256 free = _freeCollateral(msg.sender);
        require(amount <= free, "exceeds free");
        collateralOf[msg.sender] -= amount;
        USDC.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function openPosition(
        int256 size,
        uint256 collateral
    ) external returns (bytes32 positionId) {
        require(size != 0, "zero size");
        Position storage p = positions[msg.sender];
        require(!p.open, "position open");
        require(collateral <= _freeCollateral(msg.sender), "exceeds free");

        nonce++;
        positionId = keccak256(abi.encode(msg.sender, nonce, block.timestamp));
        positions[msg.sender] = Position({
            open: true,
            size: size,
            collateral: collateral,
            entryPrice: markPrice,
            openedAt: uint64(block.timestamp)
        });
        positionOwner[positionId] = msg.sender;
        emit Opened(msg.sender, positionId, size, collateral, markPrice);
    }

    function closePosition(bytes32 positionId) external returns (int256 pnl) {
        address trader = positionOwner[positionId];
        require(trader == msg.sender, "not owner");
        Position memory p = positions[trader];
        require(p.open, "not open");

        pnl = _pnl(p);

        // Apply pnl to collateral, capped so trader collateral doesn't go
        // negative. Surplus pnl stays on the exchange as free collateral.
        if (pnl < 0) {
            uint256 loss = uint256(-pnl);
            if (loss >= collateralOf[trader]) {
                collateralOf[trader] = 0;
            } else {
                collateralOf[trader] -= loss;
            }
        } else if (pnl > 0) {
            collateralOf[trader] += uint256(pnl);
        }

        delete positions[trader];
        delete positionOwner[positionId];
        emit Closed(trader, positionId, pnl);
    }

    function _pnl(Position memory p) internal view returns (int256) {
        int256 priceDelta = int256(markPrice) - int256(p.entryPrice);
        int256 priceLeg = (p.size * priceDelta) / 1e18;

        uint256 duration = block.timestamp - p.openedAt;
        // Shorts (size < 0) receive funding when fundingRatePerSecond > 0.
        // Funding leg = -size * fundingRatePerSecond * duration / 1e18.
        int256 fundingLeg = (-p.size * fundingRatePerSecond * int256(duration)) / 1e18;

        return priceLeg + fundingLeg;
    }

    /// Free collateral = total deposited - collateral pledged to open position.
    function _freeCollateral(address trader) internal view returns (uint256) {
        uint256 total = collateralOf[trader];
        Position memory p = positions[trader];
        if (!p.open) return total;
        return total >= p.collateral ? total - p.collateral : 0;
    }

    // ─── admin (owner sets price + funding to simulate market) ──────────

    function setMarkPrice(uint256 newPrice) external {
        require(msg.sender == owner, "not owner");
        require(newPrice > 0, "zero price");
        markPrice = newPrice;
        emit MarkPriceSet(newPrice);
    }

    function setFundingRatePerSecond(int256 rate) external {
        require(msg.sender == owner, "not owner");
        fundingRatePerSecond = rate;
        emit FundingRateSet(rate);
    }
}
