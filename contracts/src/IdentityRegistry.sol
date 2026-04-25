// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract IdentityRegistry {
    struct Agent {
        uint256 agentId;
        string agentDomain;
        address agentAddress;
        address agentWallet;
        uint256 registeredAt;
        bool active;
    }

    uint256 public nextAgentId = 1;

    mapping(uint256 => Agent) public agents;
    mapping(address => uint256) public agentIdOf;

    event AgentRegistered(
        uint256 indexed agentId,
        string agentDomain,
        address indexed agentAddress,
        address agentWallet
    );

    event AgentUpdated(
        uint256 indexed agentId,
        string agentDomain,
        address agentAddress,
        address agentWallet,
        bool active
    );

    function register(
        string calldata agentDomain,
        address agentWallet
    ) external returns (uint256) {
        require(agentIdOf[msg.sender] == 0, "already registered");
        require(agentWallet != address(0), "wallet zero");
        uint256 id = nextAgentId++;
        agents[id] = Agent({
            agentId: id,
            agentDomain: agentDomain,
            agentAddress: msg.sender,
            agentWallet: agentWallet,
            registeredAt: block.timestamp,
            active: true
        });
        agentIdOf[msg.sender] = id;
        emit AgentRegistered(id, agentDomain, msg.sender, agentWallet);
        return id;
    }

    function update(
        string calldata agentDomain,
        address agentWallet,
        bool active
    ) external {
        uint256 id = agentIdOf[msg.sender];
        require(id != 0, "not registered");
        Agent storage a = agents[id];
        a.agentDomain = agentDomain;
        a.agentWallet = agentWallet;
        a.active = active;
        emit AgentUpdated(id, agentDomain, msg.sender, agentWallet, active);
    }

    function getAgent(uint256 id) external view returns (Agent memory) {
        return agents[id];
    }
}
