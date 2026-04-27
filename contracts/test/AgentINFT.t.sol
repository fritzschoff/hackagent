// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {IdentityRegistryV2} from "../src/IdentityRegistryV2.sol";
import {AgentINFT} from "../src/AgentINFT.sol";

contract AgentINFTTest is Test {
    IdentityRegistryV2 internal reg;
    AgentINFT internal inft;

    address internal deployer = address(0xD0A);
    address internal alice = address(0xA110);
    address internal bob = address(0xB0B);

    function setUp() public {
        vm.startPrank(deployer);
        reg = new IdentityRegistryV2();
        inft = new AgentINFT(address(reg), "https://example.test/inft/");
        reg.setInft(address(inft));
        vm.stopPrank();

        vm.prank(alice);
        reg.register("tradewise.test", alice);
    }

    function test_mint_linksToAgentId() public {
        vm.prank(deployer);
        uint256 tokenId = inft.mint(
            alice,
            1,
            bytes32("memroot"),
            "og://memroot"
        );
        assertEq(tokenId, 1);
        assertEq(inft.ownerOf(tokenId), alice);
        assertEq(inft.agentIdOfToken(tokenId), 1);
        assertEq(inft.tokenIdForAgent(1), tokenId);
        assertEq(inft.encryptedMemoryRoot(tokenId), bytes32("memroot"));
    }

    function test_mint_revertsForDuplicateAgent() public {
        vm.startPrank(deployer);
        inft.mint(alice, 1, bytes32("a"), "og://a");
        vm.expectRevert(bytes("already minted"));
        inft.mint(alice, 1, bytes32("b"), "og://b");
        vm.stopPrank();
    }

    function test_mint_onlyDeployer() public {
        vm.prank(alice);
        vm.expectRevert(bytes("only deployer mints"));
        inft.mint(alice, 1, bytes32("a"), "og://a");
    }

    function test_updateMemory_byOwner() public {
        vm.prank(deployer);
        uint256 tokenId = inft.mint(alice, 1, bytes32("a"), "og://a");

        vm.prank(alice);
        inft.updateMemory(tokenId, bytes32("b"), "og://b");

        assertEq(inft.encryptedMemoryRoot(tokenId), bytes32("b"));
        assertEq(inft.encryptedMemoryUri(tokenId), "og://b");
    }

    function test_updateMemory_revertsForStranger() public {
        vm.prank(deployer);
        uint256 tokenId = inft.mint(alice, 1, bytes32("a"), "og://a");

        vm.prank(bob);
        vm.expectRevert(bytes("not authorized"));
        inft.updateMemory(tokenId, bytes32("b"), "og://b");
    }

    function test_transfer_clearsAgentWallet() public {
        vm.prank(deployer);
        uint256 tokenId = inft.mint(alice, 1, bytes32("a"), "og://a");

        assertEq(reg.getAgent(1).agentWallet, alice);

        vm.prank(alice);
        inft.transferFrom(alice, bob, tokenId);

        assertEq(inft.ownerOf(tokenId), bob);
        assertEq(reg.getAgent(1).agentWallet, address(0));
    }

    function test_tokenURI_usesBaseURI() public {
        vm.prank(deployer);
        uint256 tokenId = inft.mint(alice, 1, bytes32("a"), "og://a");
        // OZ ERC721 default tokenURI = baseURI + tokenId
        string memory expected = "https://example.test/inft/1";
        assertEq(inft.tokenURI(tokenId), expected);
    }
}
