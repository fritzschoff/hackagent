// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {AgentMerger} from "../src/AgentMerger.sol";

/// @notice Phase 12 — agent M&A. Deploys against existing v1 ReputationRegistry
/// (where feedback events live) and the AgentINFT (Phase 3). Merger contract
/// has no privileged role; it just records lineage and holds INFT custody.
contract DeployAgentMerger is Script {
    function run() external {
        uint256 pk = vm.envUint("PRICEWATCH_PK");
        address identityV1 = vm.envAddress("IDENTITY_REGISTRY");
        address reputation = vm.envAddress("REPUTATION_REGISTRY");
        address inft = vm.envAddress("INFT_ADDRESS");

        vm.startBroadcast(pk);
        AgentMerger merger = new AgentMerger(identityV1, reputation, inft);
        vm.stopBroadcast();

        console.log("AgentMerger        :", address(merger));
        console.log("IdentityRegistry v1:", identityV1);
        console.log("ReputationRegistry :", reputation);
        console.log("AgentINFT          :", inft);

        string memory json = string.concat(
            '{"network":"sepolia","chainId":11155111,',
            '"agentMerger":"',
            vm.toString(address(merger)),
            '","identityRegistry":"',
            vm.toString(identityV1),
            '","reputationRegistry":"',
            vm.toString(reputation),
            '","inft":"',
            vm.toString(inft),
            '"}'
        );
        vm.writeFile("deployments/sepolia-merger.json", json);
        console.log("Wrote deployments/sepolia-merger.json");
    }
}
