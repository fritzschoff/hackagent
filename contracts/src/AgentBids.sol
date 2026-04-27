// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice OpenSea-style standing offer pool for ERC-721 INFTs.
///
/// Bidders escrow USDC. The owner of a tokenId may accept any standing bid at
/// any time, atomically swapping INFT for the escrowed amount. There is no
/// expiry; bidders may withdraw their bid until accepted. Top-ups replace the
/// existing bid amount (must increase).
contract AgentBids is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Bid {
        address bidder;
        uint256 amount;
        uint64 createdAt;
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

    function placeBid(
        uint256 tokenId,
        uint256 amount
    ) external nonReentrant {
        require(amount > 0, "zero");
        Bid storage existing = bids[tokenId][msg.sender];
        if (existing.active) {
            require(amount > existing.amount, "must increase");
            uint256 delta = amount - existing.amount;
            USDC.safeTransferFrom(msg.sender, address(this), delta);
            existing.amount = amount;
        } else {
            USDC.safeTransferFrom(msg.sender, address(this), amount);
            bids[tokenId][msg.sender] = Bid({
                bidder: msg.sender,
                amount: amount,
                createdAt: uint64(block.timestamp),
                active: true
            });
            _bidders[tokenId].push(msg.sender);
        }
        emit BidPlaced(tokenId, msg.sender, amount);
    }

    function withdrawBid(uint256 tokenId) external nonReentrant {
        Bid storage b = bids[tokenId][msg.sender];
        require(b.active, "no bid");
        uint256 amt = b.amount;
        b.active = false;
        b.amount = 0;
        USDC.safeTransfer(msg.sender, amt);
        emit BidWithdrawn(tokenId, msg.sender, amt);
    }

    function acceptBid(
        uint256 tokenId,
        address bidder
    ) external nonReentrant {
        require(INFT.ownerOf(tokenId) == msg.sender, "not owner");
        Bid storage b = bids[tokenId][bidder];
        require(b.active, "no bid");
        uint256 amt = b.amount;
        b.active = false;
        b.amount = 0;
        // safeTransferFrom triggers AgentINFT._update, which clears the
        // ERC-8004 agentWallet (EIP-8004 §4.4 anti-laundering).
        INFT.safeTransferFrom(msg.sender, bidder, tokenId);
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
