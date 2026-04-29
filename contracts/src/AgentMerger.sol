// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Interface subset of IdentityRegistry needed by AgentMerger.
interface IIdentityRegistryView {
    struct Agent {
        uint256 agentId;
        string agentDomain;
        address agentAddress;
        address agentWallet;
        uint256 registeredAt;
        bool active;
    }
    function getAgent(uint256 agentId) external view returns (Agent memory);
}

/// @notice Interface subset of ReputationRegistry needed by AgentMerger.
interface IReputationRegistryView {
    function feedbackCount(uint256 agentId) external view returns (uint256);
}

/// @notice Interface subset of AgentINFT needed by AgentMerger for delegation
/// and proof-threaded transfers.
interface IAgentINFTDelegation {
    function setDelegationByOwner(
        address receiver,
        uint256 tokenId,
        address oracle,
        uint64 expiresAt
    ) external;
    function transferWithProof(address to, uint256 tokenId, bytes calldata proof) external;
    function ownerOf(uint256 tokenId) external view returns (address);
    function ORACLE() external view returns (address);
}

/// @dev ERC-721 safe-transfer receiver interface (IERC721Receiver from OZ).
interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}

/// @notice On-chain agent M&A. Two ERC-7857 INFTs combine into a single
/// merged agent: source INFTs transfer into the merger contract (locked
/// custody, conceptually burned for individual operation) via the
/// oracle-verified proof path so memoryReencrypted stays true. Lineage records
/// the constituent IDs + a 0G Storage Merkle root for the combined memory
/// blob, and effectiveFeedbackCount() oracles the sum of constituent rep.
///
/// The merged agent must be pre-registered in IdentityRegistryV2 (via
/// registerByDeployer in a separate tx) before recordMerge — keeping
/// concerns decoupled and avoiding the merger contract needing deployer
/// rights on the registry.
///
/// Caller flow:
///   1. Alice calls inft.setDelegationByOwner(merger, srcToken1, oracle, exp)
///   2. Alice calls inft.setDelegationByOwner(merger, srcToken2, oracle, exp)
///   3. Alice calls merger.recordMerge(..., proof1, ..., proof2, ...)
///      — merger calls inft.transferWithProof(address(this), srcToken1, proof1)
///      — merger calls inft.transferWithProof(address(this), srcToken2, proof2)
contract AgentMerger is IERC721Receiver {
    IIdentityRegistryView public immutable IDENTITY;
    IReputationRegistryView public immutable REPUTATION;
    IAgentINFTDelegation public immutable INFT;

    struct Merger {
        uint256 mergedAgentId;
        uint256 sourceAgentId1;
        uint256 sourceAgentId2;
        uint256 sourceTokenId1;
        uint256 sourceTokenId2;
        bytes32 sealedMemoryRoot;
        string sealedMemoryUri;
        uint64 mergedAt;
        address recordedBy;
    }

    /// 1-indexed; 0 means "not merged".
    mapping(uint256 => uint256) public mergerIndexOfAgent;
    Merger[] internal _mergers;

    event AgentsMerged(
        uint256 indexed mergerIndex,
        uint256 indexed mergedAgentId,
        uint256 sourceAgentId1,
        uint256 sourceAgentId2,
        uint256 sourceTokenId1,
        uint256 sourceTokenId2,
        bytes32 sealedMemoryRoot,
        string sealedMemoryUri,
        address recordedBy
    );

    constructor(
        address identityRegistry,
        address reputationRegistry,
        address inft
    ) {
        IDENTITY = IIdentityRegistryView(identityRegistry);
        REPUTATION = IReputationRegistryView(reputationRegistry);
        INFT = IAgentINFTDelegation(inft);
    }

    /// @notice Record a merge of two source agents into one merged agent.
    /// @param mergedAgentId   Pre-registered ID of the new merged agent.
    /// @param sourceAgentId1  Agent ID of source 1 (for lineage / rep tracking).
    /// @param sourceTokenId1  INFT token ID of source 1.
    /// @param proof1          Oracle-signed ERC-7857 transfer-validity proof for source 1.
    ///                        The proof's newDataHash becomes the sealed memory root for source 1.
    /// @param sourceAgentId2  Agent ID of source 2.
    /// @param sourceTokenId2  INFT token ID of source 2.
    /// @param proof2          Oracle-signed ERC-7857 transfer-validity proof for source 2.
    /// @param sealedMemoryRoot Combined sealed memory Merkle root for the merged agent.
    /// @param sealedMemoryUri  0G Storage URI for the merged memory blob.
    function recordMerge(
        uint256 mergedAgentId,
        uint256 sourceAgentId1,
        uint256 sourceTokenId1,
        bytes calldata proof1,
        uint256 sourceAgentId2,
        uint256 sourceTokenId2,
        bytes calldata proof2,
        bytes32 sealedMemoryRoot,
        string calldata sealedMemoryUri
    ) external returns (uint256 mergerIdx) {
        require(
            mergedAgentId != sourceAgentId1 &&
                mergedAgentId != sourceAgentId2 &&
                sourceAgentId1 != sourceAgentId2,
            "agent ids overlap"
        );
        require(
            IDENTITY.getAgent(mergedAgentId).agentId == mergedAgentId,
            "merged agent missing"
        );
        require(
            IDENTITY.getAgent(sourceAgentId1).agentId == sourceAgentId1,
            "src1 agent missing"
        );
        require(
            IDENTITY.getAgent(sourceAgentId2).agentId == sourceAgentId2,
            "src2 agent missing"
        );
        require(mergerIndexOfAgent[mergedAgentId] == 0, "already merged");

        // Pull source INFTs into custody via proof path. Caller must have
        // called setDelegationByOwner(address(this), srcTokenId, oracle, exp)
        // for each source token before calling this. The proof's receiver
        // field is matched by INFT.transferWithProof against the delegation.
        // This ensures memoryReencrypted=true after the merger.
        INFT.transferWithProof(address(this), sourceTokenId1, proof1);
        INFT.transferWithProof(address(this), sourceTokenId2, proof2);

        _mergers.push(
            Merger({
                mergedAgentId: mergedAgentId,
                sourceAgentId1: sourceAgentId1,
                sourceAgentId2: sourceAgentId2,
                sourceTokenId1: sourceTokenId1,
                sourceTokenId2: sourceTokenId2,
                sealedMemoryRoot: sealedMemoryRoot,
                sealedMemoryUri: sealedMemoryUri,
                mergedAt: uint64(block.timestamp),
                recordedBy: msg.sender
            })
        );
        mergerIdx = _mergers.length; // 1-indexed
        mergerIndexOfAgent[mergedAgentId] = mergerIdx;

        emit AgentsMerged(
            mergerIdx,
            mergedAgentId,
            sourceAgentId1,
            sourceAgentId2,
            sourceTokenId1,
            sourceTokenId2,
            sealedMemoryRoot,
            sealedMemoryUri,
            msg.sender
        );
    }

    function getMerger(
        uint256 mergedAgentId
    ) external view returns (Merger memory) {
        uint256 idx = mergerIndexOfAgent[mergedAgentId];
        require(idx > 0, "not a merge");
        return _mergers[idx - 1];
    }

    function mergerCount() external view returns (uint256) {
        return _mergers.length;
    }

    /// @dev Accept safe ERC-721 transfers (for receiving source INFTs in recordMerge).
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Sum of feedback counts across constituent + merged-self IDs.
    /// For non-merged agents, falls back to the registry's count.
    function effectiveFeedbackCount(
        uint256 agentId
    ) external view returns (uint256) {
        uint256 idx = mergerIndexOfAgent[agentId];
        if (idx == 0) return REPUTATION.feedbackCount(agentId);
        Merger storage m = _mergers[idx - 1];
        return
            REPUTATION.feedbackCount(m.sourceAgentId1) +
            REPUTATION.feedbackCount(m.sourceAgentId2) +
            REPUTATION.feedbackCount(agentId);
    }
}
