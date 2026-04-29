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

    // Stored roots from setUp minting
    bytes32 internal aliceRoot = keccak256("alice-mem");
    bytes32 internal bobRoot = keccak256("bob-mem");

    function _signEip191(uint256 pk, bytes32 messageHash)
        internal pure returns (bytes memory)
    {
        bytes32 prefixed = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, prefixed);
        return abi.encodePacked(r, s, v);
    }

    function _mintProof(bytes32 dataHash, bytes memory nonce) internal view returns (bytes memory) {
        bytes32 messageHash = keccak256(abi.encodePacked("inft-mint-v1", dataHash, nonce));
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, prefixed);
        return abi.encodePacked(bytes1(0x00), abi.encodePacked(r, s, v), dataHash, nonce);
    }

    /// @dev Build an ERC-7857 transfer validity proof for transferring `tokenId`
    /// from its current state to `newHash`. In the merger delegation path the
    /// access sig is signed by the oracle (oracle == receiver-proxy in delegation).
    function _transferProof(
        uint256 tokenId,
        bytes32 oldHash,
        bytes32 newHash,
        bytes16 sealedKey,
        bytes memory nonce,
        string memory newUri
    ) internal view returns (bytes memory) {
        // In the delegation path: oracle is the receiver-proxy.
        bytes memory accessSig = _signEip191(
            oraclePk, // oracle signs access sig as receiver-proxy
            keccak256(abi.encodePacked(newHash, oldHash, nonce))
        );
        bytes memory uriBytes = bytes(newUri);
        bytes memory oracleSig = _signEip191(
            oraclePk,
            keccak256(abi.encodePacked(
                tokenId, oldHash, newHash, sealedKey, keccak256(uriBytes), nonce
            ))
        );
        return abi.encodePacked(
            bytes1(0x40),
            tokenId,
            accessSig,
            nonce,
            newHash,
            oldHash,
            sealedKey,
            hex"0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
            hex"000102030405060708090A0B",
            hex"000102030405060708090A0B0C0D0E0F",
            abi.encodePacked(uint16(uriBytes.length)),
            uriBytes,
            oracleSig
        );
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
        identityV2.registerByDeployer(mergedAgent, "merged.test", mergedAgent);

        // Mint INFTs for alice (agentId=1 in V2) and bob (agentId=2).
        inft.mint(alice, 1, _mintProof(aliceRoot, abi.encodePacked(uint256(1), uint128(0))));
        inft.mint(bob, 2, _mintProof(bobRoot, abi.encodePacked(uint256(2), uint128(0))));

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

    // =========================================================================
    // Helper: set up a dual-proof merge (alice owns both tokens)
    // =========================================================================

    /// @dev Transfer bob's token to alice, set up delegations, approve merger.
    function _setupMergePrereqs() internal {
        vm.prank(bob);
        inft.transferFrom(bob, alice, 2);

        uint64 exp = uint64(block.timestamp + 7 days);
        vm.startPrank(alice);
        inft.setDelegationByOwner(address(merger), 1, oracle, exp);
        inft.setDelegationByOwner(address(merger), 2, oracle, exp);
        inft.setApprovalForAll(address(merger), true);
        vm.stopPrank();
    }

    /// @dev Build proof for token 1 (aliceRoot → newRoot1).
    function _proof1(bytes32 newRoot1) internal view returns (bytes memory) {
        return _transferProof(
            1, aliceRoot, newRoot1, bytes16(0),
            abi.encodePacked(uint256(300), uint128(0)), "og://m1"
        );
    }

    /// @dev Build proof for token 2 (bobRoot → newRoot2).
    function _proof2(bytes32 newRoot2) internal view returns (bytes memory) {
        return _transferProof(
            2, bobRoot, newRoot2, bytes16(0),
            abi.encodePacked(uint256(301), uint128(0)), "og://m2"
        );
    }

    /// @dev Full merge helper: prereqs + proofs + recordMerge. Returns merger index.
    function _doMerge(
        bytes32 mergedRoot,
        string memory mergedUri
    ) internal returns (uint256 idx) {
        _setupMergePrereqs();
        bytes32 newRoot1 = keccak256(abi.encodePacked("merged-1", mergedRoot));
        bytes32 newRoot2 = keccak256(abi.encodePacked("merged-2", mergedRoot));
        vm.prank(alice);
        idx = merger.recordMerge(
            3,
            1, 1, _proof1(newRoot1),
            2, 2, _proof2(newRoot2),
            mergedRoot,
            mergedUri
        );
    }

    // =========================================================================
    // Task 20: dual-proof happy path
    // =========================================================================

    function test_recordMerge_dualProofs_happyPath() public {
        bytes32 mergedRoot = keccak256("merged-mem");
        uint256 idx = _doMerge(mergedRoot, "og://merged");

        assertEq(idx, 1);
        assertEq(merger.mergerCount(), 1);
        // Both source tokens transferred into merger custody via proof path.
        assertEq(inft.ownerOf(1), address(merger));
        assertEq(inft.ownerOf(2), address(merger));

        AgentMerger.Merger memory m = merger.getMerger(3);
        assertEq(m.mergedAgentId, 3);
        assertEq(m.sourceAgentId1, 1);
        assertEq(m.sourceAgentId2, 2);
        assertEq(m.sealedMemoryRoot, mergedRoot);
        assertEq(m.sealedMemoryUri, "og://merged");
        assertEq(m.recordedBy, alice);
    }

    function test_recordMerge_revertsIfMergedIdMissing() public {
        // Transfer bob's token to alice
        vm.prank(bob);
        inft.transferFrom(bob, alice, 2);

        uint64 exp = uint64(block.timestamp + 7 days);
        vm.startPrank(alice);
        inft.setDelegationByOwner(address(merger), 1, oracle, exp);
        inft.setDelegationByOwner(address(merger), 2, oracle, exp);
        inft.setApprovalForAll(address(merger), true);
        vm.stopPrank();

        bytes memory proof1 = _transferProof(
            1, aliceRoot, keccak256("x1"), bytes16(0),
            abi.encodePacked(uint256(400), uint128(0)), "og://x"
        );
        bytes memory proof2 = _transferProof(
            2, bobRoot, keccak256("x2"), bytes16(0),
            abi.encodePacked(uint256(401), uint128(0)), "og://x"
        );

        vm.prank(alice);
        vm.expectRevert(bytes("merged agent missing"));
        merger.recordMerge(99, 1, 1, proof1, 2, 2, proof2, bytes32("x"), "og://x");
    }

    function test_recordMerge_revertsOnDuplicate() public {
        _doMerge(keccak256("first"), "og://first");
        // mergedAgentId=3 is now merged. A second call with any args targeting
        // mergedAgentId=3 must revert before any token interaction.
        // We pass dummy proofs — the "already merged" guard fires first.
        vm.prank(alice);
        vm.expectRevert(bytes("already merged"));
        merger.recordMerge(
            3, 1, 1, new bytes(0),
            2, 2, new bytes(0),
            bytes32("y"), "og://y"
        );
    }

    function test_effectiveFeedback_sumsConstituents() public {
        _doMerge(keccak256("x"), "og://x");

        // alice (id=1) had 2 feedback, bob (id=2) had 1, merged (id=3) had 0.
        // Effective for the merged agent = 2 + 1 + 0 = 3.
        assertEq(merger.effectiveFeedbackCount(3), 3);
        // Non-merged agents fall through to the registry count.
        assertEq(merger.effectiveFeedbackCount(1), 2);
    }

    function test_getMerger_returnsLineage() public {
        _doMerge(keccak256("merged-mem"), "og://merged");

        AgentMerger.Merger memory m = merger.getMerger(3);
        assertEq(m.mergedAgentId, 3);
        assertEq(m.sourceAgentId1, 1);
        assertEq(m.sourceAgentId2, 2);
        assertEq(m.sealedMemoryRoot, keccak256("merged-mem"));
        assertEq(m.recordedBy, alice);
    }

    function test_recordMerge_clearsConstituentWalletsViaInftHook() public {
        // bob's raw transferFrom to alice already clears wallet (setUp uses transferFrom).
        // This test verifies the existing behavior is preserved.
        vm.prank(bob);
        inft.transferFrom(bob, alice, 2);
        // The transferFrom above already cleared bob's V2 wallet via the
        // _update hook. Verify.
        assertEq(identityV2.getAgent(2).agentWallet, address(0));
    }
}
