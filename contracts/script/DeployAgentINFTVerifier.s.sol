// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {AgentINFTVerifier} from "../src/AgentINFTVerifier.sol";

contract DeployAgentINFTVerifier is Script {
    function run() external {
        uint256 pk = vm.envUint("PRICEWATCH_PK");
        address oracle = vm.envAddress("INFT_ORACLE_ADDRESS");

        vm.startBroadcast(pk);
        AgentINFTVerifier v = new AgentINFTVerifier(oracle);
        vm.stopBroadcast();

        console.log("Verifier deployed:", address(v));
        console.log("Expected oracle:  ", oracle);

        string memory body = string.concat(
            '{"network":"sepolia","chainId":11155111,"verifier":"',
            vm.toString(address(v)),
            '","oracle":"', vm.toString(oracle), '"}'
        );
        vm.writeFile("deployments/sepolia-inft-verifier.json", body);
    }
}
