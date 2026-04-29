// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Interface subset of AgentINFT needed by AgentBids for delegation
/// forwarding and proof-threaded transfers.
interface IAgentINFTDelegation {
    function setDelegationFor(
        address receiver,
        uint256 tokenId,
        address oracle,
        uint64 expiresAt,
        bytes calldata sig
    ) external;
    function transferWithProof(address to, uint256 tokenId, bytes calldata proof) external;
    function ORACLE() external view returns (address);
}

/// @notice OpenSea-style standing offer pool for ERC-7857 INFTs.
///
/// Bidders escrow USDC and forward an EIP-712 delegation signature so that
/// when the owner accepts, transferWithProof can complete atomically via the
/// oracle-verified proof path. The oracle-delegated receiver pattern avoids
/// any raw transferFrom call, keeping memoryReencrypted=true after acceptance.
contract AgentBids is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Bid {
        address bidder;
        uint256 amount;
        uint64 createdAt;
        uint64 delegationExpiresAt;
        bool active;
    }

    IERC721 public immutable INFT;
    IERC20 public immutable USDC;

    /// tokenId -> bidder -> Bid
    mapping(uint256 => mapping(address => Bid)) public bids;
    /// tokenId -> bidder list (append-only; check `bids[id][addr].active` for live)
    mapping(uint256 => address[]) private _bidders;

    event BidPlaced(
        uint256 indexed tokenId,
        address indexed bidder,
        uint256 amount
    );
    event BidWithdrawn(
        uint256 indexed tokenId,
        address indexed bidder,
        uint256 amount
    );
    event BidAccepted(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed bidder,
        uint256 amount
    );

    constructor(address inft, address usdc) {
        INFT = IERC721(inft);
        USDC = IERC20(usdc);
    }

    /// @notice Place or top-up a bid, forwarding an EIP-712 delegation sig to
    /// AgentINFT so the oracle can later re-encrypt to msg.sender as receiver.
    /// @param tokenId   The INFT token to bid on.
    /// @param amount    Total escrowed USDC (must exceed previous bid if topping up).
    /// @param delegationExpiresAt Unix timestamp until which the delegation is valid.
    /// @param delegationSig EIP-712 signature from the bidder over
    ///        Delegation(tokenId, oracle, delegationExpiresAt).
    function placeBid(
        uint256 tokenId,
        uint256 amount,
        uint64 delegationExpiresAt,
        bytes calldata delegationSig
    ) external nonReentrant {
        require(amount > 0, "zero");
        address oracle_ = IAgentINFTDelegation(address(INFT)).ORACLE();
        // Forward delegation sig — AgentINFT validates sig recovers to msg.sender.
        IAgentINFTDelegation(address(INFT)).setDelegationFor(
            msg.sender, tokenId, oracle_, delegationExpiresAt, delegationSig
        );
        Bid storage existing = bids[tokenId][msg.sender];
        if (existing.active) {
            require(amount > existing.amount, "must increase");
            uint256 delta = amount - existing.amount;
            USDC.safeTransferFrom(msg.sender, address(this), delta);
            existing.amount = amount;
            existing.delegationExpiresAt = delegationExpiresAt;
        } else {
            USDC.safeTransferFrom(msg.sender, address(this), amount);
            bids[tokenId][msg.sender] = Bid({
                bidder: msg.sender,
                amount: amount,
                createdAt: uint64(block.timestamp),
                delegationExpiresAt: delegationExpiresAt,
                active: true
            });
            _bidders[tokenId].push(msg.sender);
        }
        emit BidPlaced(tokenId, msg.sender, amount);
    }

    /// @notice Withdraw an outstanding bid (before it is accepted).
    function withdrawBid(uint256 tokenId) external nonReentrant {
        Bid storage b = bids[tokenId][msg.sender];
        require(b.active, "no bid");
        uint256 amt = b.amount;
        b.active = false;
        b.amount = 0;
        USDC.safeTransfer(msg.sender, amt);
        emit BidWithdrawn(tokenId, msg.sender, amt);
    }

    /// @notice Owner accepts a bid by providing the oracle-signed transfer
    /// proof. Atomically: deactivates bid, calls transferWithProof (which
    /// re-encrypts memory to the bidder), then pays out USDC to seller.
    /// @param tokenId  The INFT token being sold.
    /// @param bidder   The address whose bid is being accepted.
    /// @param proof    Oracle-signed ERC-7857 transfer-validity proof.
    function acceptBid(
        uint256 tokenId,
        address bidder,
        bytes calldata proof
    ) external nonReentrant {
        require(INFT.ownerOf(tokenId) == msg.sender, "not owner");
        Bid storage b = bids[tokenId][bidder];
        require(b.active, "no bid");
        uint256 amt = b.amount;
        b.active = false;
        b.amount = 0;
        // transferWithProof validates the oracle proof and sets memoryReencrypted=true.
        IAgentINFTDelegation(address(INFT)).transferWithProof(bidder, tokenId, proof);
        USDC.safeTransfer(msg.sender, amt);
        emit BidAccepted(tokenId, msg.sender, bidder, amt);
    }

    function listBidders(
        uint256 tokenId
    ) external view returns (address[] memory) {
        return _bidders[tokenId];
    }

    function biddersCount(uint256 tokenId) external view returns (uint256) {
        return _bidders[tokenId].length;
    }
}
