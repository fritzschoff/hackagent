// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IdentityRegistryV2} from "../src/IdentityRegistryV2.sol";
import {AgentINFT} from "../src/AgentINFT.sol";
import {AgentINFTVerifier} from "../src/AgentINFTVerifier.sol";
import {AgentBids} from "../src/AgentBids.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("MockUSDC", "USDC") {}
    function decimals() public pure override returns (uint8) {
        return 6;
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract AgentBidsTest is Test {
    IdentityRegistryV2 internal reg;
    AgentINFTVerifier internal verifier;
    AgentINFT internal inft;
    AgentBids internal bids;
    MockUSDC internal usdc;

    address internal deployer = address(0xD0A);
    address internal alice = address(0xA110);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA70);
    uint256 internal oraclePk = 0xA11CE;
    address internal oracle;

    uint256 internal constant TOKEN_ID = 1;

    function setUp() public {
        oracle = vm.addr(oraclePk);
        vm.startPrank(deployer);
        reg = new IdentityRegistryV2();
        verifier = new AgentINFTVerifier(oracle);
        inft = new AgentINFT(address(reg), "https://x.test/", address(verifier), oracle);
        reg.setInft(address(inft));
        reg.registerByDeployer(alice, "alice.test", alice);
        usdc = new MockUSDC();
        bids = new AgentBids(address(inft), address(usdc));
        // Build a valid mint proof
        bytes32 root = keccak256("root");
        bytes memory nonce = abi.encodePacked(uint256(1), uint128(0));
        bytes memory proof = _mintProof(root, nonce);
        inft.mint(alice, 1, proof);
        vm.stopPrank();

        usdc.mint(bob, 100_000_000); // 100 USDC
        usdc.mint(carol, 100_000_000);
    }

    function _mintProof(bytes32 dataHash, bytes memory nonce) internal view returns (bytes memory) {
        bytes32 messageHash = keccak256(abi.encodePacked("inft-mint-v1", dataHash, nonce));
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, prefixed);
        return abi.encodePacked(bytes1(0x00), abi.encodePacked(r, s, v), dataHash, nonce);
    }

    function test_placeBid_escrowsAndRecordsBidder() public {
        vm.startPrank(bob);
        usdc.approve(address(bids), 5_000_000);
        bids.placeBid(TOKEN_ID, 5_000_000);
        vm.stopPrank();

        (address bidder, uint256 amount, , bool active) = bids.bids(
            TOKEN_ID,
            bob
        );
        assertEq(bidder, bob);
        assertEq(amount, 5_000_000);
        assertTrue(active);
        assertEq(usdc.balanceOf(address(bids)), 5_000_000);
        assertEq(bids.biddersCount(TOKEN_ID), 1);
    }

    function test_placeBid_topUpIncreases() public {
        vm.startPrank(bob);
        usdc.approve(address(bids), 10_000_000);
        bids.placeBid(TOKEN_ID, 5_000_000);
        bids.placeBid(TOKEN_ID, 8_000_000);
        vm.stopPrank();

        (, uint256 amount, , ) = bids.bids(TOKEN_ID, bob);
        assertEq(amount, 8_000_000);
        assertEq(usdc.balanceOf(address(bids)), 8_000_000);
        assertEq(bids.biddersCount(TOKEN_ID), 1, "no double-counting");
    }

    function test_placeBid_topUpRequiresHigher() public {
        vm.startPrank(bob);
        usdc.approve(address(bids), 10_000_000);
        bids.placeBid(TOKEN_ID, 5_000_000);
        vm.expectRevert(bytes("must increase"));
        bids.placeBid(TOKEN_ID, 5_000_000);
        vm.stopPrank();
    }

    function test_withdraw_returnsFundsAndDeactivates() public {
        vm.startPrank(bob);
        usdc.approve(address(bids), 5_000_000);
        bids.placeBid(TOKEN_ID, 5_000_000);
        bids.withdrawBid(TOKEN_ID);
        vm.stopPrank();

        (, uint256 amount, , bool active) = bids.bids(TOKEN_ID, bob);
        assertEq(amount, 0);
        assertFalse(active);
        assertEq(usdc.balanceOf(bob), 100_000_000);
    }

    function test_withdraw_revertsWithoutBid() public {
        vm.prank(bob);
        vm.expectRevert(bytes("no bid"));
        bids.withdrawBid(TOKEN_ID);
    }

    function test_acceptBid_transfersInftAndPaysSeller() public {
        // bob places bid
        vm.startPrank(bob);
        usdc.approve(address(bids), 5_000_000);
        bids.placeBid(TOKEN_ID, 5_000_000);
        vm.stopPrank();

        // alice approves bid contract on the INFT
        vm.startPrank(alice);
        inft.setApprovalForAll(address(bids), true);
        bids.acceptBid(TOKEN_ID, bob);
        vm.stopPrank();

        assertEq(inft.ownerOf(TOKEN_ID), bob);
        assertEq(usdc.balanceOf(alice), 5_000_000);
        // EIP-8004 §4.4: payout wallet cleared on transfer
        assertEq(reg.getAgent(1).agentWallet, address(0));

        (, uint256 amount, , bool active) = bids.bids(TOKEN_ID, bob);
        assertEq(amount, 0);
        assertFalse(active);
    }

    function test_acceptBid_revertsForNonOwner() public {
        vm.startPrank(bob);
        usdc.approve(address(bids), 5_000_000);
        bids.placeBid(TOKEN_ID, 5_000_000);
        vm.stopPrank();

        vm.prank(carol);
        vm.expectRevert(bytes("not owner"));
        bids.acceptBid(TOKEN_ID, bob);
    }

    function test_acceptBid_revertsIfBidNotActive() public {
        vm.startPrank(alice);
        inft.setApprovalForAll(address(bids), true);
        vm.expectRevert(bytes("no bid"));
        bids.acceptBid(TOKEN_ID, bob);
        vm.stopPrank();
    }

    function test_listBidders_includesAllPlacers() public {
        vm.startPrank(bob);
        usdc.approve(address(bids), 5_000_000);
        bids.placeBid(TOKEN_ID, 5_000_000);
        vm.stopPrank();
        vm.startPrank(carol);
        usdc.approve(address(bids), 7_000_000);
        bids.placeBid(TOKEN_ID, 7_000_000);
        vm.stopPrank();

        address[] memory list = bids.listBidders(TOKEN_ID);
        assertEq(list.length, 2);
        assertEq(list[0], bob);
        assertEq(list[1], carol);
    }
}
