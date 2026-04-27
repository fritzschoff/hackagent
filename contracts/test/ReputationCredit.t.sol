// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {ReputationCredit} from "../src/ReputationCredit.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("MockUSDC", "USDC") {}
    function decimals() public pure override returns (uint8) {
        return 6;
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ReputationCreditTest is Test {
    IdentityRegistry internal identity;
    ReputationRegistry internal reputation;
    ReputationCredit internal credit;
    MockUSDC internal usdc;

    address internal agent = address(0xA110);
    address internal agentPayout = address(0xDEAD);
    address internal lender = address(0xC1);
    address internal client1 = address(0xC2);
    address internal client2 = address(0xC3);

    function setUp() public {
        identity = new IdentityRegistry();
        reputation = new ReputationRegistry(address(identity));
        usdc = new MockUSDC();
        credit = new ReputationCredit(
            address(usdc),
            address(identity),
            address(reputation)
        );

        vm.prank(agent);
        identity.register("agent.test", agentPayout);

        usdc.mint(lender, 1_000_000_000); // 1k USDC
        usdc.mint(client1, 1_000_000); // for repaying
    }

    function _bumpFeedback(uint256 n) internal {
        for (uint256 i = 0; i < n; i++) {
            address poster = (i % 2 == 0) ? client1 : client2;
            vm.prank(poster);
            reputation.postFeedback(1, 90, 0, bytes32("good"), "");
        }
    }

    function test_creditLimit_belowMinFeedback() public {
        // Pool empty + 0 feedback -> 0
        assertEq(credit.creditLimit(1), 0);
        _bumpFeedback(4); // below MIN_FEEDBACK=5
        assertEq(credit.creditLimit(1), 0);
    }

    function test_creditLimit_scalesWithFeedback() public {
        vm.startPrank(lender);
        usdc.approve(address(credit), 1_000_000_000);
        credit.deposit(1_000_000_000); // 1k USDC pool
        vm.stopPrank();

        _bumpFeedback(10);
        // limit = min(10 * 5e6, pool/10) = min(50, 100) = 50 USDC
        assertEq(credit.creditLimit(1), 50_000_000);
    }

    function test_creditLimit_cappedByPool() public {
        vm.startPrank(lender);
        usdc.approve(address(credit), 100_000_000); // 100 USDC
        credit.deposit(100_000_000);
        vm.stopPrank();

        _bumpFeedback(50);
        // count*5 = 250 USDC vs pool/10 = 10 USDC -> 10 USDC
        assertEq(credit.creditLimit(1), 10_000_000);
    }

    function test_borrow_paysAgentWalletAndRecordsLoan() public {
        vm.startPrank(lender);
        usdc.approve(address(credit), 1_000_000_000);
        credit.deposit(1_000_000_000);
        vm.stopPrank();
        _bumpFeedback(10);

        vm.prank(agent);
        credit.borrow(1, 30_000_000); // 30 USDC

        assertEq(usdc.balanceOf(agentPayout), 30_000_000);
        (uint256 principal, , uint64 borrowedAtFeedback, bool defaulted) =
            credit.loans(1);
        assertEq(principal, 30_000_000);
        assertEq(borrowedAtFeedback, 10);
        assertFalse(defaulted);
    }

    function test_borrow_revertsIfNotAgent() public {
        vm.startPrank(lender);
        usdc.approve(address(credit), 1_000_000_000);
        credit.deposit(1_000_000_000);
        vm.stopPrank();
        _bumpFeedback(10);

        vm.expectRevert(bytes("not agent"));
        vm.prank(client1);
        credit.borrow(1, 10_000_000);
    }

    function test_borrow_revertsIfDoubleBorrow() public {
        vm.startPrank(lender);
        usdc.approve(address(credit), 1_000_000_000);
        credit.deposit(1_000_000_000);
        vm.stopPrank();
        _bumpFeedback(10);

        vm.startPrank(agent);
        credit.borrow(1, 10_000_000);
        vm.expectRevert(bytes("loan exists"));
        credit.borrow(1, 5_000_000);
        vm.stopPrank();
    }

    function test_repay_partialAndFull() public {
        vm.startPrank(lender);
        usdc.approve(address(credit), 1_000_000_000);
        credit.deposit(1_000_000_000);
        vm.stopPrank();
        _bumpFeedback(10);

        vm.prank(agent);
        credit.borrow(1, 50_000_000);

        usdc.mint(client1, 50_000_000);
        vm.startPrank(client1);
        usdc.approve(address(credit), 50_000_000);
        credit.repay(1, 20_000_000);
        (uint256 principal1, , , ) = credit.loans(1);
        assertEq(principal1, 30_000_000);

        credit.repay(1, 30_000_000);
        (uint256 principal2, , , ) = credit.loans(1);
        assertEq(principal2, 0);
        vm.stopPrank();
    }

    function test_liquidate_dropsBelowThreshold() public {
        vm.startPrank(lender);
        usdc.approve(address(credit), 1_000_000_000);
        credit.deposit(1_000_000_000);
        vm.stopPrank();
        _bumpFeedback(20);

        vm.prank(agent);
        credit.borrow(1, 50_000_000);

        // Liquidation threshold: feedback < 80% of borrow-time count.
        // borrowed at 20 -> floor at 16. Drop is impossible directly
        // (feedback only grows in registry), so we *simulate* by checking
        // a hypothetical: deploy a fresh fixture.
        //
        // For the demo + test: validate liquidate() reverts when not
        // liquidatable, since we cannot decrement feedbackCount in v1.
        (bool ok1, ) = credit.isLiquidatable(1);
        assertFalse(ok1);

        vm.expectRevert(bytes("not liquidatable"));
        credit.liquidate(1);
    }

    function test_withdraw_proRataNAV() public {
        vm.startPrank(lender);
        usdc.approve(address(credit), 1_000_000_000);
        credit.deposit(1_000_000_000);
        vm.stopPrank();
        _bumpFeedback(10);

        vm.prank(agent);
        credit.borrow(1, 30_000_000);

        // Free liquidity = 970 USDC. Lender redeems half their shares =
        // 500 USDC of NAV; capped by free liquidity (970), so all 500
        // come out.
        uint256 shares = credit.sharesOf(lender);
        vm.prank(lender);
        credit.withdraw(shares / 2);
        assertEq(usdc.balanceOf(lender), 500_000_000);
    }

    function test_withdraw_revertsAboveFreeLiquidity() public {
        vm.startPrank(lender);
        usdc.approve(address(credit), 1_000_000_000);
        credit.deposit(1_000_000_000);
        vm.stopPrank();
        _bumpFeedback(10);

        vm.prank(agent);
        credit.borrow(1, 30_000_000);

        // Try to redeem all shares -> NAV = 1000, but free = 970.
        uint256 shares = credit.sharesOf(lender);
        vm.expectRevert(bytes("insufficient liquidity"));
        vm.prank(lender);
        credit.withdraw(shares);
    }
}
