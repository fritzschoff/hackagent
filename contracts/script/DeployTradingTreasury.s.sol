// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {TradingTreasury} from "../src/TradingTreasury.sol";
import {MockPerpExchange} from "../src/MockPerpExchange.sol";

/// @notice M1 deployment of the funding-rate arb stack on Base Sepolia.
///
/// Deploys MockPerpExchange (stub of a Hyperliquid-style perp venue) and
/// TradingTreasury, then writes the addresses to deployments/base-sepolia-treasury.json.
/// Real Hyperliquid integration replaces MockPerpExchange in M2.
contract DeployTradingTreasury is Script {
    address constant BASE_SEPOLIA_USDC =
        0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        uint256 pk = vm.envUint("AGENT_PK");
        address agent = vm.addr(pk);
        // Splitter from the redeployed IPO trio (base-sepolia-ipo.json).
        address splitter = vm.envAddress("REVENUE_SPLITTER_ADDRESS");

        vm.startBroadcast(pk);
        MockPerpExchange exchange = new MockPerpExchange(BASE_SEPOLIA_USDC);
        TradingTreasury treasury = new TradingTreasury(
            BASE_SEPOLIA_USDC,
            address(exchange),
            splitter,
            agent
        );
        vm.stopBroadcast();

        console.log("Agent (broadcaster)     :", agent);
        console.log("MockPerpExchange        :", address(exchange));
        console.log("TradingTreasury         :", address(treasury));
        console.log("RevenueSplitter (linked):", splitter);
        console.log("USDC                    :", BASE_SEPOLIA_USDC);

        _writeJson(address(exchange), address(treasury), splitter, agent);
    }

    function _writeJson(
        address exchange,
        address treasury,
        address splitter,
        address agent
    ) internal {
        string memory part1 = string.concat(
            '{"network":"base-sepolia","chainId":84532,',
            '"mockPerpExchange":"',
            vm.toString(exchange),
            '","tradingTreasury":"',
            vm.toString(treasury)
        );
        string memory part2 = string.concat(
            '","revenueSplitter":"',
            vm.toString(splitter),
            '","agent":"',
            vm.toString(agent),
            '","usdc":"',
            vm.toString(BASE_SEPOLIA_USDC),
            '"}'
        );
        vm.writeFile(
            "deployments/base-sepolia-treasury.json",
            string.concat(part1, part2)
        );
        console.log("Wrote deployments/base-sepolia-treasury.json");
    }
}
