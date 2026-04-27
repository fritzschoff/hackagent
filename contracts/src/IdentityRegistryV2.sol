// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IAgentINFT {
    function tokenIdForAgent(uint256 agentId) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @notice ERC-8004 IdentityRegistry v2 — adds the §4.4 anti-laundering wallet
/// rotation flow. On INFT transfer, the linked AgentINFT contract calls
/// `clearAgentWalletOnTransfer` to zero out the payout address. The new owner
/// must then submit `setAgentWallet` with an EIP-712 signature before x402
/// payments are routed again.
contract IdentityRegistryV2 is EIP712 {
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
    mapping(uint256 => uint256) public agentNonces;

    address public immutable deployer;
    address public inft;

    bytes32 private constant SET_AGENT_WALLET_TYPEHASH =
        keccak256(
            "SetAgentWallet(uint256 agentId,address newWallet,uint256 deadline,uint256 nonce)"
        );

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
    event AgentWalletCleared(uint256 indexed agentId);
    event AgentWalletSet(uint256 indexed agentId, address indexed newWallet);
    event InftSet(address indexed inft);

    constructor() EIP712("ERC8004IdentityRegistryV2", "1") {
        deployer = msg.sender;
    }

    function setInft(address inft_) external {
        require(msg.sender == deployer, "not deployer");
        require(inft == address(0), "already set");
        require(inft_ != address(0), "zero");
        inft = inft_;
        emit InftSet(inft_);
    }

    function register(
        string calldata agentDomain,
        address agentWallet
    ) external returns (uint256) {
        return _register(msg.sender, agentDomain, agentWallet);
    }

    /// @notice Deployer-only path: register an agent whose private key cannot
    /// pay for its own gas. msg.sender remains the broadcaster but the
    /// agentAddress is whatever caller specifies, preserving ERC-8004 §4.1
    /// semantics (agentAddress = the agent's primary on-chain identity).
    function registerByDeployer(
        address agentAddress,
        string calldata agentDomain,
        address agentWallet
    ) external returns (uint256) {
        require(msg.sender == deployer, "not deployer");
        require(agentAddress != address(0), "agent zero");
        return _register(agentAddress, agentDomain, agentWallet);
    }

    function _register(
        address agentAddress,
        string calldata agentDomain,
        address agentWallet
    ) internal returns (uint256) {
        require(agentIdOf[agentAddress] == 0, "already registered");
        require(agentWallet != address(0), "wallet zero");
        uint256 id = nextAgentId++;
        agents[id] = Agent({
            agentId: id,
            agentDomain: agentDomain,
            agentAddress: agentAddress,
            agentWallet: agentWallet,
            registeredAt: block.timestamp,
            active: true
        });
        agentIdOf[agentAddress] = id;
        emit AgentRegistered(id, agentDomain, agentAddress, agentWallet);
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

    function clearAgentWalletOnTransfer(uint256 agentId) external {
        require(msg.sender == inft, "only INFT");
        require(agents[agentId].agentId == agentId, "unknown agent");
        agents[agentId].agentWallet = address(0);
        emit AgentWalletCleared(agentId);
    }

    function setAgentWallet(
        uint256 agentId,
        address newWallet,
        uint256 deadline,
        bytes calldata sig
    ) external {
        require(block.timestamp <= deadline, "deadline passed");
        require(newWallet != address(0), "wallet zero");
        require(inft != address(0), "inft not set");
        require(agents[agentId].agentId == agentId, "unknown agent");

        uint256 nonce = agentNonces[agentId]++;
        bytes32 structHash = keccak256(
            abi.encode(
                SET_AGENT_WALLET_TYPEHASH,
                agentId,
                newWallet,
                deadline,
                nonce
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, sig);

        uint256 tokenId = IAgentINFT(inft).tokenIdForAgent(agentId);
        require(tokenId != 0, "no inft minted for agent");
        require(
            IAgentINFT(inft).ownerOf(tokenId) == signer,
            "not inft owner"
        );

        agents[agentId].agentWallet = newWallet;
        emit AgentWalletSet(agentId, newWallet);
    }

    function getAgent(uint256 id) external view returns (Agent memory) {
        return agents[id];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
