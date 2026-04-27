// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {SlaBond} from "../src/SlaBond.sol";

/// @notice Phase 11 — slashable USDC bonds for agent SLAs. Deploys on Sepolia
/// (where the validator wallet operates) using PRICEWATCH_PK for gas.
contract DeploySlaBond is Script {
    /// Circle Sepolia USDC.
    address constant SEPOLIA_USDC =
        0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function run() external {
        uint256 pk = vm.envUint("PRICEWATCH_PK");
        address validator = vm.envAddress("VALIDATOR_ADDR");

        vm.startBroadcast(pk);
        SlaBond bond = new SlaBond(SEPOLIA_USDC, validator);
        vm.stopBroadcast();

        console.log("SlaBond   :", address(bond));
        console.log("USDC      :", SEPOLIA_USDC);
        console.log("Validator :", validator);

        string memory json = string.concat(
            '{"network":"sepolia","chainId":11155111,',
            '"slaBond":"',
            vm.toString(address(bond)),
            '","usdc":"',
            vm.toString(SEPOLIA_USDC),
            '","validator":"',
            vm.toString(validator),
            '"}'
        );
        vm.writeFile("deployments/sepolia-sla.json", json);
        console.log("Wrote deployments/sepolia-sla.json");
    }
}
