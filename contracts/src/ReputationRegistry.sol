// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IIdentityRegistry {
    function getAgent(uint256 id) external view returns (
        uint256 agentId,
        string memory agentDomain,
        address agentAddress,
        address agentWallet,
        uint256 registeredAt,
        bool active
    );
}

contract ReputationRegistry {
    struct Feedback {
        uint256 agentId;
        address client;
        uint8 score;
        uint8 decimals;
        bytes32 tag;
        uint64 timestamp;
    }

    IIdentityRegistry public immutable IDENTITY;

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
        IDENTITY = IIdentityRegistry(identityRegistry_);
    }

    function postFeedback(
        uint256 agentId,
        uint8 score,
        uint8 decimals,
        bytes32 tag,
        string calldata detailUri
    ) external {
        require(score <= 100, "score>100");
        (uint256 id,,,,, bool active) = IDENTITY.getAgent(agentId);
        require(id == agentId, "unknown agent");
        require(active, "agent inactive");
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
