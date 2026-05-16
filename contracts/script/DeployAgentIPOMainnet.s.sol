// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {AgentShares} from "../src/AgentShares.sol";
import {RevenueSplitter} from "../src/RevenueSplitter.sol";
import {SharesSale} from "../src/SharesSale.sol";

/// @notice Deploys the Agent IPO trio on Base mainnet.
///
/// Separation of concerns vs the Base Sepolia variant:
///   - Broadcaster (AGENT_PK = `0x7a83…20A3`) deploys + wires.
///   - Founder is a SEPARATE address (typically the operator's personal
///     wallet) that ends up holding the non-sale shares. Splitting
///     broadcaster from founder means a compromised agent EOA can't dump
///     the founder's stake.
///
/// At end-of-script:
///   - SharesSale holds `SALE_POOL_SHARES` whole shares
///   - FOUNDER holds `(TOTAL_SUPPLY/1e18) - SALE_POOL_SHARES` whole shares
///   - Broadcaster holds 0 shares
///
/// Required env:
///   AGENT_PK            broadcaster (deploys + briefly holds full supply)
///   FOUNDER             address that ends up holding the founder retainer
///   INFT_ADDRESS        ERC-7857 INFT this share class points at
///   INFT_TOKEN_ID       tokenId on INFT_ADDRESS
///   SHARES_PRICE_USDC   primary-sale price per share in 6-decimal USDC
///   SALE_POOL_SHARES    whole shares (without the 1e18) to fund the sale
///
/// Base mainnet USDC is hardcoded — Circle's canonical address there.
contract DeployAgentIPOMainnet is Script {
    /// Circle native USDC on Base mainnet.
    address constant BASE_MAINNET_USDC =
        0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    /// 1e18 = 1 whole share since AgentShares uses 18 decimals.
    uint256 constant ONE_SHARE = 1e18;

    function run() external {
        uint256 pk = vm.envUint("AGENT_PK");
        address founder = vm.envAddress("FOUNDER");
        address agentInft = vm.envAddress("INFT_ADDRESS");
        uint256 agentTokenId = vm.envUint("INFT_TOKEN_ID");
        uint256 pricePerShare = vm.envUint("SHARES_PRICE_USDC");
        uint256 saleShares = vm.envUint("SALE_POOL_SHARES");

        address broadcaster = vm.addr(pk);
        require(founder != address(0), "founder zero");
        require(founder != broadcaster, "founder == broadcaster (use sepolia script)");
        require(saleShares < 10_000, "saleShares exceeds total supply");

        vm.startBroadcast(pk);

        // Mint full supply to broadcaster atomically. Broadcaster will
        // redistribute within this same tx sequence; ends at zero.
        AgentShares shares = new AgentShares(broadcaster, agentInft, agentTokenId);
        RevenueSplitter splitter = new RevenueSplitter(
            address(shares),
            BASE_MAINNET_USDC
        );
        shares.setSplitter(address(splitter));
        SharesSale sale = new SharesSale(
            address(shares),
            BASE_MAINNET_USDC,
            pricePerShare
        );

        // Fund the sale pool.
        shares.transfer(address(sale), saleShares * ONE_SHARE);
        // Hand the rest to the founder address.
        uint256 founderShares = (10_000 - saleShares) * ONE_SHARE;
        shares.transfer(founder, founderShares);

        vm.stopBroadcast();

        console.log("Broadcaster             :", broadcaster);
        console.log("Founder                 :", founder);
        console.log("AgentShares             :", address(shares));
        console.log("RevenueSplitter         :", address(splitter));
        console.log("SharesSale              :", address(sale));
        console.log("Sale pool (shares)      :", saleShares);
        console.log("Founder retainer        :", 10_000 - saleShares);
        console.log("Price (USDC, 6 dec)     :", pricePerShare);
        console.log("USDC                    :", BASE_MAINNET_USDC);
        console.log("AgentINFT               :", agentInft);
        console.log("Agent token ID          :", agentTokenId);

        _writeJson(
            address(shares),
            address(splitter),
            address(sale),
            founder,
            pricePerShare
        );
    }

    function _writeJson(
        address shares,
        address splitter,
        address sale,
        address founder,
        uint256 pricePerShare
    ) internal {
        string memory part1 = string.concat(
            '{"network":"base-mainnet","chainId":8453,',
            '"agentShares":"',
            vm.toString(shares),
            '","revenueSplitter":"',
            vm.toString(splitter),
            '","sharesSale":"',
            vm.toString(sale)
        );
        string memory part2 = string.concat(
            '","founder":"',
            vm.toString(founder),
            '","pricePerShareUsdc":',
            vm.toString(pricePerShare),
            ',"usdc":"',
            vm.toString(BASE_MAINNET_USDC),
            '"}'
        );
        vm.writeFile(
            "deployments/base-mainnet-ipo.json",
            string.concat(part1, part2)
        );
        console.log("Wrote deployments/base-mainnet-ipo.json");
    }
}
