// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {OffchainResolver} from "../src/OffchainResolver.sol";

/// @notice Deploys OffchainResolver to Sepolia and writes a deployment artifact.
///
/// Required env vars:
///   PRICEWATCH_PK          — deployer private key
///   INFT_GATEWAY_ADDRESS   — the gateway signer address (derive from INFT_GATEWAY_PK)
///
/// Optional env vars:
///   ENS_GATEWAY_BASE_URL   — base URL (default: https://hackagent-nine.vercel.app/api/ens-gateway)
///
/// Usage:
///   cd contracts
///   forge script script/DeployOffchainResolver.s.sol \
///     --rpc-url $SEPOLIA_RPC_URL \
///     --broadcast \
///     --verify
contract DeployOffchainResolver is Script {
    function run() external {
        uint256 pk = vm.envUint("PRICEWATCH_PK");
        address signer = vm.envAddress("INFT_GATEWAY_ADDRESS");
        string memory baseUrl = vm.envOr(
            "ENS_GATEWAY_BASE_URL",
            string("https://hackagent-nine.vercel.app/api/ens-gateway")
        );

        string[] memory urls = new string[](1);
        urls[0] = string.concat(baseUrl, "/{sender}/{data}.json");

        vm.startBroadcast(pk);
        OffchainResolver r = new OffchainResolver(urls, signer);
        vm.stopBroadcast();

        console.log("OffchainResolver:", address(r));
        console.log("Signer (gateway):", signer);
        console.log("URL:             ", urls[0]);

        // Write deployment artifact.
        string memory body = string.concat(
            '{"network":"sepolia","chainId":11155111,"offchainResolver":"',
            vm.toString(address(r)),
            '","signer":"', vm.toString(signer),
            '","gatewayUrl":"', urls[0], '"}'
        );
        vm.writeFile("deployments/sepolia-ens-resolver.json", body);
        console.log("Artifact written to deployments/sepolia-ens-resolver.json");
    }
}
