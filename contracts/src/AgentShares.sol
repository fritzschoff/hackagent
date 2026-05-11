// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IRevenueSplitter {
    function syncOnTransfer(address from, address to) external;
}

/// @notice Fractional ownership of a tradewise INFT's future revenue.
///
/// Fixed supply minted at deploy. Holders accrue claimable x402 USDC pro-rata
/// via the linked RevenueSplitter. Transferable like any ERC-20 — that is the
/// crux of the "Agent IPO" pitch: the agent is a publicly-tradeable autonomous
/// business.
///
/// Because the splitter uses a per-share accumulator that depends on accurate
/// balance snapshots, every transfer notifies the splitter BEFORE balances
/// change. The splitter address is wired post-deploy (it depends on the shares
/// address) via a one-shot `setSplitter`.
contract AgentShares is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 10_000 * 1e18;

    address public immutable agentInft;
    uint256 public immutable agentTokenId;

    address public immutable deployer;
    address public splitter;

    event SplitterSet(address indexed splitter);

    constructor(
        address mintTo,
        address agentInft_,
        uint256 agentTokenId_
    ) ERC20("Tradewise Shares", "TRADE") {
        require(mintTo != address(0), "mintTo zero");
        agentInft = agentInft_;
        agentTokenId = agentTokenId_;
        deployer = msg.sender;
        _mint(mintTo, TOTAL_SUPPLY);
    }

    /// One-shot wiring of the revenue splitter. Must be called by the
    /// deployer immediately after deploying the splitter, before any
    /// transfers happen. Without this, no holder accrues revenue.
    function setSplitter(address splitter_) external {
        require(msg.sender == deployer, "not deployer");
        require(splitter == address(0), "already set");
        require(splitter_ != address(0), "splitter zero");
        splitter = splitter_;
        emit SplitterSet(splitter_);
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        address s = splitter;
        if (s != address(0)) {
            IRevenueSplitter(s).syncOnTransfer(from, to);
        }
        super._update(from, to, value);
    }
}
