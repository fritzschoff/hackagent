// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fixed-price primary issuance for Tradewise Shares.
///
/// Demo flow: deployer pre-funds this contract with X shares from their
/// AgentShares balance. Anyone can then buy shares at `pricePerShareUsdc`
/// (USDC, 6 decimals) until the on-contract pool is depleted. Buys are
/// minimum 1 whole share to keep the math obvious for judges.
///
/// Proceeds (USDC paid by buyers) accumulate at the deployer's address —
/// it's an *issuance*, not a treasury raise.
contract SharesSale is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable SHARES;
    IERC20 public immutable USDC;
    uint256 public immutable pricePerShareUsdc;
    address public immutable deployer;

    /// 1e18 = 1 share token (since AgentShares has 18 decimals).
    uint256 public constant ONE_SHARE = 1e18;

    event Purchase(
        address indexed buyer,
        uint256 sharesAmount,
        uint256 usdcPaid
    );
    event Withdrawn(address indexed to, uint256 sharesAmount);

    constructor(
        address shares,
        address usdc,
        uint256 pricePerShareUsdc_
    ) {
        require(pricePerShareUsdc_ > 0, "price zero");
        SHARES = IERC20(shares);
        USDC = IERC20(usdc);
        pricePerShareUsdc = pricePerShareUsdc_;
        deployer = msg.sender;
    }

    function sharesAvailable() public view returns (uint256) {
        return SHARES.balanceOf(address(this));
    }

    /// @param wholeShares number of whole shares to buy (>=1).
    function buy(uint256 wholeShares) external nonReentrant {
        require(wholeShares > 0, "zero");
        uint256 amount = wholeShares * ONE_SHARE;
        require(SHARES.balanceOf(address(this)) >= amount, "insufficient pool");
        uint256 cost = wholeShares * pricePerShareUsdc;
        // Buyer must have approved USDC to this contract for >= cost.
        USDC.safeTransferFrom(msg.sender, deployer, cost);
        SHARES.safeTransfer(msg.sender, amount);
        emit Purchase(msg.sender, amount, cost);
    }

    /// @notice Deployer can pull back unsold shares once the sale window is
    /// over. Useful for the demo: judges can buy a few during the window,
    /// remaining go back to the deployer.
    function withdrawShares(uint256 amount) external {
        require(msg.sender == deployer, "not deployer");
        SHARES.safeTransfer(deployer, amount);
        emit Withdrawn(deployer, amount);
    }
}
