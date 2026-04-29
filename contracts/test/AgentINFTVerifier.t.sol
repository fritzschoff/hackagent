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
}
