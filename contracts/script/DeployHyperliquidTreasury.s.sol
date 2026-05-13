// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {HyperliquidTreasury} from "../src/HyperliquidTreasury.sol";

/// @notice M2 deployment of HyperliquidTreasury on HyperEVM (chain 999).
///
/// HL is the venue itself — there is no MockPerpExchange counterpart on
/// HyperEVM; HyperliquidTreasury talks to HyperCore directly via the
/// CoreWriter at 0x3333...3333 and L1Read precompiles at 0x0800+.
///
/// Required env:
///   AGENT_PK                  signer for the deploy + becomes the agent EOA
///   HL_USDC_ADDRESS           HyperEVM USDC ERC-20 (HyperEVM-USDC ≡ HL-spot-USDC)
///   HL_SPLITTER_ADDRESS       splitter the treasury forwards distributions to.
///                             For V2 single-chain testing this can be a
///                             scratch address; M3 wires the cross-chain
///                             dividend distributor as the splitter target.
///   HL_ASSET_INDEX            perp asset index from HL meta (e.g. ETH index).
///                             Immutable at deploy — re-deploy to change.
///
/// HYPE for gas is required on the broadcaster wallet. See HL_FACTS.md §8.
contract DeployHyperliquidTreasury is Script {
    function run() external {
        uint256 pk = vm.envUint("AGENT_PK");
        address agent = vm.addr(pk);
        address usdc = vm.envAddress("HL_USDC_ADDRESS");
        address splitter = vm.envAddress("HL_SPLITTER_ADDRESS");
        uint32 asset = uint32(vm.envUint("HL_ASSET_INDEX"));

        vm.startBroadcast(pk);
        HyperliquidTreasury treasury = new HyperliquidTreasury(
            usdc,
            splitter,
            agent,
            asset
        );
        vm.stopBroadcast();

        console.log("Agent (broadcaster)   :", agent);
        console.log("HyperliquidTreasury   :", address(treasury));
        console.log("USDC (HyperEVM)       :", usdc);
        console.log("Splitter (linked)     :", splitter);
        console.log("Asset index           :", asset);

        _writeJson(address(treasury), agent, usdc, splitter, asset);
    }

    function _writeJson(
        address treasury,
        address agent,
        address usdc,
        address splitter,
        uint32 asset
    ) internal {
        string memory part1 = string.concat(
            '{"network":"hyperevm","chainId":999,',
            '"hyperliquidTreasury":"',
            vm.toString(treasury),
            '","agent":"',
            vm.toString(agent)
        );
        string memory part2 = string.concat(
            '","usdc":"',
            vm.toString(usdc),
            '","splitter":"',
            vm.toString(splitter),
            '","asset":',
            vm.toString(uint256(asset)),
            '}'
        );
        vm.writeFile(
            "deployments/hyperevm-treasury.json",
            string.concat(part1, part2)
        );
        console.log("Wrote deployments/hyperevm-treasury.json");
    }
}
