// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC7857DataVerifier, PreimageProofOutput, TransferValidityProofOutput} from "./IERC7857DataVerifier.sol";

interface IIdentityRegistryV2 {
    function clearAgentWalletOnTransfer(uint256 agentId) external;
}

/// @notice ERC-7857 Agent INFT with on-spec re-encryption oracle hook.
/// transferWithProof routes through the verifier; raw ERC-721 transferFrom
/// is allowed but flips memoryReencrypted=false (badge-stale).
contract AgentINFT is ERC721, EIP712 {
    IIdentityRegistryV2 public immutable IDENTITY;
    IERC7857DataVerifier public immutable VERIFIER;
    address public immutable ORACLE;
    address public immutable deployer;

    uint256 private _nextTokenId = 1;
    string private _baseTokenURI;

    // Storage layout preserved from v1 (slots must not move):
    mapping(uint256 => uint256) public agentIdOfToken;
    mapping(uint256 => uint256) public tokenIdForAgent;
    mapping(uint256 => bytes32) public encryptedMemoryRoot;
    mapping(uint256 => string) public encryptedMemoryUri;
    // New state appended after v1 mappings:
    mapping(uint256 => bool) public memoryReencrypted;

    struct Delegation {
        address oracle;
        uint64 expiresAt;
    }
    mapping(address => mapping(uint256 => Delegation)) public delegations;

    bytes32 public constant DELEGATION_TYPEHASH =
        keccak256("Delegation(uint256 tokenId,address oracle,uint64 expiresAt)");

    event AgentMinted(
        uint256 indexed tokenId,
        uint256 indexed agentId,
        address indexed to,
        bytes32 encryptedMemoryRoot,
        string encryptedMemoryUri
    );
    event MemoryUpdated(uint256 indexed tokenId, bytes32 newRoot, string newUri);
    event Transferred(uint256 indexed tokenId, address indexed from, address indexed to);
    event PublishedSealedKey(address indexed to, uint256 indexed tokenId, bytes16[] sealedKeys);
    event MemoryReencrypted(uint256 indexed tokenId, bytes32 newRoot, string newUri);
    event DelegationSet(
        address indexed bidder,
        uint256 indexed tokenId,
        address oracle,
        uint64 expiresAt
    );
    event DelegationCleared(address indexed bidder, uint256 indexed tokenId);
    event MemoryStaled(uint256 indexed tokenId);
    event BaseURISet(string baseURI);

    error VerifierOracleMismatch();
    error InvalidMintProof();
    error InvalidTransferProof();
    error OldRootMismatch();
    error UndelegatedReceiver();
    error DelegationExpired();
    error WrongOracle();
    error ExpiresOutOfBounds();
    error InvalidDelegationSig();
    error NotOwnerOfToken();

    /// Transient flag: set to 1 inside transferWithProof so _update knows it's
    /// the proof path. Solidity 0.8.28 supports the `transient` storage class.
    uint256 private transient _proofPath;

    constructor(
        address identityRegistry_,
        string memory baseTokenURI_,
        address verifier_,
        address oracle_
    ) ERC721("Tradewise Agent INFT", "AGENT") EIP712("AgentINFT", "1") {
        require(identityRegistry_ != address(0), "registry zero");
        require(verifier_ != address(0), "verifier zero");
        require(oracle_ != address(0), "oracle zero");
        if (IERC7857DataVerifier(verifier_).expectedOracle() != oracle_) {
            revert VerifierOracleMismatch();
        }
        IDENTITY = IIdentityRegistryV2(identityRegistry_);
        VERIFIER = IERC7857DataVerifier(verifier_);
        ORACLE = oracle_;
        deployer = msg.sender;
        _baseTokenURI = baseTokenURI_;
    }

    // =========================================================================
    // Mint
    // =========================================================================

    function mint(address to, uint256 agentId, bytes calldata mintProof)
        external returns (uint256)
    {
        require(msg.sender == deployer, "only deployer mints");
        require(tokenIdForAgent[agentId] == 0, "already minted");

        bytes[] memory proofs = new bytes[](1);
        proofs[0] = mintProof;
        PreimageProofOutput[] memory out = VERIFIER.verifyPreimage(proofs);
        if (!out[0].isValid) revert InvalidMintProof();

        bytes32 root = out[0].dataHash;
        string memory uri = string(abi.encodePacked("og://", _toHex(root)));

        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        agentIdOfToken[tokenId] = agentId;
        tokenIdForAgent[agentId] = tokenId;
        encryptedMemoryRoot[tokenId] = root;
        encryptedMemoryUri[tokenId] = uri;
        memoryReencrypted[tokenId] = true;

        emit AgentMinted(tokenId, agentId, to, root, uri);
        bytes16[] memory empty;
        emit PublishedSealedKey(to, tokenId, empty);
        return tokenId;
    }

    // =========================================================================
    // Delegation
    // =========================================================================

    function setDelegation(uint256 tokenId, address oracle_, uint64 expiresAt)
        external
    {
        if (oracle_ != ORACLE) revert WrongOracle();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + 365 days) {
            revert ExpiresOutOfBounds();
        }
        delegations[msg.sender][tokenId] = Delegation(oracle_, expiresAt);
        emit DelegationSet(msg.sender, tokenId, oracle_, expiresAt);
    }

    function setDelegationFor(
        address receiver,
        uint256 tokenId,
        address oracle_,
        uint64 expiresAt,
        bytes calldata sig
    ) external {
        if (oracle_ != ORACLE) revert WrongOracle();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + 365 days) {
            revert ExpiresOutOfBounds();
        }
        bytes32 structHash = keccak256(abi.encode(
            DELEGATION_TYPEHASH, tokenId, oracle_, expiresAt
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, sig);
        if (signer != receiver) revert InvalidDelegationSig();
        delegations[receiver][tokenId] = Delegation(oracle_, expiresAt);
        emit DelegationSet(receiver, tokenId, oracle_, expiresAt);
    }

    function setDelegationByOwner(
        address receiver,
        uint256 tokenId,
        address oracle_,
        uint64 expiresAt
    ) external {
        if (_ownerOf(tokenId) != msg.sender) revert NotOwnerOfToken();
        if (oracle_ != ORACLE) revert WrongOracle();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + 365 days) {
            revert ExpiresOutOfBounds();
        }
        delegations[receiver][tokenId] = Delegation(oracle_, expiresAt);
        emit DelegationSet(receiver, tokenId, oracle_, expiresAt);
    }

    function clearDelegation(uint256 tokenId) external {
        delete delegations[msg.sender][tokenId];
        emit DelegationCleared(msg.sender, tokenId);
    }

    function isDelegated(address receiver, uint256 tokenId)
        external view returns (bool)
    {
        Delegation memory d = delegations[receiver][tokenId];
        return d.oracle == ORACLE && d.expiresAt > block.timestamp;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // =========================================================================
    // Transfer with proof
    // =========================================================================

    function transferWithProof(address to, uint256 tokenId, bytes calldata proof)
        external
    {
        address currentOwner = _ownerOf(tokenId);
        require(currentOwner != address(0), "nonexistent");
        require(_isAuthorized(currentOwner, msg.sender, tokenId), "not owner/approved");

        bytes[] memory proofs = new bytes[](1);
        proofs[0] = proof;
        TransferValidityProofOutput[] memory out = VERIFIER.verifyTransferValidity(proofs);
        if (!out[0].isValid) revert InvalidTransferProof();
        if (out[0].oldDataHash != encryptedMemoryRoot[tokenId]) revert OldRootMismatch();

        _validateReceiver(to, tokenId, out[0].receiver);

        // Parse newUri from proof tail (offsets 287..289 = uriLen, then uri).
        uint16 uriLen = (uint16(uint8(proof[287])) << 8) | uint16(uint8(proof[288]));
        string memory newUri = string(proof[289:289 + uriLen]);

        encryptedMemoryRoot[tokenId] = out[0].newDataHash;
        encryptedMemoryUri[tokenId] = newUri;
        memoryReencrypted[tokenId] = true;

        _proofPath = 1;
        _safeTransfer(currentOwner, to, tokenId);
        _proofPath = 0;

        emit Transferred(tokenId, currentOwner, to);
        emit MemoryReencrypted(tokenId, out[0].newDataHash, newUri);
        bytes16[] memory keys = new bytes16[](1);
        keys[0] = out[0].sealedKey;
        emit PublishedSealedKey(to, tokenId, keys);
    }

    /// @dev Extracted to avoid stack-too-deep in transferWithProof.
    function _validateReceiver(address to, uint256 tokenId, address proofReceiver) internal view {
        bool directReceiverMatch = (proofReceiver == to);
        Delegation memory d = delegations[to][tokenId];
        bool delegationMatch = (d.oracle == proofReceiver
            && d.oracle == ORACLE
            && d.expiresAt > block.timestamp);

        if (!directReceiverMatch && !delegationMatch) {
            // Distinguish expired delegation from never-delegated
            if (d.expiresAt > 0 && d.expiresAt <= block.timestamp) {
                revert DelegationExpired();
            }
            revert UndelegatedReceiver();
        }
    }

    // =========================================================================
    // Memory update (oracle-less path, clears memoryReencrypted)
    // =========================================================================

    function updateMemory(uint256 tokenId, bytes32 newRoot, string calldata newUri)
        external
    {
        address owner_ = _ownerOf(tokenId);
        require(owner_ != address(0), "nonexistent");
        require(_isAuthorized(owner_, msg.sender, tokenId), "not authorized");
        encryptedMemoryRoot[tokenId] = newRoot;
        encryptedMemoryUri[tokenId] = newUri;
        memoryReencrypted[tokenId] = true;
        emit MemoryUpdated(tokenId, newRoot, newUri);
    }

    // =========================================================================
    // OZ ERC-721 hooks
    // =========================================================================

    /// OZ v5 hook fires on every mint/transfer/burn. We:
    ///   - clear agentWallet on owner-to-owner transfers (existing behavior)
    ///   - flip memoryReencrypted=false on raw transferFrom (no proof path)
    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address)
    {
        address from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) {
            uint256 agentId = agentIdOfToken[tokenId];
            if (agentId != 0) {
                IDENTITY.clearAgentWalletOnTransfer(agentId);
            }
            if (_proofPath == 0) {
                memoryReencrypted[tokenId] = false;
                emit MemoryStaled(tokenId);
            }
        }
        return from;
    }

    // =========================================================================
    // BaseURI
    // =========================================================================

    function setBaseURI(string calldata baseURI_) external {
        require(msg.sender == deployer, "only deployer");
        _baseTokenURI = baseURI_;
        emit BaseURISet(baseURI_);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    function _toHex(bytes32 v) internal pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory s = new bytes(66);
        s[0] = "0";
        s[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(v[i]);
            s[2 + i * 2]     = hexChars[b >> 4];
            s[2 + i * 2 + 1] = hexChars[b & 0x0f];
        }
        return string(s);
    }
}
