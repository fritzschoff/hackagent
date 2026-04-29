// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {AgentINFTVerifier} from "../src/AgentINFTVerifier.sol";
import {PreimageProofOutput, TransferValidityProofOutput} from "../src/IERC7857DataVerifier.sol";

contract AgentINFTVerifierTest is Test {
    AgentINFTVerifier internal verifier;
    uint256 internal oraclePk = 0xA11CE; // test oracle key
    address internal oracle;

    function setUp() public {
        oracle = vm.addr(oraclePk);
        verifier = new AgentINFTVerifier(oracle);
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

    function _buildMintProof(bytes32 dataHash, bytes memory nonce)
        internal view returns (bytes memory)
    {
        // mint proof layout: [1 flags | 65 sig | 32 dataHash | 48 nonce] = 146B
        bytes32 messageHash = keccak256(
            abi.encodePacked("inft-mint-v1", dataHash, nonce)
        );
        bytes memory sig = _signEip191(oraclePk, messageHash);
        bytes1 flags = 0x00;  // bit7=0 TEE, bit6=0 (mint, not private/transfer)
        return abi.encodePacked(flags, sig, dataHash, nonce);
    }

    function test_verifyPreimage_mintFlow() public {
        bytes32 dataHash = keccak256("memory-blob-1");
        bytes memory nonce = abi.encodePacked(uint256(1), uint128(0));
        bytes memory proof = _buildMintProof(dataHash, nonce);

        bytes[] memory proofs = new bytes[](1);
        proofs[0] = proof;

        PreimageProofOutput[] memory out = verifier.verifyPreimage(proofs);
        assertEq(out.length, 1);
        assertEq(out[0].dataHash, dataHash);
        assertTrue(out[0].isValid);
    }

    function test_verifyPreimage_invalidOracleSig_reverts() public {
        bytes32 dataHash = keccak256("memory-blob-1");
        bytes memory nonce = abi.encodePacked(uint256(1), uint128(0));
        // Sign with WRONG key.
        bytes32 messageHash = keccak256(abi.encodePacked("inft-mint-v1", dataHash, nonce));
        bytes32 prefixed = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBADBAD, prefixed);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes1 flags = 0x00;
        bytes memory proof = abi.encodePacked(flags, sig, dataHash, nonce);

        bytes[] memory proofs = new bytes[](1);
        proofs[0] = proof;
        vm.expectRevert(AgentINFTVerifier.InvalidOracleSignature.selector);
        verifier.verifyPreimage(proofs);
    }

    function test_verifyPreimage_replay_reverts() public {
        bytes32 dataHash = keccak256("memory-blob-1");
        bytes memory nonce = abi.encodePacked(uint256(2), uint128(0));
        bytes memory proof = _buildMintProof(dataHash, nonce);

        bytes[] memory proofs = new bytes[](1);
        proofs[0] = proof;
        verifier.verifyPreimage(proofs);
        vm.expectRevert(AgentINFTVerifier.NonceReplay.selector);
        verifier.verifyPreimage(proofs);
    }

    function test_verifyPreimage_truncatedProof_reverts() public {
        bytes memory proof = new bytes(100);
        bytes[] memory proofs = new bytes[](1);
        proofs[0] = proof;
        vm.expectRevert(AgentINFTVerifier.InvalidProofLength.selector);
        verifier.verifyPreimage(proofs);
    }

    function test_verifyPreimage_wrongFlags_reverts() public {
        bytes32 dataHash = keccak256("x");
        bytes memory nonce = abi.encodePacked(uint256(3), uint128(0));
        bytes32 messageHash = keccak256(abi.encodePacked("inft-mint-v1", dataHash, nonce));
        bytes memory sig = _signEip191(oraclePk, messageHash);
        bytes1 flags = 0x80;  // bit7=1 = ZKP, not TEE
        bytes memory proof = abi.encodePacked(flags, sig, dataHash, nonce);

        bytes[] memory proofs = new bytes[](1);
        proofs[0] = proof;
        vm.expectRevert(AgentINFTVerifier.WrongFlags.selector);
        verifier.verifyPreimage(proofs);
    }

    struct TransferProofParams {
        uint256 tokenId;
        bytes32 oldHash;
        bytes32 newHash;
        bytes16 sealedKey;
        bytes nonce;
        string newUri;
        uint256 receiverPk;
    }

    function _buildTransferProof(
        uint256 tokenId,
        bytes32 oldHash,
        bytes32 newHash,
        bytes16 sealedKey,
        bytes memory nonce,
        string memory newUri,
        uint256 receiverPk
    ) internal view returns (bytes memory) {
        TransferProofParams memory p = TransferProofParams({
            tokenId: tokenId,
            oldHash: oldHash,
            newHash: newHash,
            sealedKey: sealedKey,
            nonce: nonce,
            newUri: newUri,
            receiverPk: receiverPk
        });
        return _buildTransferProofFromParams(p);
    }

    function _buildTransferProofFromParams(TransferProofParams memory p)
        internal view returns (bytes memory)
    {
        // Layout (private TEE flavor, corrected with tokenId at offset 1):
        // [0]      flags (0x40 = isPrivate=1, TEE=0)
        // [1..33)  tokenId (uint256, 32B)
        // [33..98) accessibility sig (65B over keccak256(newHash || oldHash || nonce) EIP-191)
        // [98..146) nonce (48B)
        // [146..178) newDataHash
        // [178..210) oldDataHash
        // [210..226) sealedKey (16B)
        // [226..259) ephemeralPubkey (33B compressed)
        // [259..271) ivWrap (12B)
        // [271..287) wrapTag (16B)
        // [287..289) newUriLength (uint16 BE)
        // [289..]   newUri (UTF-8) || oracleAttestation(65B)
        bytes memory accessSig = _signEip191(
            p.receiverPk,
            keccak256(abi.encodePacked(p.newHash, p.oldHash, p.nonce))
        );
        bytes memory uriBytes = bytes(p.newUri);
        bytes memory oracleSig = _signEip191(
            oraclePk,
            keccak256(abi.encodePacked(p.tokenId, p.oldHash, p.newHash, p.sealedKey,
                                       keccak256(uriBytes), p.nonce))
        );
        return abi.encodePacked(
            bytes1(0x40),
            p.tokenId,
            accessSig,
            p.nonce,
            p.newHash,
            p.oldHash,
            p.sealedKey,
            hex"0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
            hex"000102030405060708090A0B",
            hex"000102030405060708090A0B0C0D0E0F",
            abi.encodePacked(uint16(uriBytes.length)),
            uriBytes,
            oracleSig
        );
    }

    function test_verifyTransferValidity_validProof_recoversReceiver() public {
        uint256 receiverPk = 0xBEEF;
        address receiver = vm.addr(receiverPk);
        bytes32 oldHash = keccak256("old");
        bytes32 newHash = keccak256("new");
        bytes16 sealedKey = bytes16(keccak256("k"));
        bytes memory nonce = abi.encodePacked(uint256(7), uint128(0));
        uint256 tokenId = 1;

        bytes memory proof = _buildTransferProof(
            tokenId, oldHash, newHash, sealedKey, nonce, "og://newroot",
            receiverPk
        );

        bytes[] memory proofs = new bytes[](1);
        proofs[0] = proof;
        TransferValidityProofOutput[] memory out = verifier.verifyTransferValidity(proofs);
        assertTrue(out[0].isValid);
        assertEq(out[0].oldDataHash, oldHash);
        assertEq(out[0].newDataHash, newHash);
        assertEq(out[0].receiver, receiver);
        assertEq(out[0].sealedKey, sealedKey);
    }

    function test_verifyTransferValidity_invalidOracleSig_reverts() public {
        uint256 receiverPk = 0xBEEF;
        bytes32 oldHash = keccak256("old");
        bytes32 newHash = keccak256("new");
        bytes16 sealedKey = bytes16(keccak256("k"));
        bytes memory nonce = abi.encodePacked(uint256(8), uint128(0));

        bytes memory proof = _buildTransferProof(1, oldHash, newHash, sealedKey, nonce, "og://x", receiverPk);
        // Corrupt the last byte of the oracle attestation sig (last byte = v)
        proof[proof.length - 1] = bytes1(uint8(proof[proof.length - 1]) ^ 0x01);
        bytes[] memory proofs = new bytes[](1);
        proofs[0] = proof;
        vm.expectRevert(AgentINFTVerifier.InvalidOracleSignature.selector);
        verifier.verifyTransferValidity(proofs);
    }

    function test_verifyTransferValidity_invalidAccessSig_reverts() public {
        uint256 receiverPk = 0xBEEF;
        bytes32 oldHash = keccak256("old");
        bytes32 newHash = keccak256("new");
        bytes16 sealedKey = bytes16(keccak256("k"));
        bytes memory nonce = abi.encodePacked(uint256(11), uint128(0));

        bytes memory proof = _buildTransferProof(1, oldHash, newHash, sealedKey, nonce, "og://newroot", receiverPk);
        // Zero out the r bytes of the accessibility sig (bytes [33..65) of the proof).
        // Setting r = 0 is an invalid ECDSA component and forces ecrecover to return
        // address(0), which triggers InvalidAccessSignature.
        for (uint256 j = 33; j < 65; j++) {
            proof[j] = 0x00;
        }

        bytes[] memory proofs = new bytes[](1);
        proofs[0] = proof;
        vm.expectRevert(AgentINFTVerifier.InvalidAccessSignature.selector);
        verifier.verifyTransferValidity(proofs);
    }

    function test_verifyTransferValidity_replay_reverts() public {
        uint256 receiverPk = 0xBEEF;
        bytes32 oldHash = keccak256("old2");
        bytes32 newHash = keccak256("new2");
        bytes memory nonce = abi.encodePacked(uint256(9), uint128(0));
        bytes memory proof = _buildTransferProof(2, oldHash, newHash, bytes16(0), nonce, "og://y", receiverPk);
        bytes[] memory proofs = new bytes[](1);
        proofs[0] = proof;
        verifier.verifyTransferValidity(proofs);
        vm.expectRevert(AgentINFTVerifier.NonceReplay.selector);
        verifier.verifyTransferValidity(proofs);
    }

    function test_verifyTransferValidity_wrongFlags_reverts() public {
        uint256 receiverPk = 0xBEEF;
        bytes memory nonce = abi.encodePacked(uint256(10), uint128(0));
        bytes memory proof = _buildTransferProof(3, keccak256("a"), keccak256("b"), bytes16(0), nonce, "og://z", receiverPk);
        proof[0] = 0x80; // ZKP flag, not TEE
        bytes[] memory proofs = new bytes[](1);
        proofs[0] = proof;
        vm.expectRevert(AgentINFTVerifier.WrongFlags.selector);
        verifier.verifyTransferValidity(proofs);
    }

    function test_verifyTransferValidity_truncatedProof_reverts() public {
        bytes memory proof = new bytes(100);
        proof[0] = 0x40;
        bytes[] memory proofs = new bytes[](1);
        proofs[0] = proof;
        vm.expectRevert(AgentINFTVerifier.InvalidProofLength.selector);
        verifier.verifyTransferValidity(proofs);
    }
}
