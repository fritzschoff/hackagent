// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

interface IIdentityRegistryV2 {
    function clearAgentWalletOnTransfer(uint256 agentId) external;
}

/// @notice Minimal ERC-7857 INFT for an ERC-8004-registered agent.
///
/// `encryptedMemoryRoot` is the 0G Storage Merkle root of the agent's
/// encrypted memory blob; `encryptedMemoryUri` is the retrieval pointer
/// (`og://<root>`). Real ERC-7857 demands TEE-attested re-encryption on
/// transfer; this implementation tracks the pointer only and leaves the
/// re-encryption oracle as a future extension.
///
/// On every owner-to-owner transfer, this contract calls back into
/// IdentityRegistryV2 to clear the agent's payout wallet (EIP-8004 §4.4
/// anti-laundering). The new owner must re-sign `setAgentWallet` before
/// x402 payments resume.
contract AgentINFT is ERC721 {
    IIdentityRegistryV2 public immutable IDENTITY;
    address public immutable deployer;

    uint256 private _nextTokenId = 1;
    string private _baseTokenURI;

    mapping(uint256 => uint256) public agentIdOfToken;
    mapping(uint256 => uint256) public tokenIdForAgent;
    mapping(uint256 => bytes32) public encryptedMemoryRoot;
    mapping(uint256 => string) public encryptedMemoryUri;

    event AgentMinted(
        uint256 indexed tokenId,
        uint256 indexed agentId,
        address indexed to,
        bytes32 encryptedMemoryRoot,
        string encryptedMemoryUri
    );
    event MemoryUpdated(
        uint256 indexed tokenId,
        bytes32 newRoot,
        string newUri
    );
    event BaseURISet(string baseURI);

    constructor(
        address identityRegistry_,
        string memory baseTokenURI_
    ) ERC721("Tradewise Agent INFT", "AGENT") {
        IDENTITY = IIdentityRegistryV2(identityRegistry_);
        deployer = msg.sender;
        _baseTokenURI = baseTokenURI_;
    }

    function mint(
        address to,
        uint256 agentId,
        bytes32 encryptedRoot,
        string calldata uri
    ) external returns (uint256) {
        require(msg.sender == deployer, "only deployer mints");
        require(tokenIdForAgent[agentId] == 0, "already minted");
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        agentIdOfToken[tokenId] = agentId;
        tokenIdForAgent[agentId] = tokenId;
        encryptedMemoryRoot[tokenId] = encryptedRoot;
        encryptedMemoryUri[tokenId] = uri;
        emit AgentMinted(tokenId, agentId, to, encryptedRoot, uri);
        return tokenId;
    }

    function updateMemory(
        uint256 tokenId,
        bytes32 newRoot,
        string calldata newUri
    ) external {
        address owner_ = _ownerOf(tokenId);
        require(owner_ != address(0), "nonexistent");
        require(
            _isAuthorized(owner_, msg.sender, tokenId),
            "not authorized"
        );
        encryptedMemoryRoot[tokenId] = newRoot;
        encryptedMemoryUri[tokenId] = newUri;
        emit MemoryUpdated(tokenId, newRoot, newUri);
    }

    function setBaseURI(string calldata baseURI_) external {
        require(msg.sender == deployer, "only deployer");
        _baseTokenURI = baseURI_;
        emit BaseURISet(baseURI_);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    /// OZ v5 hook fires on every mint, transfer, and burn.
    /// We only clear the agent wallet on owner-to-owner transfers
    /// (not mint, not burn) so the demo flow is:
    ///   mint        -> wallet stays as registered
    ///   transfer    -> wallet cleared, new owner must re-sign
    ///   burn        -> wallet stays cleared (irrelevant, agent gone)
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) {
            uint256 agentId = agentIdOfToken[tokenId];
            if (agentId != 0) {
                IDENTITY.clearAgentWalletOnTransfer(agentId);
            }
        }
        return from;
    }
}
