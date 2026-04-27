// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {AgentShares} from "../src/AgentShares.sol";
import {RevenueSplitter} from "../src/RevenueSplitter.sol";
import {SharesSale} from "../src/SharesSale.sol";

/// @notice Deploys the Agent IPO trio on Base Sepolia.
///
/// Broadcasts via AGENT_PK because the agent's wallet is the founder of the
/// shares — it owns 100% of supply at deploy. Pre-funds the SharesSale with
/// SALE_POOL_SHARES whole shares at SHARES_PRICE_USDC each.
contract DeployAgentIPO is Script {
    /// Circle Base Sepolia USDC.
    address constant BASE_SEPOLIA_USDC =
        0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    /// 1e18 = 1 whole share since AgentShares uses 18 decimals.
    uint256 constant ONE_SHARE = 1e18;

    function run() external {
        uint256 pk = vm.envUint("AGENT_PK");
        address agentInft = vm.envOr(
            "INFT_ADDRESS",
            address(0x245217DA6beaafAae7257D3452632085dD084EB6)
        );
        uint256 agentTokenId = vm.envOr("INFT_TOKEN_ID", uint256(1));
        // $0.005 per share — 1k shares for $5 of demo USDC.
        uint256 pricePerShare = vm.envOr("SHARES_PRICE_USDC", uint256(5_000));
        uint256 saleShares = vm.envOr(
            "SALE_POOL_SHARES",
            uint256(1_000)
        );
        address founder = vm.addr(pk);

        vm.startBroadcast(pk);
        AgentShares shares = new AgentShares(founder, agentInft, agentTokenId);
        RevenueSplitter splitter = new RevenueSplitter(
            address(shares),
            BASE_SEPOLIA_USDC
        );
        SharesSale sale = new SharesSale(
            address(shares),
            BASE_SEPOLIA_USDC,
            pricePerShare
        );
        shares.transfer(address(sale), saleShares * ONE_SHARE);
        vm.stopBroadcast();

        console.log("Founder (broadcaster)   :", founder);
        console.log("AgentShares             :", address(shares));
        console.log("RevenueSplitter         :", address(splitter));
        console.log("SharesSale              :", address(sale));
        console.log("Sale pool (whole shares):", saleShares);
        console.log("Price (USDC, 6 dec)     :", pricePerShare);
        console.log("USDC                    :", BASE_SEPOLIA_USDC);

        _writeJson(
            address(shares),
            address(splitter),
            address(sale),
            founder,
            pricePerShare
        );
    }

    function _writeJson(
        address shares,
        address splitter,
        address sale,
        address founder,
        uint256 pricePerShare
    ) internal {
        string memory part1 = string.concat(
            '{"network":"base-sepolia","chainId":84532,',
            '"agentShares":"',
            vm.toString(shares),
            '","revenueSplitter":"',
            vm.toString(splitter),
            '","sharesSale":"',
            vm.toString(sale)
        );
        string memory part2 = string.concat(
            '","founder":"',
            vm.toString(founder),
            '","pricePerShareUsdc":',
            vm.toString(pricePerShare),
            ',"usdc":"',
            vm.toString(BASE_SEPOLIA_USDC),
            '"}'
        );
        vm.writeFile(
            "deployments/base-sepolia-ipo.json",
            string.concat(part1, part2)
        );
        console.log("Wrote deployments/base-sepolia-ipo.json");
    }
}
