// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

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

interface IReputationRegistryView {
    function feedbackCount(uint256 agentId) external view returns (uint256);
}

/// @notice On-chain agent M&A. Two ERC-7857 INFTs combine into a single
/// merged agent: source INFTs transfer into the merger contract (locked
/// custody, conceptually burned for individual operation), lineage records
/// the constituent IDs + a 0G Storage Merkle root for the combined memory
/// blob, and effectiveFeedbackCount() oracles the sum of constituent rep.
///
/// The merged agent must be pre-registered in IdentityRegistryV2 (via
/// registerByDeployer in a separate tx) before recordMerge — keeping
/// concerns decoupled and avoiding the merger contract needing deployer
/// rights on the registry.
contract AgentMerger {
    IIdentityRegistryView public immutable IDENTITY;
    IReputationRegistryView public immutable REPUTATION;
    IERC721 public immutable INFT;

    struct Merger {
        uint256 mergedAgentId;
        uint256 sourceAgentId1;
        uint256 sourceAgentId2;
        uint256 sourceTokenId1;
        uint256 sourceTokenId2;
        bytes32 sealedMemoryRoot;
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
        address recordedBy
    );

    constructor(
        address identityRegistry,
        address reputationRegistry,
        address inft
    ) {
        IDENTITY = IIdentityRegistryView(identityRegistry);
        REPUTATION = IReputationRegistryView(reputationRegistry);
        INFT = IERC721(inft);
    }

    function recordMerge(
        uint256 mergedAgentId,
        uint256 sourceAgentId1,
        uint256 sourceTokenId1,
        uint256 sourceAgentId2,
        uint256 sourceTokenId2,
        bytes32 sealedMemoryRoot
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

        // Pull source INFTs into custody. Caller must hold both and have
        // approved this contract via setApprovalForAll. The transfers
        // trigger AgentINFT._update which clears the agentWallet on V2 for
        // each constituent — semantically correct: post-merger the source
        // agents stop receiving payouts.
        INFT.transferFrom(msg.sender, address(this), sourceTokenId1);
        INFT.transferFrom(msg.sender, address(this), sourceTokenId2);

        _mergers.push(
            Merger({
                mergedAgentId: mergedAgentId,
                sourceAgentId1: sourceAgentId1,
                sourceAgentId2: sourceAgentId2,
                sourceTokenId1: sourceTokenId1,
                sourceTokenId2: sourceTokenId2,
                sealedMemoryRoot: sealedMemoryRoot,
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
