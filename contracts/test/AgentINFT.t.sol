// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {IdentityRegistryV2} from "../src/IdentityRegistryV2.sol";
import {AgentINFT} from "../src/AgentINFT.sol";
import {AgentINFTVerifier} from "../src/AgentINFTVerifier.sol";

contract AgentINFTTest is Test {
    IdentityRegistryV2 internal reg;
    AgentINFTVerifier internal verifier;
    AgentINFT internal inft;

    address internal deployer = address(0xD0A);
    address internal alice = address(0xA110);
    address internal bob = address(0xB0B);
    uint256 internal oraclePk = 0xA11CE;
    address internal oracle;

    function setUp() public {
        oracle = vm.addr(oraclePk);
        vm.startPrank(deployer);
        reg = new IdentityRegistryV2();
        verifier = new AgentINFTVerifier(oracle);
        inft = new AgentINFT(
            address(reg),
            "https://example.test/inft/",
            address(verifier),
            oracle
        );
        reg.setInft(address(inft));
        vm.stopPrank();

        vm.prank(alice);
        reg.register("tradewise.test", alice);
    }

    function _signEip191(uint256 pk, bytes32 messageHash)
        internal pure returns (bytes memory)
    {
        bytes32 prefixed = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, prefixed);
        return abi.encodePacked(r, s, v);
    }

    function _mintProof(bytes32 dataHash, bytes memory nonce)
        internal view returns (bytes memory)
    {
        bytes32 messageHash = keccak256(abi.encodePacked("inft-mint-v1", dataHash, nonce));
        bytes memory sig = _signEip191(oraclePk, messageHash);
        return abi.encodePacked(bytes1(0x00), sig, dataHash, nonce);
    }

    struct TransferProofArgs {
        uint256 tokenId;
        bytes32 oldHash;
        bytes32 newHash;
        bytes16 sealedKey;
        bytes nonce;
        string newUri;
        uint256 receiverPk;
    }

    function _transferProof(
        uint256 tokenId,
        bytes32 oldHash,
        bytes32 newHash,
        bytes16 sealedKey,
        bytes memory nonce,
        string memory newUri,
        uint256 receiverPk
    ) internal view returns (bytes memory) {
        return _buildTransferProofFromArgs(TransferProofArgs({
            tokenId: tokenId,
            oldHash: oldHash,
            newHash: newHash,
            sealedKey: sealedKey,
            nonce: nonce,
            newUri: newUri,
            receiverPk: receiverPk
        }));
    }

    function _buildTransferProofFromArgs(TransferProofArgs memory a)
        internal view returns (bytes memory)
    {
        bytes memory accessSig = _signEip191(
            a.receiverPk,
            keccak256(abi.encodePacked(a.newHash, a.oldHash, a.nonce))
        );
        bytes memory uriBytes = bytes(a.newUri);
        bytes memory oracleSig = _signEip191(
            oraclePk,
            keccak256(abi.encodePacked(
                a.tokenId, a.oldHash, a.newHash, a.sealedKey, keccak256(uriBytes), a.nonce
            ))
        );
        return abi.encodePacked(
            bytes1(0x40),
            a.tokenId,
            accessSig,
            a.nonce,
            a.newHash,
            a.oldHash,
            a.sealedKey,
            hex"0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
            hex"000102030405060708090A0B",
            hex"000102030405060708090A0B0C0D0E0F",
            abi.encodePacked(uint16(uriBytes.length)),
            uriBytes,
            oracleSig
        );
    }

    // =========================================================================
    // Task 10: mint with proof
    // =========================================================================

    function test_mint_withProof_linksAgentIdAndStoresRoot() public {
        bytes32 root = keccak256("memroot");
        bytes memory nonce = abi.encodePacked(uint256(1), uint128(0));
        bytes memory mp = _mintProof(root, nonce);

        vm.prank(deployer);
        uint256 tokenId = inft.mint(alice, 1, mp);
        assertEq(tokenId, 1);
        assertEq(inft.ownerOf(tokenId), alice);
        assertEq(inft.encryptedMemoryRoot(tokenId), root);
        assertTrue(inft.memoryReencrypted(tokenId));
    }

    // =========================================================================
    // Task 12: setDelegation (msg.sender == receiver)
    // =========================================================================

    function test_setDelegation_byBidder() public {
        bytes32 root = keccak256("m1");
        bytes memory nonce = abi.encodePacked(uint256(11), uint128(0));
        vm.prank(deployer);
        inft.mint(alice, 1, _mintProof(root, nonce));

        uint64 exp = uint64(block.timestamp + 7 days);
        vm.prank(bob);
        inft.setDelegation(1, oracle, exp);

        (address dOracle, uint64 dExp) = inft.delegations(bob, 1);
        assertEq(dOracle, oracle);
        assertEq(dExp, exp);
    }

    // =========================================================================
    // Task 13: setDelegationFor (EIP-712 forwarded sig)
    // =========================================================================

    function test_setDelegationFor_validSigForwarded() public {
        uint256 bobPk = 0xB0BB1E5;
        address bobSigner = vm.addr(bobPk);

        uint64 exp = uint64(block.timestamp + 30 days);
        bytes32 structHash = keccak256(abi.encode(
            inft.DELEGATION_TYPEHASH(), uint256(7), oracle, exp
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01", inft.domainSeparator(), structHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(bobPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        // anyone (e.g. AgentBids) calls; sig recovers to bobSigner
        inft.setDelegationFor(bobSigner, 7, oracle, exp, sig);
        assertTrue(inft.isDelegated(bobSigner, 7));
    }

    function test_setDelegationFor_invalidSig_reverts() public {
        uint256 wrongPk = 0xDEAD;
        address claimedReceiver = vm.addr(0xC0DE);
        uint64 exp = uint64(block.timestamp + 30 days);
        bytes32 structHash = keccak256(abi.encode(
            inft.DELEGATION_TYPEHASH(), uint256(8), oracle, exp
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01", inft.domainSeparator(), structHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(AgentINFT.InvalidDelegationSig.selector);
        inft.setDelegationFor(claimedReceiver, 8, oracle, exp, sig);
    }

    // =========================================================================
    // Task 14: setDelegationByOwner happy-path + onlyOwner
    // =========================================================================

    function test_setDelegationByOwner_storesDelegation_happyPath() public {
        bytes32 root = keccak256("m2");
        bytes memory nonce = abi.encodePacked(uint256(20), uint128(0));
        vm.prank(deployer);
        inft.mint(alice, 1, _mintProof(root, nonce));

        address mergerLike = address(0xCAFE);
        uint64 exp = uint64(block.timestamp + 7 days);
        vm.prank(alice);
        inft.setDelegationByOwner(mergerLike, 1, oracle, exp);

        assertTrue(inft.isDelegated(mergerLike, 1));
    }

    function test_setDelegationByOwner_onlyOwner() public {
        bytes32 root = keccak256("m3");
        bytes memory nonce = abi.encodePacked(uint256(21), uint128(0));
        vm.prank(deployer);
        inft.mint(alice, 1, _mintProof(root, nonce));

        uint64 exp = uint64(block.timestamp + 7 days);
        vm.prank(bob); // not the owner
        vm.expectRevert(AgentINFT.NotOwnerOfToken.selector);
        inft.setDelegationByOwner(bob, 1, oracle, exp);
    }

    // =========================================================================
    // Task 15 / 16: transferWithProof happy path (delegation receiver)
    // =========================================================================

    function test_transferWithProof_happyPath_delegationReceiver() public {
        bytes32 root0 = keccak256("seed");
        bytes memory mintNonce = abi.encodePacked(uint256(30), uint128(0));
        vm.prank(deployer);
        inft.mint(alice, 1, _mintProof(root0, mintNonce));

        // bob delegates oracle to be receiver-proxy for tokenId=1
        uint64 exp = uint64(block.timestamp + 30 days);
        vm.prank(bob);
        inft.setDelegation(1, oracle, exp);

        bytes32 newRoot = keccak256("rotated");
        bytes16 sealedKey = bytes16(keccak256("k"));
        bytes memory nonce = abi.encodePacked(uint256(31), uint128(0));
        bytes memory proof = _transferProof(
            1, root0, newRoot, sealedKey, nonce, "og://newroot", oraclePk
        );

        vm.prank(alice); // current owner submits
        inft.transferWithProof(bob, 1, proof);

        assertEq(inft.ownerOf(1), bob);
        assertEq(inft.encryptedMemoryRoot(1), newRoot);
        assertTrue(inft.memoryReencrypted(1));
    }

    // =========================================================================
    // Task 17: transferWithProof edge cases + transferFrom stale
    // =========================================================================

    function test_transferWithProof_oldRootMismatch_reverts() public {
        bytes32 root0 = keccak256("seed-mm");
        bytes memory mn = abi.encodePacked(uint256(40), uint128(0));
        vm.prank(deployer);
        inft.mint(alice, 1, _mintProof(root0, mn));

        uint64 exp = uint64(block.timestamp + 30 days);
        vm.prank(bob);
        inft.setDelegation(1, oracle, exp);

        // Build a proof claiming the WRONG oldHash
        bytes32 wrongOld = keccak256("not-the-current-root");
        bytes32 newRoot = keccak256("new-mm");
        bytes memory nonce = abi.encodePacked(uint256(41), uint128(0));
        bytes memory proof = _transferProof(
            1, wrongOld, newRoot, bytes16(0), nonce, "og://x", oraclePk
        );

        vm.prank(alice);
        vm.expectRevert(AgentINFT.OldRootMismatch.selector);
        inft.transferWithProof(bob, 1, proof);
    }

    function test_transferWithProof_delegationExpired_reverts() public {
        bytes32 root0 = keccak256("seed-exp");
        bytes memory mn = abi.encodePacked(uint256(50), uint128(0));
        vm.prank(deployer);
        inft.mint(alice, 1, _mintProof(root0, mn));

        uint64 exp = uint64(block.timestamp + 1 days);
        vm.prank(bob);
        inft.setDelegation(1, oracle, exp);
        vm.warp(block.timestamp + 2 days); // jump past expiry

        bytes32 newRoot = keccak256("new-exp");
        bytes memory nonce = abi.encodePacked(uint256(51), uint128(0));
        bytes memory proof = _transferProof(
            1, root0, newRoot, bytes16(0), nonce, "og://exp", oraclePk
        );

        vm.prank(alice);
        vm.expectRevert(AgentINFT.DelegationExpired.selector);
        inft.transferWithProof(bob, 1, proof);
    }

    function test_transferWithProof_undelegatedReceiver_reverts() public {
        bytes32 root0 = keccak256("seed-und");
        bytes memory mn = abi.encodePacked(uint256(60), uint128(0));
        vm.prank(deployer);
        inft.mint(alice, 1, _mintProof(root0, mn));
        // bob never delegates

        bytes32 newRoot = keccak256("new-und");
        bytes memory nonce = abi.encodePacked(uint256(61), uint128(0));
        bytes memory proof = _transferProof(
            1, root0, newRoot, bytes16(0), nonce, "og://un", oraclePk
        );

        vm.prank(alice);
        vm.expectRevert(AgentINFT.UndelegatedReceiver.selector);
        inft.transferWithProof(bob, 1, proof);
    }

    function test_transferWithProof_notOwner_reverts() public {
        bytes32 root0 = keccak256("seed-no");
        bytes memory mn = abi.encodePacked(uint256(70), uint128(0));
        vm.prank(deployer);
        inft.mint(alice, 1, _mintProof(root0, mn));
        uint64 exp = uint64(block.timestamp + 30 days);
        vm.prank(bob);
        inft.setDelegation(1, oracle, exp);

        bytes32 newRoot = keccak256("new-no");
        bytes memory nonce = abi.encodePacked(uint256(71), uint128(0));
        bytes memory proof = _transferProof(
            1, root0, newRoot, bytes16(0), nonce, "og://no", oraclePk
        );
        address mallory = address(0xBEEF);
        vm.prank(mallory);
        vm.expectRevert("not owner/approved");
        inft.transferWithProof(bob, 1, proof);
    }

    function test_transferFrom_setsMemoryStale_emitsMemoryStaled() public {
        bytes32 root0 = keccak256("seed-stale");
        bytes memory mn = abi.encodePacked(uint256(80), uint128(0));
        vm.prank(deployer);
        inft.mint(alice, 1, _mintProof(root0, mn));
        assertTrue(inft.memoryReencrypted(1));

        vm.expectEmit(true, false, false, false);
        emit AgentINFT.MemoryStaled(1);
        vm.prank(alice);
        inft.transferFrom(alice, bob, 1);
        assertEq(inft.ownerOf(1), bob);
        assertFalse(inft.memoryReencrypted(1));
        // Existing wallet-clear behavior still fires:
        assertEq(reg.getAgent(1).agentWallet, address(0));
    }
}
