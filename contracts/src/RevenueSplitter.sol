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
/// transfer). At claim time the contract computes each holder's pro-rata
/// share of *cumulative* received USDC and pays out the difference vs.
/// previously released. Mirrors OZ PaymentSplitter, adapted for ERC-20.
///
/// Note: a holder selling shares between claims forfeits unclaimed accrual
/// to the new owner — claims should be called before transfers to avoid
/// surprise. (UI surfaces a "claim before transfer" hint.)
contract RevenueSplitter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDC;
    IShareToken public immutable SHARES;

    uint256 public totalReleased;
    mapping(address => uint256) public released;

    event Claimed(address indexed holder, uint256 amount);

    constructor(address shares, address usdc) {
        SHARES = IShareToken(shares);
        USDC = IERC20(usdc);
    }

    /// @return Cumulative USDC ever received by this contract (current
    /// balance + already-released).
    function totalReceived() public view returns (uint256) {
        return USDC.balanceOf(address(this)) + totalReleased;
    }

    function claimable(address holder) public view returns (uint256) {
        uint256 supply = SHARES.totalSupply();
        if (supply == 0) return 0;
        uint256 entitled = (totalReceived() * SHARES.balanceOf(holder)) /
            supply;
        if (entitled <= released[holder]) return 0;
        return entitled - released[holder];
    }

    function claim() external nonReentrant returns (uint256) {
        uint256 amount = claimable(msg.sender);
        require(amount > 0, "nothing to claim");
        released[msg.sender] += amount;
        totalReleased += amount;
        USDC.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
        return amount;
    }
}
