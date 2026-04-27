// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {ComplianceManifest} from "../src/ComplianceManifest.sol";

/// @notice Issue #6 — Compliance manifest registry on Sepolia. Reuses the
/// PRICEWATCH_PK gas wallet and the same validator address as SlaBond.
contract DeployComplianceManifest is Script {
    address constant SEPOLIA_USDC =
        0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function run() external {
        uint256 pk = vm.envUint("PRICEWATCH_PK");
        address validator = vm.envAddress("VALIDATOR_ADDR");

        vm.startBroadcast(pk);
        ComplianceManifest registry = new ComplianceManifest(
            SEPOLIA_USDC,
            validator
        );
        vm.stopBroadcast();

        console.log("ComplianceManifest:", address(registry));
        console.log("USDC              :", SEPOLIA_USDC);
        console.log("Validator         :", validator);

        string memory json = string.concat(
            '{"network":"sepolia","chainId":11155111,',
            '"complianceManifest":"',
            vm.toString(address(registry)),
            '","usdc":"',
            vm.toString(SEPOLIA_USDC),
            '","validator":"',
            vm.toString(validator),
            '"}'
        );
        vm.writeFile("deployments/sepolia-compliance.json", json);
        console.log("Wrote deployments/sepolia-compliance.json");
    }
}
