// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IdentityRegistry} from "./IdentityRegistry.sol";

contract ReputationRegistry {
    struct Feedback {
        uint256 agentId;
        address client;
        uint8 score;
        uint8 decimals;
        bytes32 tag;
        uint64 timestamp;
    }

    IdentityRegistry public immutable IDENTITY;

    mapping(uint256 => Feedback[]) public feedbackByAgent;

    event FeedbackPosted(
        uint256 indexed agentId,
        address indexed client,
        uint8 score,
        uint8 decimals,
        bytes32 indexed tag,
        uint64 timestamp,
        string detailUri
    );

    constructor(address identityRegistry_) {
        IDENTITY = IdentityRegistry(identityRegistry_);
    }

    function postFeedback(
        uint256 agentId,
        uint8 score,
        uint8 decimals,
        bytes32 tag,
        string calldata detailUri
    ) external {
        require(score <= 100, "score>100");
        IdentityRegistry.Agent memory a = IDENTITY.getAgent(agentId);
        require(a.agentId == agentId, "unknown agent");
        require(a.active, "agent inactive");
        Feedback memory f = Feedback({
            agentId: agentId,
            client: msg.sender,
            score: score,
            decimals: decimals,
            tag: tag,
            timestamp: uint64(block.timestamp)
        });
        feedbackByAgent[agentId].push(f);
        emit FeedbackPosted(
            agentId,
            msg.sender,
            score,
            decimals,
            tag,
            f.timestamp,
            detailUri
        );
    }

    function feedbackCount(uint256 agentId) external view returns (uint256) {
        return feedbackByAgent[agentId].length;
    }

    function feedbackAt(
        uint256 agentId,
        uint256 index
    ) external view returns (Feedback memory) {
        return feedbackByAgent[agentId][index];
    }
}
