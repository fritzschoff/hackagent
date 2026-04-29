// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Subset of 0G's reference IERC7857DataVerifier interface, ported
/// to match the byte layout of 0G/0gfoundation/0g-agent-nft (eip-7857-draft)
/// contracts/interfaces/IERC7857DataVerifier.sol. We use only what AgentINFT
/// needs for transfer + mint flows.
struct PreimageProofOutput {
    bytes32 dataHash;
    bool isValid;
}

struct TransferValidityProofOutput {
    bytes32 oldDataHash;
    bytes32 newDataHash;
    address receiver;
    bytes16 sealedKey;
    bool isValid;
}

interface IERC7857DataVerifier {
    function verifyPreimage(bytes[] calldata _proofs)
        external returns (PreimageProofOutput[] memory);

    function verifyTransferValidity(bytes[] calldata _proofs)
        external returns (TransferValidityProofOutput[] memory);

    function expectedOracle() external view returns (address);
}
