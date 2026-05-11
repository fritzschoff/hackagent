// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IShareToken {
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/// @notice Pull-pattern USDC splitter for Tradewise Shares holders.
///
/// USDC accrues at this address from x402 settlements (and any other inbound
/// transfer). Holders claim their pro-rata share of revenue via a
/// MasterChef-style cumulative accumulator: every share earns the same
/// `accPerShare` over its lifetime, and a holder's claim is the delta between
/// the current `accPerShare` and the value snapshotted at their last interaction.
///
/// Because AgentShares are freely transferable, the linked share token MUST
/// call `syncOnTransfer(from, to)` from its `_update` hook before balances
/// change. That snapshots each side's accrual against their pre-transfer
/// balance, so revenue stays with whoever held shares at the moment it landed
/// — never paid twice, never re-routed by a transfer.
contract RevenueSplitter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Scaling factor for accPerShare. With 6-decimal USDC and 18-decimal
    /// shares, the smallest meaningful per-share accrual is ~1e-12, so 1e30
    /// of headroom keeps rounding loss below 1 wei of USDC per share.
    uint256 private constant ACC_PRECISION = 1e30;

    IERC20 public immutable USDC;
    IShareToken public immutable SHARES;

    /// Cumulative revenue per share (scaled by ACC_PRECISION).
    uint256 public accPerShareStored;
    /// USDC balance observed the last time accPerShareStored was updated.
    /// Used to attribute new inflows since then.
    uint256 public lastBalance;
    /// Cumulative USDC ever paid out.
    uint256 public totalReleased;

    /// Per-holder snapshot of accPerShare at the last sync.
    mapping(address => uint256) public userAccPerShare;
    /// Per-holder unclaimed accrual carried over from prior balances.
    mapping(address => uint256) public pending;

    event Claimed(address indexed holder, uint256 amount);

    constructor(address shares, address usdc) {
        SHARES = IShareToken(shares);
        USDC = IERC20(usdc);
    }

    /// Cumulative USDC ever received by this contract.
    function totalReceived() public view returns (uint256) {
        return USDC.balanceOf(address(this)) + totalReleased;
    }

    /// Refresh `accPerShareStored` from any new USDC that arrived since the
    /// last sync. Idempotent and safe to call from view contexts via
    /// `_currentAccPerShare`.
    function _syncGlobal() internal {
        uint256 supply = SHARES.totalSupply();
        if (supply == 0) return;
        uint256 bal = USDC.balanceOf(address(this));
        if (bal > lastBalance) {
            accPerShareStored += ((bal - lastBalance) * ACC_PRECISION) / supply;
            lastBalance = bal;
        }
    }

    /// Pure view of what accPerShareStored would be after `_syncGlobal`.
    function _currentAccPerShare() internal view returns (uint256) {
        uint256 supply = SHARES.totalSupply();
        if (supply == 0) return accPerShareStored;
        uint256 bal = USDC.balanceOf(address(this));
        if (bal <= lastBalance) return accPerShareStored;
        return
            accPerShareStored + ((bal - lastBalance) * ACC_PRECISION) / supply;
    }

    /// Snapshot `holder`'s outstanding accrual against their current balance
    /// and bring their userAccPerShare in line with the global accumulator.
    /// Called on claim and on every share transfer (via `syncOnTransfer`).
    function _accrue(address holder) internal {
        uint256 acc = accPerShareStored;
        uint256 last = userAccPerShare[holder];
        if (acc > last) {
            uint256 bal = SHARES.balanceOf(holder);
            if (bal > 0) {
                pending[holder] += (bal * (acc - last)) / ACC_PRECISION;
            }
            userAccPerShare[holder] = acc;
        }
    }

    /// USDC currently claimable by `holder`. Includes both already-carried
    /// `pending` and any unrealized accrual from new USDC since their last
    /// sync.
    function claimable(address holder) public view returns (uint256) {
        uint256 acc = _currentAccPerShare();
        uint256 last = userAccPerShare[holder];
        uint256 due = pending[holder];
        if (acc > last) {
            uint256 bal = SHARES.balanceOf(holder);
            if (bal > 0) {
                due += (bal * (acc - last)) / ACC_PRECISION;
            }
        }
        return due;
    }

    function claim() external nonReentrant returns (uint256) {
        _syncGlobal();
        _accrue(msg.sender);
        uint256 amount = pending[msg.sender];
        require(amount > 0, "nothing to claim");
        pending[msg.sender] = 0;
        totalReleased += amount;
        USDC.safeTransfer(msg.sender, amount);
        // lastBalance must track USDC.balanceOf(this) so future `_syncGlobal`
        // calls correctly attribute *new* inflows only.
        lastBalance = USDC.balanceOf(address(this));
        emit Claimed(msg.sender, amount);
        return amount;
    }

    /// Called by the linked AgentShares token from its `_update` hook BEFORE
    /// balances change, so each side's accrual is snapshotted against their
    /// pre-transfer balance. Without this, sellers forfeit unclaimed revenue
    /// to buyers — the bug this contract was rewritten to fix.
    function syncOnTransfer(address from, address to) external {
        require(msg.sender == address(SHARES), "only shares");
        _syncGlobal();
        if (from != address(0)) _accrue(from);
        if (to != address(0)) _accrue(to);
    }
}
