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
    error InvalidAccessSignature();
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

    /// Transfer proof layout (private TEE flavor, corrected layout):
    ///   [0]        flags (bit7=TEE=0, bit6=isPrivate=1) — must be 0x40
    ///   [1..33)    tokenId (uint256, 32B)
    ///   [33..98)   accessibility sig (65B over keccak256(newHash||oldHash||nonce) EIP-191)
    ///   [98..146)  nonce (48B)
    ///   [146..178) newDataHash
    ///   [178..210) oldDataHash
    ///   [210..226) sealedKey (16B)
    ///   [226..259) ephemeralPubkey (33B compressed)
    ///   [259..271) ivWrap (12B)
    ///   [271..287) wrapTag (16B)
    ///   [287..289) newUriLen (uint16 BE)
    ///   [289..289+L) newUri (UTF-8)
    ///   [289+L..289+L+65) oracleAttestation (65B sig over
    ///       keccak256(tokenId||oldHash||newHash||sealedKey||keccak256(newUri)||nonce))
    function verifyTransferValidity(bytes[] calldata _proofs)
        external returns (TransferValidityProofOutput[] memory)
    {
        TransferValidityProofOutput[] memory outputs =
            new TransferValidityProofOutput[](_proofs.length);
        for (uint256 i = 0; i < _proofs.length; i++) {
            outputs[i] = _verifyOne(_proofs[i]);
        }
        return outputs;
    }

    /// Parsed header from the transfer proof (offsets fixed per spec).
    struct ProofHeader {
        uint256 tokenId;
        bytes32 newDataHash;
        bytes32 oldDataHash;
        bytes16 sealedKey;
    }

    function _parseHeader(bytes calldata p) internal pure returns (ProofHeader memory h) {
        uint256 tid;
        assembly { tid := calldataload(add(p.offset, 1)) }
        h.tokenId    = tid;
        h.newDataHash = bytes32(p[146:178]);
        h.oldDataHash = bytes32(p[178:210]);
        h.sealedKey   = bytes16(p[210:226]);
    }

    function _recoverAccessSig(
        bytes calldata p,
        bytes32 newDataHash,
        bytes32 oldDataHash,
        bytes memory nonce
    ) internal pure returns (address) {
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(add(p.offset, 33))
            s := calldataload(add(p.offset, 65))
            v := byte(0, calldataload(add(p.offset, 97)))
        }
        bytes32 msg_ = keccak256(abi.encodePacked(newDataHash, oldDataHash, nonce));
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msg_));
        return ecrecover(prefixed, v, r, s);
    }

    function _recoverOracleSig(
        bytes calldata p,
        uint256 attestStart,
        uint256 tokenId,
        bytes32 oldDataHash,
        bytes32 newDataHash,
        bytes16 sealedKey,
        bytes memory newUri,
        bytes memory nonce
    ) internal pure returns (address) {
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(add(p.offset, attestStart))
            s := calldataload(add(add(p.offset, attestStart), 32))
            v := byte(0, calldataload(add(add(p.offset, attestStart), 64)))
        }
        bytes32 msg_ = keccak256(
            abi.encodePacked(tokenId, oldDataHash, newDataHash, sealedKey,
                             keccak256(newUri), nonce)
        );
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msg_));
        return ecrecover(prefixed, v, r, s);
    }

    function _verifyOne(bytes calldata p)
        internal returns (TransferValidityProofOutput memory out)
    {
        // Min size: flags(1) + tokenId(32) + accessSig(65) + nonce(48) +
        //   newHash(32) + oldHash(32) + sealedKey(16) + ephemeral(33) +
        //   ivWrap(12) + wrapTag(16) + uriLen(2) + uri(0+) + oracleSig(65) = 354 bytes min
        if (p.length < 289 + 65) revert InvalidProofLength();
        if (uint8(p[0]) != 0x40) revert WrongFlags();

        ProofHeader memory h = _parseHeader(p);
        bytes memory nonce = p[98:146];

        uint16 uriLen = (uint16(uint8(p[287])) << 8) | uint16(uint8(p[288]));
        if (p.length != 289 + uint256(uriLen) + 65) revert InvalidProofLength();
        bytes memory newUri = p[289:289 + uriLen];

        bytes32 nonceKey = keccak256(nonce);
        if (usedNonces[nonceKey]) revert NonceReplay();

        address receiver = _recoverAccessSig(p, h.newDataHash, h.oldDataHash, nonce);
        if (receiver == address(0)) revert InvalidAccessSignature();

        address recoveredOracle = _recoverOracleSig(
            p, 289 + uint256(uriLen),
            h.tokenId, h.oldDataHash, h.newDataHash, h.sealedKey, newUri, nonce
        );
        if (recoveredOracle != EXPECTED_ORACLE) revert InvalidOracleSignature();

        usedNonces[nonceKey] = true;
        out = TransferValidityProofOutput({
            oldDataHash: h.oldDataHash,
            newDataHash: h.newDataHash,
            receiver: receiver,
            sealedKey: h.sealedKey,
            isValid: true
        });
    }
}
