// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7857DataVerifier, PreimageProofOutput, TransferValidityProofOutput} from "./IERC7857DataVerifier.sol";

/// @notice Implements 0G's IERC7857DataVerifier. Proof byte layout matches
/// 0G/0gfoundation/0g-agent-nft (eip-7857-draft) contracts/verifiers/Verifier.sol.
/// Adds the on-chain oracle-attestation check the reference left as TODO.
contract AgentINFTVerifier is IERC7857DataVerifier {
    address public immutable EXPECTED_ORACLE;

    /// keccak256(nonce) -> used; replay protection.
    mapping(bytes32 => bool) public usedNonces;

    error InvalidProofLength();
    error InvalidOracleSignature();
    error NonceReplay();
    error WrongFlags();

    constructor(address oracle_) {
        require(oracle_ != address(0), "oracle zero");
        EXPECTED_ORACLE = oracle_;
    }

    function expectedOracle() external view returns (address) {
        return EXPECTED_ORACLE;
    }

    /// Mint proof layout: [1 flags | 65 sig | 32 dataHash | 48 nonce] = 146B
    /// Signature is EIP-191 over keccak256("inft-mint-v1" || dataHash || nonce).
    function verifyPreimage(bytes[] calldata _proofs)
        external returns (PreimageProofOutput[] memory)
    {
        PreimageProofOutput[] memory outputs = new PreimageProofOutput[](_proofs.length);
        for (uint256 i = 0; i < _proofs.length; i++) {
            bytes calldata p = _proofs[i];
            if (p.length != 146) revert InvalidProofLength();
            // Mint variant uses flags 0x00 (bit7=TEE=0, bit6=isPrivate=0).
            if (uint8(p[0]) != 0x00) revert WrongFlags();

            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly {
                r := calldataload(add(p.offset, 1))
                s := calldataload(add(p.offset, 33))
                v := byte(0, calldataload(add(p.offset, 65)))
            }
            bytes32 dataHash = bytes32(p[66:98]);
            bytes memory nonce = p[98:146];

            bytes32 nonceKey = keccak256(nonce);
            if (usedNonces[nonceKey]) revert NonceReplay();

            bytes32 messageHash = keccak256(
                abi.encodePacked("inft-mint-v1", dataHash, nonce)
            );
            bytes32 prefixed = keccak256(
                abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
            );
            address recovered = ecrecover(prefixed, v, r, s);
            if (recovered != EXPECTED_ORACLE) revert InvalidOracleSignature();

            usedNonces[nonceKey] = true;
            outputs[i] = PreimageProofOutput({dataHash: dataHash, isValid: true});
        }
        return outputs;
    }

    /// Transfer proof layout: see _verifyOne for full field breakdown.
    /// Implementation in Task 6.
    function verifyTransferValidity(bytes[] calldata)
        external pure returns (TransferValidityProofOutput[] memory)
    {
        revert("not implemented");
    }
}
