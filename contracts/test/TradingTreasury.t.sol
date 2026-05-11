// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AgentShares} from "../src/AgentShares.sol";
import {RevenueSplitter} from "../src/RevenueSplitter.sol";
import {TradingTreasury} from "../src/TradingTreasury.sol";
import {MockPerpExchange} from "../src/MockPerpExchange.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("MockUSDC", "USDC") {}
    function decimals() public pure override returns (uint8) {
        return 6;
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TradingTreasuryTest is Test {
    MockUSDC internal usdc;
    AgentShares internal shares;
    RevenueSplitter internal splitter;
    MockPerpExchange internal exchange;
    TradingTreasury internal treasury;

    address internal owner = address(0xDEED);
    address internal founder = address(0xF00);
    address internal agent = address(0xA9E);
    address internal alice = address(0xA110);

    function setUp() public {
        usdc = new MockUSDC();
        // founder holds 100% of shares for these tests; transfers later
        // distribute revenue.
        shares = new AgentShares(founder, address(0xDEAD), 1);
        splitter = new RevenueSplitter(address(shares), address(usdc));
        shares.setSplitter(address(splitter));

        exchange = new MockPerpExchange(address(usdc));
        // mock counter-party pool — in real perps, funding flows from one side
        // of the book to the other, but a single-trader mock needs a pool.
        usdc.mint(address(exchange), 1_000_000_000);
        vm.prank(owner);
        treasury = new TradingTreasury(
            address(usdc),
            address(exchange),
            address(splitter),
            agent
        );

        // founder seeds the treasury with 1000 USDC
        usdc.mint(founder, 1_000_000_000); // 1000 USDC (6 decimals)
        vm.startPrank(founder);
        usdc.approve(address(treasury), 1_000_000_000);
        treasury.fund(1_000_000_000);
        vm.stopPrank();
    }

    // ─── happy path ─────────────────────────────────────────────────────

    function test_fund_pullsUSDC() public view {
        assertEq(usdc.balanceOf(address(treasury)), 1_000_000_000);
    }

    function test_openClose_funding_profitFlowsToSplitter() public {
        // Agent deposits 500 USDC to exchange and shorts 1 unit at price 1.
        vm.startPrank(agent);
        treasury.depositToExchange(500_000_000);
        vm.stopPrank();
        // rate 278/sec ≈ $1/hr on a 1-unit short — clean test number.
        exchange.setFundingRatePerSecond(278);

        vm.prank(agent);
        treasury.openPosition(-1e18, 500_000_000); // short 1 unit, 500 collateral

        // Fast-forward 1 hour. Expected funding ≈ $1 (1_000_000 base units).
        vm.warp(block.timestamp + 3600);

        vm.prank(agent);
        int256 pnl = treasury.closePosition();
        assertGt(pnl, 0, "shorts should earn funding");

        // pull collateral + funding back to treasury
        uint256 total = exchange.collateralOf(address(treasury));
        vm.prank(agent);
        treasury.withdrawFromExchange(total);

        // distribute the gain (anything above the 1000 USDC original)
        uint256 bal = usdc.balanceOf(address(treasury));
        assertGt(bal, 1_000_000_000, "treasury richer than original");
        uint256 profit = bal - 1_000_000_000;

        vm.prank(agent);
        treasury.distributeRevenue(profit);

        // splitter now has the profit; founder (100% holder) claims it.
        assertEq(usdc.balanceOf(address(splitter)), profit);
        vm.prank(founder);
        uint256 claimed = splitter.claim();
        assertEq(claimed, profit);
    }

    // ─── access control ─────────────────────────────────────────────────

    function test_openPosition_onlyAgent() public {
        vm.expectRevert(bytes("not agent"));
        vm.prank(alice);
        treasury.openPosition(1e18, 100_000_000);
    }

    function test_distributeRevenue_onlyAgent() public {
        vm.expectRevert(bytes("not agent"));
        vm.prank(alice);
        treasury.distributeRevenue(1);
    }

    function test_rotateAgent_onlyOwner() public {
        vm.expectRevert(bytes("not owner"));
        vm.prank(alice);
        treasury.rotateAgent(alice);
    }

    function test_rotateAgent_updatesAuth() public {
        vm.prank(owner);
        treasury.rotateAgent(alice);
        // alice can now act
        vm.prank(alice);
        treasury.heartbeat();
        // old agent cannot
        vm.expectRevert(bytes("not agent"));
        vm.prank(agent);
        treasury.heartbeat();
    }

    // ─── kill-switch ────────────────────────────────────────────────────

    function test_heartbeatStale_afterTimeout() public {
        assertFalse(treasury.heartbeatStale());
        vm.warp(block.timestamp + 6 hours + 1);
        assertTrue(treasury.heartbeatStale());
    }

    function test_emergencyExit_blocked_whileFresh_byStranger() public {
        vm.expectRevert(bytes("not authorized"));
        vm.prank(alice);
        treasury.emergencyExit("trying it on");
    }

    function test_emergencyExit_byOwner_anytime() public {
        vm.prank(owner);
        treasury.emergencyExit("owner override");
        assertTrue(treasury.killed());
        // funds went to splitter
        assertEq(usdc.balanceOf(address(splitter)), 1_000_000_000);
        assertEq(usdc.balanceOf(address(treasury)), 0);
    }

    function test_emergencyExit_byAnyone_whenStale_closesPositionAndDrains() public {
        // open a position, then let heartbeat go stale
        vm.startPrank(agent);
        treasury.depositToExchange(500_000_000);
        treasury.openPosition(-1e18, 500_000_000);
        vm.stopPrank();

        vm.warp(block.timestamp + 6 hours + 1);

        // alice (random) triggers emergency exit
        vm.prank(alice);
        treasury.emergencyExit("agent dead");

        assertTrue(treasury.killed());
        assertEq(treasury.positionId(), bytes32(0), "position closed");
        // all USDC funnelled to splitter (minus any funding pnl, which was 0
        // because we never set a funding rate)
        assertGt(usdc.balanceOf(address(splitter)), 0);
        assertEq(usdc.balanceOf(address(treasury)), 0);
        assertEq(exchange.collateralOf(address(treasury)), 0);
    }

    function test_killed_blocksNewPositions() public {
        vm.prank(owner);
        treasury.kill();
        vm.expectRevert(bytes("killed"));
        vm.prank(agent);
        treasury.openPosition(1e18, 100_000_000);
    }

    function test_openPosition_revertsIfAlreadyOpen() public {
        vm.startPrank(agent);
        treasury.depositToExchange(500_000_000);
        treasury.openPosition(1e18, 250_000_000);
        vm.expectRevert(bytes("position open"));
        treasury.openPosition(1e18, 100_000_000);
        vm.stopPrank();
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
}
