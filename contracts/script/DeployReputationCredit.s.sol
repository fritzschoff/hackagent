// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {ReputationCredit} from "../src/ReputationCredit.sol";

/// @notice Phase 10 — uncollateralized USDC credit market backed by ERC-8004
/// reputation. Deploys against the existing v1 IdentityRegistry +
/// ReputationRegistry on Sepolia (where feedback events live).
///
/// Broadcasts via PRICEWATCH_PK (the wallet with Sepolia gas).
contract DeployReputationCredit is Script {
    /// Circle Sepolia USDC.
    address constant SEPOLIA_USDC =
        0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function run() external {
        uint256 pk = vm.envUint("PRICEWATCH_PK");
        address identity = vm.envAddress("IDENTITY_REGISTRY");
        address reputation = vm.envAddress("REPUTATION_REGISTRY");

        vm.startBroadcast(pk);
        ReputationCredit credit = new ReputationCredit(
            SEPOLIA_USDC,
            identity,
            reputation
        );
        vm.stopBroadcast();

        console.log("ReputationCredit       :", address(credit));
        console.log("IdentityRegistry (v1)  :", identity);
        console.log("ReputationRegistry (v1):", reputation);
        console.log("USDC                   :", SEPOLIA_USDC);

        string memory json = string.concat(
            '{"network":"sepolia","chainId":11155111,',
            '"reputationCredit":"',
            vm.toString(address(credit)),
            '","identityRegistry":"',
            vm.toString(identity),
            '","reputationRegistry":"',
            vm.toString(reputation),
            '","usdc":"',
            vm.toString(SEPOLIA_USDC),
            '"}'
        );
        vm.writeFile("deployments/sepolia-credit.json", json);
        console.log("Wrote deployments/sepolia-credit.json");
    }
}
