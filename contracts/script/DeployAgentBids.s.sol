// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {AgentBids} from "../src/AgentBids.sol";

/// @notice Deploys the standing-bid pool against an already-deployed AgentINFT
/// and Sepolia USDC. Broadcaster is pricewatch (the wallet with Sepolia gas).
contract DeployAgentBids is Script {
    /// Circle Sepolia USDC, the canonical test token (https://faucet.circle.com).
    address constant SEPOLIA_USDC =
        0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function run() external {
        uint256 pk = vm.envUint("PRICEWATCH_PK");
        address inft = vm.envAddress("INFT_ADDRESS");

        vm.startBroadcast(pk);
        AgentBids bidPool = new AgentBids(inft, SEPOLIA_USDC);
        vm.stopBroadcast();

        console.log("AgentBids :", address(bidPool));
        console.log("INFT      :", inft);
        console.log("USDC      :", SEPOLIA_USDC);

        string memory json = string.concat(
            '{"network":"sepolia","chainId":11155111,',
            '"agentBids":"',
            vm.toString(address(bidPool)),
            '","inft":"',
            vm.toString(inft),
            '","usdc":"',
            vm.toString(SEPOLIA_USDC),
            '"}'
        );
        vm.writeFile("deployments/sepolia-bids.json", json);
        console.log("Wrote deployments/sepolia-bids.json");
    }
}
