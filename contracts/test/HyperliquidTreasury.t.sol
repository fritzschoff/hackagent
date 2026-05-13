// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HyperliquidTreasury} from "../src/HyperliquidTreasury.sol";
import {L1Read} from "../src/L1Read.sol";
import {
    HyperliquidActions,
    ICoreWriter
} from "../src/HyperliquidActions.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("MockUSDC", "USDC") {}
    function decimals() public pure override returns (uint8) {
        return 6;
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract HyperliquidTreasuryTest is Test {
    MockUSDC internal usdc;
    HyperliquidTreasury internal treasury;
    address internal splitter = address(0x59B11);
    address internal owner = address(0xDEED);
    address internal agent = address(0xA9E);
    address internal alice = address(0xA110);
    uint32 internal constant ETH_PERP = 4;

    function setUp() public {
        usdc = new MockUSDC();
        vm.prank(owner);
        treasury = new HyperliquidTreasury(
            address(usdc),
            splitter,
            agent,
            ETH_PERP
        );
        // Default: CoreWriter accepts any sendRawAction (HL fires-and-forgets).
        vm.mockCall(
            HyperliquidActions.CORE_WRITER,
            bytes(""),
            bytes("")
        );
        // Common position read default — flat.
        L1Read.Position memory flat;
        vm.mockCall(
            L1Read.POSITION2,
            abi.encode(address(treasury), ETH_PERP),
            abi.encode(flat)
        );
        // Seed with 1000 USDC.
        usdc.mint(owner, 1_000_000_000);
        vm.startPrank(owner);
        usdc.approve(address(treasury), 1_000_000_000);
        treasury.fund(1_000_000_000);
        vm.stopPrank();
    }

    // ─── funding ─────────────────────────────────────────────────────────

    function test_fund_pullsUSDC() public view {
        assertEq(usdc.balanceOf(address(treasury)), 1_000_000_000);
    }

    function test_fund_rejectsZero() public {
        vm.expectRevert(bytes("zero"));
        treasury.fund(0);
    }

    // ─── routing ─────────────────────────────────────────────────────────

    function test_moveToPerp_sendsCorrectAction() public {
        bytes memory expected = HyperliquidActions.encodeUsdClassTransfer(
            500_000_000,
            true
        );
        vm.expectCall(
            HyperliquidActions.CORE_WRITER,
            abi.encodeWithSelector(ICoreWriter.sendRawAction.selector, expected)
        );
        vm.prank(agent);
        treasury.moveToPerp(500_000_000);
    }

    function test_moveToSpot_sendsCorrectAction() public {
        bytes memory expected = HyperliquidActions.encodeUsdClassTransfer(
            250_000_000,
            false
        );
        vm.expectCall(
            HyperliquidActions.CORE_WRITER,
            abi.encodeWithSelector(ICoreWriter.sendRawAction.selector, expected)
        );
        vm.prank(agent);
        treasury.moveToSpot(250_000_000);
    }

    function test_moveToPerp_onlyAgent() public {
        vm.expectRevert(bytes("not agent"));
        vm.prank(alice);
        treasury.moveToPerp(1);
    }

    // ─── open / close ────────────────────────────────────────────────────

    function test_openPosition_sendsLimitOrderAndStoresPositionId() public {
        bytes memory expected = HyperliquidActions.encodeLimitOrder(
            ETH_PERP,
            false,
            uint64(228_000_000), // $2280 in HL fixed-point (1e5 scale here)
            uint64(10_000), // 0.01 ETH if szDecimals=6
            false,
            HyperliquidActions.TIF_IOC,
            0
        );
        vm.expectCall(
            HyperliquidActions.CORE_WRITER,
            abi.encodeWithSelector(ICoreWriter.sendRawAction.selector, expected)
        );
        vm.prank(agent);
        bytes32 pid = treasury.openPosition(
            false,
            uint64(228_000_000),
            uint64(10_000),
            HyperliquidActions.TIF_IOC
        );
        assertTrue(pid != bytes32(0));
        assertEq(treasury.positionId(), pid);
        assertEq(treasury.positionOpenedAt(), uint64(block.timestamp));
    }

    function test_openPosition_revertsIfAlreadyOpen() public {
        vm.startPrank(agent);
        treasury.openPosition(
            false,
            uint64(228_000_000),
            uint64(10_000),
            HyperliquidActions.TIF_IOC
        );
        vm.expectRevert(bytes("position open"));
        treasury.openPosition(
            true,
            uint64(228_000_000),
            uint64(10_000),
            HyperliquidActions.TIF_IOC
        );
        vm.stopPrank();
    }

    function test_openPosition_rejectsBadTif() public {
        vm.expectRevert(bytes("bad tif"));
        vm.prank(agent);
        treasury.openPosition(
            false,
            uint64(228_000_000),
            uint64(10_000),
            99
        );
    }

    function test_closePosition_readsHLAndSendsReduceOnly() public {
        // First open a synthetic short.
        vm.prank(agent);
        treasury.openPosition(
            false,
            uint64(228_000_000),
            uint64(10_000),
            HyperliquidActions.TIF_IOC
        );
        // HL says we're short 10_000 (szDecimals scale).
        L1Read.Position memory pos = L1Read.Position({
            szi: -int64(10_000),
            entryNtl: 22_800_000,
            isolatedRawUsd: 0,
            leverage: 5,
            isIsolated: false
        });
        vm.mockCall(
            L1Read.POSITION2,
            abi.encode(address(treasury), ETH_PERP),
            abi.encode(pos)
        );
        // Closing a short = buy. Reduce-only IOC.
        bytes memory expected = HyperliquidActions.encodeLimitOrder(
            ETH_PERP,
            true,
            uint64(229_000_000),
            uint64(10_000),
            true,
            HyperliquidActions.TIF_IOC,
            0
        );
        vm.expectCall(
            HyperliquidActions.CORE_WRITER,
            abi.encodeWithSelector(ICoreWriter.sendRawAction.selector, expected)
        );
        vm.prank(agent);
        treasury.closePosition(uint64(229_000_000));
        // Synthetic state cleared.
        assertEq(treasury.positionId(), bytes32(0));
        assertEq(treasury.positionOpenedAt(), 0);
    }

    function test_closePosition_revertsIfNoPosition() public {
        vm.expectRevert(bytes("no position"));
        vm.prank(agent);
        treasury.closePosition(uint64(229_000_000));
    }

    // ─── revenue ─────────────────────────────────────────────────────────

    function test_distributeRevenue_forwardsToSplitter() public {
        vm.prank(agent);
        treasury.distributeRevenue(400_000_000);
        assertEq(usdc.balanceOf(splitter), 400_000_000);
        assertEq(usdc.balanceOf(address(treasury)), 600_000_000);
    }

    function test_distributeRevenue_revertsOnOverdraft() public {
        vm.expectRevert(bytes("insufficient"));
        vm.prank(agent);
        treasury.distributeRevenue(2_000_000_000);
    }

    // ─── heartbeat / kill switch ─────────────────────────────────────────

    function test_heartbeatStale_afterTimeout() public {
        assertFalse(treasury.heartbeatStale());
        vm.warp(block.timestamp + 6 hours + 1);
        assertTrue(treasury.heartbeatStale());
    }

    function test_heartbeat_refreshes() public {
        vm.warp(block.timestamp + 3 hours);
        vm.prank(agent);
        treasury.heartbeat();
        // Now go past the original timeout — should still be fresh since
        // the heartbeat reset the clock.
        vm.warp(block.timestamp + 5 hours);
        assertFalse(treasury.heartbeatStale());
    }

    function test_emergencyExit_blockedWhileFresh() public {
        vm.expectRevert(bytes("not authorized"));
        vm.prank(alice);
        treasury.emergencyExit(uint64(229_000_000), "trying it");
    }

    function test_emergencyExit_ownerAnytime_drainsToSplitter() public {
        vm.prank(owner);
        treasury.emergencyExit(uint64(229_000_000), "owner");
        assertTrue(treasury.killed());
        assertEq(usdc.balanceOf(splitter), 1_000_000_000);
        assertEq(usdc.balanceOf(address(treasury)), 0);
    }

    function test_emergencyExit_anyoneWhenStale_closesAndDrains() public {
        // Open a synthetic position so the exit closes it.
        vm.prank(agent);
        treasury.openPosition(
            false,
            uint64(228_000_000),
            uint64(10_000),
            HyperliquidActions.TIF_IOC
        );
        // HL position non-zero.
        L1Read.Position memory pos = L1Read.Position({
            szi: -int64(10_000),
            entryNtl: 22_800_000,
            isolatedRawUsd: 0,
            leverage: 5,
            isIsolated: false
        });
        vm.mockCall(
            L1Read.POSITION2,
            abi.encode(address(treasury), ETH_PERP),
            abi.encode(pos)
        );
        // Heartbeat staleness.
        vm.warp(block.timestamp + 6 hours + 1);
        // Expect the close action to be sent.
        bytes memory expected = HyperliquidActions.encodeLimitOrder(
            ETH_PERP,
            true,
            uint64(230_000_000),
            uint64(10_000),
            true,
            HyperliquidActions.TIF_IOC,
            0
        );
        vm.expectCall(
            HyperliquidActions.CORE_WRITER,
            abi.encodeWithSelector(ICoreWriter.sendRawAction.selector, expected)
        );
        vm.prank(alice);
        treasury.emergencyExit(uint64(230_000_000), "agent dead");
        assertTrue(treasury.killed());
        assertEq(treasury.positionId(), bytes32(0));
        assertEq(usdc.balanceOf(splitter), 1_000_000_000);
    }

    function test_emergencyExit_killsEvenIfPrecompileReverts() public {
        // Open a position so the exit thinks it has work.
        vm.prank(agent);
        treasury.openPosition(
            false,
            uint64(228_000_000),
            uint64(10_000),
            HyperliquidActions.TIF_IOC
        );
        // Now break the precompile.
        vm.mockCallRevert(
            L1Read.POSITION2,
            abi.encode(address(treasury), ETH_PERP),
            "precompile down"
        );
        vm.prank(owner);
        treasury.emergencyExit(uint64(0), "owner");
        // Still killed + drained, even though we couldn't read the HL state.
        assertTrue(treasury.killed());
        assertEq(usdc.balanceOf(splitter), 1_000_000_000);
    }

    /// Even if HyperliquidActions.send (i.e. the CoreWriter call) reverts
    /// — HL paused, no liquidity, gas issue — the kill must still complete.
    function test_emergencyExit_survivesCoreWriterRevert() public {
        // Open a position so the close path is exercised.
        vm.prank(agent);
        treasury.openPosition(
            false,
            uint64(228_000_000),
            uint64(10_000),
            HyperliquidActions.TIF_IOC
        );
        // HL position non-zero so the read passes and we attempt the close.
        L1Read.Position memory pos = L1Read.Position({
            szi: -int64(10_000),
            entryNtl: 22_800_000,
            isolatedRawUsd: 0,
            leverage: 5,
            isIsolated: false
        });
        vm.mockCall(
            L1Read.POSITION2,
            abi.encode(address(treasury), ETH_PERP),
            abi.encode(pos)
        );
        // Now break CoreWriter — the close action will revert.
        vm.mockCallRevert(
            HyperliquidActions.CORE_WRITER,
            bytes(""),
            "CoreWriter paused"
        );

        vm.warp(block.timestamp + 6 hours + 1);
        vm.prank(alice);
        treasury.emergencyExit(uint64(230_000_000), "venue down");

        // Kill + drain succeeded despite the order-submit revert.
        assertTrue(treasury.killed());
        assertEq(treasury.positionId(), bytes32(0));
        assertEq(usdc.balanceOf(splitter), 1_000_000_000);
    }

    function test_fund_blockedAfterKill() public {
        vm.prank(owner);
        treasury.kill();
        usdc.mint(alice, 100);
        vm.startPrank(alice);
        usdc.approve(address(treasury), 100);
        vm.expectRevert(bytes("killed"));
        treasury.fund(100);
        vm.stopPrank();
    }

    /// emergencyExit must call usdClassTransfer(perpAvail, false) when
    /// the withdrawable precompile reports non-zero perp balance, so
    /// shareholders can eventually claim the perp-side margin.
    function test_emergencyExit_initiatesPerpSweep() public {
        // Mock the withdrawable precompile to return 250M (250 USDC).
        vm.mockCall(
            L1Read.WITHDRAWABLE,
            abi.encode(address(treasury)),
            abi.encode(uint64(250_000_000))
        );
        bytes memory expected = HyperliquidActions.encodeUsdClassTransfer(
            uint64(250_000_000),
            false
        );
        vm.expectCall(
            HyperliquidActions.CORE_WRITER,
            abi.encodeWithSelector(ICoreWriter.sendRawAction.selector, expected)
        );
        vm.prank(owner);
        treasury.emergencyExit(uint64(0), "owner with perp balance");
        assertTrue(treasury.killed());
    }

    /// If the withdrawable precompile reverts, emergencyExit must still
    /// complete (the kill is the load-bearing promise; the perp sweep is
    /// best-effort).
    function test_emergencyExit_perpSweepFailureDoesNotBlockKill() public {
        vm.mockCallRevert(
            L1Read.WITHDRAWABLE,
            abi.encode(address(treasury)),
            "precompile down"
        );
        vm.prank(owner);
        treasury.emergencyExit(uint64(0), "withdrawable broken");
        assertTrue(treasury.killed());
        // On-treasury USDC still drained.
        assertEq(usdc.balanceOf(splitter), 1_000_000_000);
    }

    /// After kill, anyone can call sweepSpot to drain USDC that landed
    /// post-mortem (e.g. the perp→spot transfer initiated by
    /// emergencyExit settles in the next HL block).
    function test_sweepSpot_anyoneCanCallAfterKill() public {
        vm.prank(owner);
        treasury.kill();
        // Simulate fresh USDC arriving on the treasury's spot ledger
        // AFTER kill (e.g. the perp→spot transfer settling next block).
        // Mint on top of setUp's 1B so we can confirm the sweep covers
        // both prior balance and the new arrival.
        uint256 priorTreasuryBalance = usdc.balanceOf(address(treasury));
        usdc.mint(address(treasury), 750_000_000);
        uint256 splitterBefore = usdc.balanceOf(splitter);
        vm.prank(alice);
        treasury.sweepSpot();
        assertEq(
            usdc.balanceOf(splitter),
            splitterBefore + priorTreasuryBalance + 750_000_000
        );
        assertEq(usdc.balanceOf(address(treasury)), 0);
    }

    function test_sweepSpot_blockedWhileAlive() public {
        vm.expectRevert(bytes("not killed"));
        treasury.sweepSpot();
    }

    function test_sweepSpot_revertsOnEmpty() public {
        vm.prank(owner);
        treasury.kill();
        // Treasury has 1B USDC from setUp; drain it via owner emergencyExit
        // path is awkward — just call sweepSpot once, then again.
        vm.prank(alice);
        treasury.sweepSpot();
        vm.expectRevert(bytes("nothing to sweep"));
        vm.prank(alice);
        treasury.sweepSpot();
    }

    function test_killed_blocksNewPositions() public {
        vm.prank(owner);
        treasury.kill();
        vm.expectRevert(bytes("killed"));
        vm.prank(agent);
        treasury.openPosition(
            false,
            uint64(228_000_000),
            uint64(10_000),
            HyperliquidActions.TIF_IOC
        );
    }

    function test_killed_blocksMoveToPerp() public {
        vm.prank(owner);
        treasury.kill();
        vm.expectRevert(bytes("killed"));
        vm.prank(agent);
        treasury.moveToPerp(1);
    }

    // ─── admin ───────────────────────────────────────────────────────────

    function test_rotateAgent_onlyOwner() public {
        vm.expectRevert(bytes("not owner"));
        vm.prank(alice);
        treasury.rotateAgent(alice);
    }

    function test_rotateAgent_updatesAuth() public {
        vm.prank(owner);
        treasury.rotateAgent(alice);
        vm.prank(alice);
        treasury.heartbeat();
        vm.expectRevert(bytes("not agent"));
        vm.prank(agent);
        treasury.heartbeat();
    }

    function test_setHeartbeatTimeout_bounds() public {
        vm.startPrank(owner);
        vm.expectRevert(bytes("out of range"));
        treasury.setHeartbeatTimeout(30 minutes);
        vm.expectRevert(bytes("out of range"));
        treasury.setHeartbeatTimeout(8 days);
        treasury.setHeartbeatTimeout(12 hours);
        vm.stopPrank();
        assertEq(treasury.heartbeatTimeout(), 12 hours);
    }

    // ─── views ───────────────────────────────────────────────────────────

    function test_oraclePx_passesThrough() public {
        vm.mockCall(
            L1Read.ORACLE_PX,
            abi.encode(ETH_PERP),
            abi.encode(uint64(228_000_000))
        );
        assertEq(treasury.oraclePx(), 228_000_000);
    }
}
