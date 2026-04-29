// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {IdentityRegistryV2} from "../src/IdentityRegistryV2.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {AgentINFT} from "../src/AgentINFT.sol";
import {AgentINFTVerifier} from "../src/AgentINFTVerifier.sol";
import {AgentMerger} from "../src/AgentMerger.sol";

contract AgentMergerTest is Test {
    IdentityRegistry internal identityV1;
    IdentityRegistryV2 internal identityV2;
    ReputationRegistry internal reputation;
    AgentINFTVerifier internal verifier;
    AgentINFT internal inft;
    AgentMerger internal merger;

    address internal deployer = address(0xD0A);
    address internal alice = address(0xA110);
    address internal bob = address(0xB0B);
    address internal mergedAgent = address(0xCAFE);
    address internal client = address(0xC11);
    uint256 internal oraclePk = 0xA11CE;
    address internal oracle;

    function _mintProof(bytes32 dataHash, bytes memory nonce) internal view returns (bytes memory) {
        bytes32 messageHash = keccak256(abi.encodePacked("inft-mint-v1", dataHash, nonce));
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, prefixed);
        return abi.encodePacked(bytes1(0x00), abi.encodePacked(r, s, v), dataHash, nonce);
    }

    function setUp() public {
        oracle = vm.addr(oraclePk);
        // V1 reputation lives on the v1 IdentityRegistry. V2 is what the INFT
        // hooks back into. We use both to validate the cross-chain-of-trust.
        vm.startPrank(deployer);
        identityV1 = new IdentityRegistry();
        reputation = new ReputationRegistry(address(identityV1));
        identityV2 = new IdentityRegistryV2();
        verifier = new AgentINFTVerifier(oracle);
        inft = new AgentINFT(address(identityV2), "https://x.test/", address(verifier), oracle);
        identityV2.setInft(address(inft));

        // Register all three agents in V1 (where ReputationRegistry lives) and
        // V2 (where the INFT links).
        vm.stopPrank();
        vm.prank(alice);
        identityV1.register("alice.test", alice);
        vm.prank(bob);
        identityV1.register("bob.test", bob);
        vm.prank(mergedAgent);
        identityV1.register("merged.test", mergedAgent);

        vm.startPrank(deployer);
        identityV2.registerByDeployer(alice, "alice.test", alice);
        identityV2.registerByDeployer(bob, "bob.test", bob);
        identityV2.registerByDeployer(
            mergedAgent,
            "merged.test",
            mergedAgent
        );

        // Mint INFTs for alice (agentId=1 in V2) and bob (agentId=2).
        inft.mint(alice, 1, _mintProof(keccak256("alice-mem"), abi.encodePacked(uint256(1), uint128(0))));
        inft.mint(bob, 2, _mintProof(keccak256("bob-mem"), abi.encodePacked(uint256(2), uint128(0))));

        merger = new AgentMerger(
            address(identityV1),
            address(reputation),
            address(inft)
        );
        vm.stopPrank();

        // Seed feedback so we can verify the oracle math.
        vm.prank(client);
        reputation.postFeedback(1, 90, 0, bytes32("alice"), "");
        vm.prank(client);
        reputation.postFeedback(1, 80, 0, bytes32("alice"), "");
        vm.prank(client);
        reputation.postFeedback(2, 95, 0, bytes32("bob"), "");
    }

    function test_recordMerge_pullsBothInfts() public {
        // Caller (alice in this test) owns both INFTs after we transfer
        // bob's to her in setup.
        vm.prank(bob);
        inft.transferFrom(bob, alice, 2);

        vm.startPrank(alice);
        inft.setApprovalForAll(address(merger), true);
        uint256 idx = merger.recordMerge(
            3, // mergedAgentId in V1 (mergedAgent registered above)
            1,
            1,
            2,
            2,
            bytes32("merged-mem")
        );
        vm.stopPrank();

        assertEq(idx, 1);
        assertEq(merger.mergerCount(), 1);
        assertEq(inft.ownerOf(1), address(merger));
        assertEq(inft.ownerOf(2), address(merger));
    }

    function test_recordMerge_revertsIfMergedIdMissing() public {
        vm.prank(bob);
        inft.transferFrom(bob, alice, 2);
        vm.startPrank(alice);
        inft.setApprovalForAll(address(merger), true);
        vm.expectRevert(bytes("merged agent missing"));
        merger.recordMerge(99, 1, 1, 2, 2, bytes32("x"));
        vm.stopPrank();
    }

    function test_recordMerge_revertsOnDuplicate() public {
        vm.prank(bob);
        inft.transferFrom(bob, alice, 2);
        vm.startPrank(alice);
        inft.setApprovalForAll(address(merger), true);
        merger.recordMerge(3, 1, 1, 2, 2, bytes32("x"));
        vm.expectRevert(bytes("already merged"));
        merger.recordMerge(3, 1, 1, 2, 2, bytes32("y"));
        vm.stopPrank();
    }

    function test_effectiveFeedback_sumsConstituents() public {
        vm.prank(bob);
        inft.transferFrom(bob, alice, 2);
        vm.startPrank(alice);
        inft.setApprovalForAll(address(merger), true);
        merger.recordMerge(3, 1, 1, 2, 2, bytes32("x"));
        vm.stopPrank();

        // alice (id=1) had 2 feedback, bob (id=2) had 1, merged (id=3) had 0.
        // Effective for the merged agent = 2 + 1 + 0 = 3.
        assertEq(merger.effectiveFeedbackCount(3), 3);
        // Non-merged agents fall through to the registry count.
        assertEq(merger.effectiveFeedbackCount(1), 2);
    }

    function test_getMerger_returnsLineage() public {
        vm.prank(bob);
        inft.transferFrom(bob, alice, 2);
        vm.startPrank(alice);
        inft.setApprovalForAll(address(merger), true);
        merger.recordMerge(3, 1, 1, 2, 2, bytes32("merged-mem"));
        vm.stopPrank();

        AgentMerger.Merger memory m = merger.getMerger(3);
        assertEq(m.mergedAgentId, 3);
        assertEq(m.sourceAgentId1, 1);
        assertEq(m.sourceAgentId2, 2);
        assertEq(m.sealedMemoryRoot, bytes32("merged-mem"));
        assertEq(m.recordedBy, alice);
    }

    function test_recordMerge_clearsConstituentWalletsViaInftHook() public {
        vm.prank(bob);
        inft.transferFrom(bob, alice, 2);
        // The transferFrom above already cleared bob's V2 wallet via the
        // _update hook. Verify.
        assertEq(identityV2.getAgent(2).agentWallet, address(0));
    }
}
