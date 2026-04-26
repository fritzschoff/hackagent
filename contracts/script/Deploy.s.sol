// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {ValidationRegistry} from "../src/ValidationRegistry.sol";

contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("AGENT_PK");
        string memory domain = vm.envOr("AGENT_DOMAIN", string("tradewise.agentlab.eth"));
        address agentWallet = vm.addr(pk);

        vm.startBroadcast(pk);

        IdentityRegistry id = new IdentityRegistry();
        ReputationRegistry rep = new ReputationRegistry(address(id));
        ValidationRegistry val = new ValidationRegistry();

        uint256 agentId = id.register(domain, agentWallet);

        vm.stopBroadcast();

        console.log("AGENT_PK address (deployer + agent) :", agentWallet);
        console.log("IdentityRegistry                    :", address(id));
        console.log("ReputationRegistry                  :", address(rep));
        console.log("ValidationRegistry                  :", address(val));
        console.log("Registered agentId                  :", agentId);
        console.log("Agent domain                        :", domain);

        string memory json = string.concat(
            '{"network":"sepolia","chainId":11155111,',
            '"identityRegistry":"', vm.toString(address(id)), '",',
            '"reputationRegistry":"', vm.toString(address(rep)), '",',
            '"validationRegistry":"', vm.toString(address(val)), '",',
            '"agentId":', vm.toString(agentId), ",",
            '"agentDomain":"', domain, '",',
            '"agentWallet":"', vm.toString(agentWallet), '"}'
        );
        vm.writeFile("deployments/sepolia.json", json);
        console.log("Wrote deployments/sepolia.json");
    }
}
