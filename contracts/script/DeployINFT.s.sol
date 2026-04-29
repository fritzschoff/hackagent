// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {IdentityRegistryV2} from "../src/IdentityRegistryV2.sol";
import {AgentINFT} from "../src/AgentINFT.sol";
import {AgentINFTVerifier} from "../src/AgentINFTVerifier.sol";

/// @notice Phase 3 — deploys IdentityRegistryV2 + AgentINFT, wires them together,
/// and registers the tradewise agent on v2 via registerByDeployer (so the
/// agent's primary EOA can be set without that key paying gas).
///
/// Broadcasts with PRICEWATCH_PK because we consolidated Sepolia gas there.
/// The TRADEWISE_ADDR env var sets the registered agentAddress; defaults to
/// 0x7a83678e330a0C565e6272498FFDF421621820A3 (the agent EOA from gen-wallets).
contract DeployINFT is Script {
    function run() external {
        uint256 pk = vm.envUint("PRICEWATCH_PK");
        address tradewiseAddress = vm.envOr(
            "TRADEWISE_ADDR",
            address(0x7a83678e330a0C565e6272498FFDF421621820A3)
        );
        string memory domain = vm.envOr(
            "AGENT_DOMAIN",
            string("tradewise.agentlab.eth")
        );
        string memory baseUri = vm.envOr(
            "INFT_BASE_URI",
            string("https://hackagent-nine.vercel.app/api/inft/")
        );

        address oracleAddr = vm.envOr("INFT_ORACLE_ADDRESS", address(0));
        require(oracleAddr != address(0), "set INFT_ORACLE_ADDRESS");

        vm.startBroadcast(pk);

        IdentityRegistryV2 reg = new IdentityRegistryV2();
        AgentINFTVerifier verifier = new AgentINFTVerifier(oracleAddr);
        AgentINFT inft = new AgentINFT(address(reg), baseUri, address(verifier), oracleAddr);
        reg.setInft(address(inft));

        // Register tradewise agentId=1 on V2. Pricewatch (deployer) calls
        // this on tradewise's behalf — agentAddress and agentWallet both
        // point at tradewise so x402 settlements still target the same EOA
        // until a transfer-induced clear/re-sign cycle.
        uint256 agentId = reg.registerByDeployer(
            tradewiseAddress,
            domain,
            tradewiseAddress
        );

        vm.stopBroadcast();

        address deployer = vm.addr(pk);
        console.log("Pricewatch (broadcaster + deployer) :", deployer);
        console.log("Tradewise agentAddress + agentWallet:", tradewiseAddress);
        console.log("IdentityRegistryV2                  :", address(reg));
        console.log("AgentINFT                           :", address(inft));
        console.log("Tradewise agentId on V2             :", agentId);
        console.log("Base URI                            :", baseUri);

        _writeDeploymentJson(
            address(reg),
            address(inft),
            address(verifier),
            oracleAddr,
            agentId,
            domain,
            tradewiseAddress,
            deployer,
            baseUri
        );
    }

    function _writeDeploymentJson(
        address reg,
        address inft,
        address verifier,
        address oracleAddr,
        uint256 agentId,
        string memory domain,
        address tradewiseAddress,
        address deployer,
        string memory baseUri
    ) internal {
        string memory part1 = string.concat(
            '{"network":"sepolia","chainId":11155111,',
            '"identityRegistryV2":"',
            vm.toString(reg),
            '","agentInft":"',
            vm.toString(inft),
            '","agentInftVerifier":"',
            vm.toString(verifier),
            '","inftOracle":"',
            vm.toString(oracleAddr),
            '","agentId":',
            vm.toString(agentId)
        );
        string memory part2 = string.concat(
            ',"agentDomain":"',
            domain,
            '","agentWallet":"',
            vm.toString(tradewiseAddress),
            '","deployer":"',
            vm.toString(deployer),
            '","baseUri":"',
            baseUri,
            '"}'
        );
        vm.writeFile(
            "deployments/sepolia-inft.json",
            string.concat(part1, part2)
        );
        console.log("Wrote deployments/sepolia-inft.json");
    }
}
