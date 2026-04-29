// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IdentityRegistryV2} from "../src/IdentityRegistryV2.sol";
import {AgentINFT} from "../src/AgentINFT.sol";
import {AgentINFTVerifier} from "../src/AgentINFTVerifier.sol";
import {AgentBids} from "../src/AgentBids.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("MockUSDC", "USDC") {}
    function decimals() public pure override returns (uint8) {
        return 6;
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract AgentBidsTest is Test {
    IdentityRegistryV2 internal reg;
    AgentINFTVerifier internal verifier;
    AgentINFT internal inft;
    AgentBids internal bids;
    MockUSDC internal usdc;

    address internal deployer = address(0xD0A);
    address internal alice = address(0xA110);
    uint256 internal oraclePk = 0xA11CE;
    address internal oracle;

    uint256 internal constant TOKEN_ID = 1;
    bytes32 internal constant INITIAL_ROOT = keccak256("root");

    function setUp() public {
        oracle = vm.addr(oraclePk);
        vm.startPrank(deployer);
        reg = new IdentityRegistryV2();
        verifier = new AgentINFTVerifier(oracle);
        inft = new AgentINFT(address(reg), "https://x.test/", address(verifier), oracle);
        reg.setInft(address(inft));
        reg.registerByDeployer(alice, "alice.test", alice);
        usdc = new MockUSDC();
        bids = new AgentBids(address(inft), address(usdc));
        // Mint token 1 to alice
        bytes memory nonce = abi.encodePacked(uint256(1), uint128(0));
        bytes memory proof = _mintProof(INITIAL_ROOT, nonce);
        inft.mint(alice, 1, proof);
        vm.stopPrank();
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    function _signEip191(uint256 pk, bytes32 messageHash)
        internal pure returns (bytes memory)
    {
        bytes32 prefixed = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, prefixed);
        return abi.encodePacked(r, s, v);
    }

    function _mintProof(bytes32 dataHash, bytes memory nonce) internal view returns (bytes memory) {
        bytes32 messageHash = keccak256(abi.encodePacked("inft-mint-v1", dataHash, nonce));
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, prefixed);
        return abi.encodePacked(bytes1(0x00), abi.encodePacked(r, s, v), dataHash, nonce);
    }

    /// @dev Build an EIP-712 delegation sig for `receiver` over
    ///      Delegation(tokenId, oracle, expiresAt).
    function _delegationSig(
        uint256 pk,
        uint256 tokenId,
        uint64 expiresAt
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            inft.DELEGATION_TYPEHASH(), tokenId, oracle, expiresAt
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01", inft.domainSeparator(), structHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Build an oracle-signed ERC-7857 transfer validity proof.
    function _transferProof(
        uint256 tokenId,
        bytes32 oldHash,
        bytes32 newHash,
        bytes16 sealedKey,
        bytes memory nonce,
        string memory newUri,
        uint256 receiverPk
    ) internal view returns (bytes memory) {
        bytes memory accessSig = _signEip191(
            receiverPk,
            keccak256(abi.encodePacked(newHash, oldHash, nonce))
        );
        bytes memory uriBytes = bytes(newUri);
        bytes memory oracleSig = _signEip191(
            oraclePk,
            keccak256(abi.encodePacked(
                tokenId, oldHash, newHash, sealedKey, keccak256(uriBytes), nonce
            ))
        );
        return abi.encodePacked(
            bytes1(0x40),
            tokenId,
            accessSig,
            nonce,
            newHash,
            oldHash,
            sealedKey,
            hex"0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
            hex"000102030405060708090A0B",
            hex"000102030405060708090A0B0C0D0E0F",
            abi.encodePacked(uint16(uriBytes.length)),
            uriBytes,
            oracleSig
        );
    }

    /// @dev Fund a user with USDC and approve the bids contract.
    function _fundUsdc(address user, uint256 amount) internal {
        usdc.mint(user, amount);
        vm.prank(user);
        usdc.approve(address(bids), amount);
    }

    /// @dev Place a bid from `bidder` (pk) for TOKEN_ID, returns the bidder address.
    function _placeBid(
        uint256 bidderPk,
        uint256 tokenId,
        uint256 amount,
        uint64 exp
    ) internal returns (address bidder) {
        bidder = vm.addr(bidderPk);
        _fundUsdc(bidder, amount);
        bytes memory sig = _delegationSig(bidderPk, tokenId, exp);
        vm.prank(bidder);
        bids.placeBid(tokenId, amount, exp, sig);
    }

    // =========================================================================
    // placeBid: delegation forwarding
    // =========================================================================

    function test_placeBid_forwardsDelegation() public {
        uint256 bobPk = 0xB1DD3;
        uint64 exp = uint64(block.timestamp + 30 days);
        address bidder = _placeBid(bobPk, TOKEN_ID, 100e6, exp);

        assertTrue(inft.isDelegated(bidder, TOKEN_ID));
        (address bidderStored, uint256 amount, , , bool active) = bids.bids(TOKEN_ID, bidder);
        assertEq(bidderStored, bidder);
        assertEq(amount, 100e6);
        assertTrue(active);
        assertEq(usdc.balanceOf(address(bids)), 100e6);
    }

    function test_placeBid_escrowsAndRecordsBidder() public {
        uint256 bobPk = 0xB0B1;
        uint64 exp = uint64(block.timestamp + 30 days);
        address bidder = _placeBid(bobPk, TOKEN_ID, 5_000_000, exp);

        (address bidderStored, uint256 amount, , , bool active) = bids.bids(TOKEN_ID, bidder);
        assertEq(bidderStored, bidder);
        assertEq(amount, 5_000_000);
        assertTrue(active);
        assertEq(usdc.balanceOf(address(bids)), 5_000_000);
        assertEq(bids.biddersCount(TOKEN_ID), 1);
    }

    function test_placeBid_topUpIncreases() public {
        uint256 bobPk = 0xB0B2;
        address bidder = vm.addr(bobPk);
        uint64 exp = uint64(block.timestamp + 30 days);

        // Fund extra for two bids
        _fundUsdc(bidder, 10_000_000);

        bytes memory sig1 = _delegationSig(bobPk, TOKEN_ID, exp);
        vm.prank(bidder);
        bids.placeBid(TOKEN_ID, 5_000_000, exp, sig1);

        bytes memory sig2 = _delegationSig(bobPk, TOKEN_ID, exp);
        vm.prank(bidder);
        bids.placeBid(TOKEN_ID, 8_000_000, exp, sig2);

        (, uint256 amount, , , ) = bids.bids(TOKEN_ID, bidder);
        assertEq(amount, 8_000_000);
        assertEq(usdc.balanceOf(address(bids)), 8_000_000);
        assertEq(bids.biddersCount(TOKEN_ID), 1, "no double-counting");
    }

    function test_placeBid_topUpRequiresHigher() public {
        uint256 bobPk = 0xB0B3;
        address bidder = vm.addr(bobPk);
        uint64 exp = uint64(block.timestamp + 30 days);

        _fundUsdc(bidder, 10_000_000);

        bytes memory sig1 = _delegationSig(bobPk, TOKEN_ID, exp);
        vm.prank(bidder);
        bids.placeBid(TOKEN_ID, 5_000_000, exp, sig1);

        bytes memory sig2 = _delegationSig(bobPk, TOKEN_ID, exp);
        vm.prank(bidder);
        vm.expectRevert(bytes("must increase"));
        bids.placeBid(TOKEN_ID, 5_000_000, exp, sig2);
    }

    function test_placeBid_invalidDelegationSig_reverts_USDCNotPulled() public {
        uint256 bobPk = 0xB0B4;
        address bidder = vm.addr(bobPk);
        uint64 exp = uint64(block.timestamp + 30 days);

        _fundUsdc(bidder, 100e6);

        // Sign with a wrong key (not bobPk)
        uint256 wrongPk = 0xDEADBEEF;
        bytes32 structHash = keccak256(abi.encode(
            inft.DELEGATION_TYPEHASH(), TOKEN_ID, oracle, exp
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01", inft.domainSeparator(), structHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPk, digest);
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.prank(bidder);
        vm.expectRevert(AgentINFT.InvalidDelegationSig.selector);
        bids.placeBid(TOKEN_ID, 100e6, exp, badSig);

        // USDC must not have been pulled
        assertEq(usdc.balanceOf(address(bids)), 0);
    }

    // =========================================================================
    // withdrawBid
    // =========================================================================

    function test_withdraw_returnsFundsAndDeactivates() public {
        uint256 bobPk = 0xB0B5;
        address bidder = vm.addr(bobPk);
        uint64 exp = uint64(block.timestamp + 30 days);

        uint256 initialBalance = 5_000_000;
        _fundUsdc(bidder, initialBalance);

        bytes memory sig = _delegationSig(bobPk, TOKEN_ID, exp);
        vm.prank(bidder);
        bids.placeBid(TOKEN_ID, initialBalance, exp, sig);

        vm.prank(bidder);
        bids.withdrawBid(TOKEN_ID);

        (, uint256 amount, , , bool active) = bids.bids(TOKEN_ID, bidder);
        assertEq(amount, 0);
        assertFalse(active);
        assertEq(usdc.balanceOf(bidder), initialBalance);
    }

    function test_withdraw_revertsWithoutBid() public {
        address stranger = address(0x9999);
        vm.prank(stranger);
        vm.expectRevert(bytes("no bid"));
        bids.withdrawBid(TOKEN_ID);
    }

    // =========================================================================
    // acceptBid: proof threading
    // =========================================================================

    function test_acceptBid_threadsProofToInft_atomic() public {
        uint256 bobPk = 0xB0B6;
        address bidder = vm.addr(bobPk);
        uint64 exp = uint64(block.timestamp + 30 days);

        // Place bid (delegation forwarded)
        _fundUsdc(bidder, 5_000_000);
        bytes memory sig = _delegationSig(bobPk, TOKEN_ID, exp);
        vm.prank(bidder);
        bids.placeBid(TOKEN_ID, 5_000_000, exp, sig);

        // Build a valid transfer proof.
        // In the delegation path the access sig is signed by the oracle
        // (the oracle is the receiver-proxy, d.oracle == proofReceiver).
        bytes32 newRoot = keccak256("new-root");
        bytes16 sealedKey = bytes16(keccak256("key"));
        bytes memory nonce = abi.encodePacked(uint256(100), uint128(0));
        bytes memory proof = _transferProof(
            TOKEN_ID, INITIAL_ROOT, newRoot, sealedKey, nonce, "og://new", oraclePk
        );

        // Alice approves bids contract (needed for transferWithProof caller check)
        // Actually transferWithProof checks _isAuthorized: owner or approved.
        // AgentBids calls transferWithProof as msg.sender = bids contract.
        // Alice must approve the bids contract.
        vm.prank(alice);
        inft.setApprovalForAll(address(bids), true);

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        bids.acceptBid(TOKEN_ID, bidder, proof);

        // Token transferred to bidder via proof path
        assertEq(inft.ownerOf(TOKEN_ID), bidder);
        // Memory re-encrypted (not stale)
        assertTrue(inft.memoryReencrypted(TOKEN_ID));
        // New root stored
        assertEq(inft.encryptedMemoryRoot(TOKEN_ID), newRoot);
        // Seller paid
        assertEq(usdc.balanceOf(alice), aliceUsdcBefore + 5_000_000);
        // Bid deactivated
        (, uint256 amount, , , bool active) = bids.bids(TOKEN_ID, bidder);
        assertEq(amount, 0);
        assertFalse(active);
    }

    function test_acceptBid_invalidProof_reverts_USDCStaysEscrowed() public {
        uint256 bobPk = 0xB0B7;
        address bidder = vm.addr(bobPk);
        uint64 exp = uint64(block.timestamp + 30 days);

        _fundUsdc(bidder, 5_000_000);
        bytes memory sig = _delegationSig(bobPk, TOKEN_ID, exp);
        vm.prank(bidder);
        bids.placeBid(TOKEN_ID, 5_000_000, exp, sig);

        // Build a proof with wrong oldHash (will fail OldRootMismatch in INFT)
        bytes32 wrongOld = keccak256("wrong-root");
        bytes32 newRoot = keccak256("new-root-bad");
        bytes memory nonce = abi.encodePacked(uint256(200), uint128(0));
        bytes memory proof = _transferProof(
            TOKEN_ID, wrongOld, newRoot, bytes16(0), nonce, "og://bad", bobPk
        );

        vm.prank(alice);
        inft.setApprovalForAll(address(bids), true);

        vm.prank(alice);
        vm.expectRevert(AgentINFT.OldRootMismatch.selector);
        bids.acceptBid(TOKEN_ID, bidder, proof);

        // USDC stays escrowed — bid still active
        (, uint256 amount, , , bool active) = bids.bids(TOKEN_ID, bidder);
        assertEq(amount, 5_000_000);
        assertTrue(active);
        assertEq(usdc.balanceOf(address(bids)), 5_000_000);
    }

    function test_acceptBid_revertsForNonOwner() public {
        uint256 bobPk = 0xB0B8;
        address bidder = vm.addr(bobPk);
        uint64 exp = uint64(block.timestamp + 30 days);

        _fundUsdc(bidder, 5_000_000);
        bytes memory sig = _delegationSig(bobPk, TOKEN_ID, exp);
        vm.prank(bidder);
        bids.placeBid(TOKEN_ID, 5_000_000, exp, sig);

        address carol = address(0xCA70);
        bytes memory proof = new bytes(0);
        vm.prank(carol);
        vm.expectRevert(bytes("not owner"));
        bids.acceptBid(TOKEN_ID, bidder, proof);
    }

    function test_acceptBid_revertsIfBidNotActive() public {
        address carol = address(0xCA70);
        vm.prank(alice);
        inft.setApprovalForAll(address(bids), true);
        vm.prank(alice);
        vm.expectRevert(bytes("no bid"));
        bids.acceptBid(TOKEN_ID, carol, new bytes(0));
    }

    // =========================================================================
    // listBidders
    // =========================================================================

    function test_listBidders_includesAllPlacers() public {
        uint256 bobPk = 0xB0B9;
        uint256 carolPk = 0xCA701;
        address bob = vm.addr(bobPk);
        address carol = vm.addr(carolPk);
        uint64 exp = uint64(block.timestamp + 30 days);

        _fundUsdc(bob, 5_000_000);
        bytes memory sig1 = _delegationSig(bobPk, TOKEN_ID, exp);
        vm.prank(bob);
        bids.placeBid(TOKEN_ID, 5_000_000, exp, sig1);

        _fundUsdc(carol, 7_000_000);
        bytes memory sig2 = _delegationSig(carolPk, TOKEN_ID, exp);
        vm.prank(carol);
        bids.placeBid(TOKEN_ID, 7_000_000, exp, sig2);

        address[] memory list = bids.listBidders(TOKEN_ID);
        assertEq(list.length, 2);
        assertEq(list[0], bob);
        assertEq(list[1], carol);
    }
}
