// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract ValidationRegistry {
    struct ValidationRequest {
        uint256 agentId;
        bytes32 jobId;
        address client;
        string detailUri;
        uint64 createdAt;
        uint64 deadline;
        bool resolved;
    }

    struct ValidationResponse {
        bytes32 jobId;
        address validator;
        uint8 score;
        uint8 decimals;
        uint64 timestamp;
        string detailUri;
    }

    mapping(bytes32 => ValidationRequest) public requests;
    mapping(bytes32 => ValidationResponse[]) public responsesByJob;

    event ValidationRequested(
        bytes32 indexed jobId,
        uint256 indexed agentId,
        address indexed client,
        string detailUri,
        uint64 deadline
    );

    event ValidationResponsePosted(
        bytes32 indexed jobId,
        address indexed validator,
        uint8 score,
        uint8 decimals,
        string detailUri,
        uint64 timestamp
    );

    function requestValidation(
        uint256 agentId,
        bytes32 jobId,
        string calldata detailUri,
        uint64 deadline
    ) external {
        require(requests[jobId].createdAt == 0, "already requested");
        require(deadline > block.timestamp, "deadline in past");
        requests[jobId] = ValidationRequest({
            agentId: agentId,
            jobId: jobId,
            client: msg.sender,
            detailUri: detailUri,
            createdAt: uint64(block.timestamp),
            deadline: deadline,
            resolved: false
        });
        emit ValidationRequested(jobId, agentId, msg.sender, detailUri, deadline);
    }

    function postResponse(
        bytes32 jobId,
        uint8 score,
        uint8 decimals,
        string calldata detailUri
    ) external {
        ValidationRequest storage r = requests[jobId];
        require(r.createdAt != 0, "no such request");
        require(block.timestamp <= r.deadline, "deadline passed");
        require(score <= 100, "score>100");
        ValidationResponse memory resp = ValidationResponse({
            jobId: jobId,
            validator: msg.sender,
            score: score,
            decimals: decimals,
            timestamp: uint64(block.timestamp),
            detailUri: detailUri
        });
        responsesByJob[jobId].push(resp);
        if (!r.resolved) r.resolved = true;
        emit ValidationResponsePosted(
            jobId,
            msg.sender,
            score,
            decimals,
            detailUri,
            resp.timestamp
        );
    }

    function responseCount(bytes32 jobId) external view returns (uint256) {
        return responsesByJob[jobId].length;
    }

    function responseAt(
        bytes32 jobId,
        uint256 index
    ) external view returns (ValidationResponse memory) {
        return responsesByJob[jobId][index];
    }
}
