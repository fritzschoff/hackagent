// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IIdentityRegistryView {
    struct Agent {
        uint256 agentId;
        string agentDomain;
        address agentAddress;
        address agentWallet;
        uint256 registeredAt;
        bool active;
    }
    function getAgent(uint256 agentId) external view returns (Agent memory);
}

interface IReputationRegistryView {
    function feedbackCount(uint256 agentId) external view returns (uint256);
}

/// @notice Uncollateralized USDC credit line backed solely by an agent's
/// ERC-8004 feedback count. The first real DeFi primitive built on top of
/// EIP-8004 reputation — reputation has a measurable, financeable value.
///
/// Borrow rules:
///   creditLimit = min(feedbackCount × CREDIT_PER_FEEDBACK, pool / 10)
///   - lenders deposit USDC; pool/10 is the per-loan cap so a single agent
///     can never drain the pool.
/// Repay: anyone can repay any agent's loan partially or fully.
/// Liquidation: when an agent's feedback drops below 80% of its
/// borrow-time count, anyone can call liquidate() — the loan is flagged
/// defaulted, lenders take the loss pro-rata, and lender redemption value
/// drops accordingly. The agent retains the borrowed USDC; reputation is
/// the on-chain ramification.
contract ReputationCredit is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDC;
    IIdentityRegistryView public immutable IDENTITY;
    IReputationRegistryView public immutable REPUTATION;

    /// USDC (6 decimals) of credit per feedback event. 5_000_000 = $5/event.
    uint256 public constant CREDIT_PER_FEEDBACK = 5_000_000;
    /// Liquidation kicks in when current feedback drops below
    /// (borrowedAtFeedback × this) / 100. 80 = drops more than 20%.
    uint256 public constant LIQUIDATION_THRESHOLD_PCT = 80;
    /// Minimum feedback count to be eligible for any loan.
    uint256 public constant MIN_FEEDBACK = 5;

    struct Loan {
        uint256 principal;
        uint64 borrowedAt;
        uint64 borrowedAtFeedback;
        bool defaulted;
    }

    /// agentId -> loan
    mapping(uint256 => Loan) public loans;

    /// LP shares: simple deposit -> share map. principal-only accounting
    /// (no interest accrual for the demo); defaults reduce per-share NAV.
    uint256 public totalShares;
    uint256 public totalLent;
    mapping(address => uint256) public sharesOf;

    event Deposited(address indexed lender, uint256 amount, uint256 shares);
    event Withdrawn(address indexed lender, uint256 amount, uint256 shares);
    event Borrowed(
        uint256 indexed agentId,
        address indexed agentAddress,
        uint256 amount,
        uint256 feedbackAtBorrow
    );
    event Repaid(
        uint256 indexed agentId,
        address indexed payer,
        uint256 amount
    );
    event Liquidated(
        uint256 indexed agentId,
        uint256 outstanding,
        uint256 currentFeedback,
        uint256 borrowedAtFeedback
    );

    constructor(
        address usdc,
        address identityRegistry,
        address reputationRegistry
    ) {
        USDC = IERC20(usdc);
        IDENTITY = IIdentityRegistryView(identityRegistry);
        REPUTATION = IReputationRegistryView(reputationRegistry);
    }

    // -- Lender side -----------------------------------------------------

    /// NAV per share = (USDC.balanceOf(this) + totalLent) / totalShares.
    /// On default, totalLent is decremented (writedown) without USDC
    /// returning, so each share is worth less.
    function totalAssets() public view returns (uint256) {
        return USDC.balanceOf(address(this)) + totalLent;
    }

    function previewDepositShares(
        uint256 amount
    ) public view returns (uint256) {
        if (totalShares == 0 || totalAssets() == 0) return amount;
        return (amount * totalShares) / totalAssets();
    }

    function previewRedeemAmount(
        uint256 shares
    ) public view returns (uint256) {
        if (totalShares == 0) return 0;
        return (shares * totalAssets()) / totalShares;
    }

    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "zero");
        uint256 shares = previewDepositShares(amount);
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        totalShares += shares;
        sharesOf[msg.sender] += shares;
        emit Deposited(msg.sender, amount, shares);
    }

    function withdraw(uint256 shares) external nonReentrant {
        require(shares > 0 && shares <= sharesOf[msg.sender], "shares");
        uint256 amount = previewRedeemAmount(shares);
        // Cap amount to free liquidity (we cannot pull from outstanding loans).
        uint256 free = USDC.balanceOf(address(this));
        require(amount <= free, "insufficient liquidity");
        sharesOf[msg.sender] -= shares;
        totalShares -= shares;
        USDC.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, shares);
    }

    // -- Borrower side ---------------------------------------------------

    function creditLimit(uint256 agentId) public view returns (uint256) {
        uint256 fb = REPUTATION.feedbackCount(agentId);
        if (fb < MIN_FEEDBACK) return 0;
        uint256 cap = fb * CREDIT_PER_FEEDBACK;
        uint256 free = USDC.balanceOf(address(this));
        uint256 perLoanCap = free / 10;
        return cap < perLoanCap ? cap : perLoanCap;
    }

    function borrow(uint256 agentId, uint256 amount) external nonReentrant {
        IIdentityRegistryView.Agent memory a = IDENTITY.getAgent(agentId);
        require(a.agentId == agentId, "unknown agent");
        require(a.active, "agent inactive");
        require(msg.sender == a.agentAddress, "not agent");
        Loan storage l = loans[agentId];
        require(l.principal == 0, "loan exists");
        uint256 fb = REPUTATION.feedbackCount(agentId);
        uint256 limit = creditLimit(agentId);
        require(amount > 0 && amount <= limit, "exceeds limit");

        l.principal = amount;
        l.borrowedAt = uint64(block.timestamp);
        l.borrowedAtFeedback = uint64(fb);
        l.defaulted = false;

        totalLent += amount;
        USDC.safeTransfer(a.agentWallet, amount);
        emit Borrowed(agentId, a.agentAddress, amount, fb);
    }

    function repay(uint256 agentId, uint256 amount) external nonReentrant {
        Loan storage l = loans[agentId];
        require(l.principal > 0, "no loan");
        require(amount > 0 && amount <= l.principal, "amount");
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        l.principal -= amount;
        totalLent -= amount;
        if (l.principal == 0) {
            // Loan fully cleared; reset state.
            delete loans[agentId];
        }
        emit Repaid(agentId, msg.sender, amount);
    }

    function isLiquidatable(
        uint256 agentId
    ) public view returns (bool, uint256) {
        Loan storage l = loans[agentId];
        if (l.principal == 0 || l.defaulted) return (false, 0);
        uint256 current = REPUTATION.feedbackCount(agentId);
        uint256 floor = (uint256(l.borrowedAtFeedback) *
            LIQUIDATION_THRESHOLD_PCT) / 100;
        return (current < floor, current);
    }

    function liquidate(uint256 agentId) external nonReentrant {
        Loan storage l = loans[agentId];
        require(l.principal > 0, "no loan");
        require(!l.defaulted, "already defaulted");
        (bool ok, uint256 current) = isLiquidatable(agentId);
        require(ok, "not liquidatable");
        l.defaulted = true;
        // Writedown: pool acknowledges the loss, NAV per share drops.
        uint256 outstanding = l.principal;
        totalLent -= outstanding;
        l.principal = 0;
        emit Liquidated(
            agentId,
            outstanding,
            current,
            l.borrowedAtFeedback
        );
    }
}
