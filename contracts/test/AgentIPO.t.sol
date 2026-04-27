// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AgentShares} from "../src/AgentShares.sol";
import {RevenueSplitter} from "../src/RevenueSplitter.sol";
import {SharesSale} from "../src/SharesSale.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("MockUSDC", "USDC") {}
    function decimals() public pure override returns (uint8) {
        return 6;
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract AgentSharesTest is Test {
    AgentShares internal shares;
    address internal founder = address(0xF00);

    function setUp() public {
        shares = new AgentShares(founder, address(0xDEAD), 1);
    }

    function test_supply() public view {
        assertEq(shares.totalSupply(), 10_000 * 1e18);
        assertEq(shares.balanceOf(founder), 10_000 * 1e18);
        assertEq(shares.symbol(), "TRADE");
    }

    function test_transferable() public {
        address bob = address(0xB0B);
        vm.prank(founder);
        shares.transfer(bob, 1e18);
        assertEq(shares.balanceOf(bob), 1e18);
        assertEq(shares.balanceOf(founder), 10_000 * 1e18 - 1e18);
    }
}

contract RevenueSplitterTest is Test {
    AgentShares internal shares;
    RevenueSplitter internal splitter;
    MockUSDC internal usdc;

    address internal founder = address(0xF00);
    address internal alice = address(0xA110);
    address internal bob = address(0xB0B);

    function setUp() public {
        shares = new AgentShares(founder, address(0xDEAD), 1);
        usdc = new MockUSDC();
        splitter = new RevenueSplitter(address(shares), address(usdc));
    }

    function test_claim_proRata_singleHolder() public {
        // founder owns 100% of supply. 100 USDC arrives. founder claims 100.
        usdc.mint(address(splitter), 100_000_000);
        vm.prank(founder);
        uint256 claimed = splitter.claim();
        assertEq(claimed, 100_000_000);
        assertEq(usdc.balanceOf(founder), 100_000_000);
    }

    function test_claim_proRata_multipleHolders() public {
        // founder gives 1% to alice, 4% to bob. 100 USDC arrives.
        // founder claimable = 95, alice = 1, bob = 4.
        vm.startPrank(founder);
        shares.transfer(alice, 100 * 1e18); // 1% of 10000
        shares.transfer(bob, 400 * 1e18); // 4%
        vm.stopPrank();
        usdc.mint(address(splitter), 100_000_000);

        vm.prank(alice);
        uint256 a = splitter.claim();
        assertEq(a, 1_000_000);

        vm.prank(bob);
        uint256 b = splitter.claim();
        assertEq(b, 4_000_000);

        vm.prank(founder);
        uint256 f = splitter.claim();
        assertEq(f, 95_000_000);
    }

    function test_claim_secondPaymentSplitsAgain() public {
        usdc.mint(address(splitter), 50_000_000);
        vm.prank(founder);
        splitter.claim();

        // Second payment of 50 USDC. founder still 100% holder.
        usdc.mint(address(splitter), 50_000_000);
        vm.prank(founder);
        uint256 second = splitter.claim();
        assertEq(second, 50_000_000);
        assertEq(usdc.balanceOf(founder), 100_000_000);
    }

    function test_claim_revertsWhenNothing() public {
        vm.expectRevert(bytes("nothing to claim"));
        vm.prank(alice);
        splitter.claim();
    }

    function test_totalReceived_includesReleased() public {
        usdc.mint(address(splitter), 30_000_000);
        vm.prank(founder);
        splitter.claim();
        assertEq(splitter.totalReceived(), 30_000_000);
    }
}

contract SharesSaleTest is Test {
    AgentShares internal shares;
    MockUSDC internal usdc;
    SharesSale internal sale;

    address internal founder = address(0xF00);
    address internal buyer = address(0xB0B);

    function setUp() public {
        vm.startPrank(founder);
        shares = new AgentShares(founder, address(0xDEAD), 1);
        usdc = new MockUSDC();
        sale = new SharesSale(address(shares), address(usdc), 5_000); // $0.005 / share
        shares.transfer(address(sale), 1_000 * 1e18);
        vm.stopPrank();

        usdc.mint(buyer, 100_000_000);
    }

    function test_buy_transfersSharesAndPaysFounder() public {
        vm.startPrank(buyer);
        usdc.approve(address(sale), 5_000);
        sale.buy(1);
        vm.stopPrank();

        assertEq(shares.balanceOf(buyer), 1e18);
        assertEq(usdc.balanceOf(founder), 5_000);
        assertEq(sale.sharesAvailable(), 999 * 1e18);
    }

    function test_buy_revertsIfPoolEmpty() public {
        vm.startPrank(buyer);
        usdc.approve(address(sale), 1_000_000_000);
        vm.expectRevert(bytes("insufficient pool"));
        sale.buy(2_000);
        vm.stopPrank();
    }

    function test_withdrawShares_onlyDeployer() public {
        vm.prank(buyer);
        vm.expectRevert(bytes("not deployer"));
        sale.withdrawShares(1e18);
    }
}
