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
}
