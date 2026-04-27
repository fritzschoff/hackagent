// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fractional ownership of a tradewise INFT's future revenue.
///
/// Fixed supply minted at deploy. Holders accrue claimable x402 USDC pro-rata
/// via the linked RevenueSplitter. Transferable like any ERC-20 — that is the
/// crux of the "Agent IPO" pitch: the agent is a publicly-tradeable autonomous
/// business.
contract AgentShares is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 10_000 * 1e18;

    address public immutable agentInft;
    uint256 public immutable agentTokenId;

    constructor(
        address mintTo,
        address agentInft_,
        uint256 agentTokenId_
    ) ERC20("Tradewise Shares", "TRADE") {
        require(mintTo != address(0), "mintTo zero");
        agentInft = agentInft_;
        agentTokenId = agentTokenId_;
        _mint(mintTo, TOTAL_SUPPLY);
    }
}
