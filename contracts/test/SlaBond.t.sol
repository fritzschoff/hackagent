// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SlaBond} from "../src/SlaBond.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("MockUSDC", "USDC") {}
    function decimals() public pure override returns (uint8) {
        return 6;
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract SlaBondTest is Test {
    SlaBond internal bond;
    MockUSDC internal usdc;

    address internal deployer = address(0xD0A);
    address internal agent = address(0xA110);
    address internal client = address(0xC11);
    address internal validator = address(0xBA11);
    address internal stranger = address(0x511);

    bytes32 internal constant JOB_ID = bytes32(uint256(42));

    function setUp() public {
        vm.prank(deployer);
        usdc = new MockUSDC();
        vm.prank(deployer);
        bond = new SlaBond(address(usdc), validator);

        usdc.mint(agent, 100_000_000); // 100 USDC
    }

    function _post(uint256 amount) internal {
        vm.startPrank(agent);
        usdc.approve(address(bond), amount);
        bond.postBond(JOB_ID, client, amount);
        vm.stopPrank();
    }

    function test_postBond_escrowsFunds() public {
        _post(10_000_000);
        assertEq(usdc.balanceOf(address(bond)), 10_000_000);
        (
            address bondAgent,
            address bondClient,
            uint256 bondAmount,
            ,
            SlaBond.Status status
        ) = bond.bonds(JOB_ID);
        assertEq(bondAgent, agent);
        assertEq(bondClient, client);
        assertEq(bondAmount, 10_000_000);
        assertEq(uint8(status), uint8(SlaBond.Status.Posted));
    }

    function test_postBond_revertsForDuplicate() public {
        _post(10_000_000);
        vm.startPrank(agent);
        usdc.approve(address(bond), 10_000_000);
        vm.expectRevert(bytes("exists"));
        bond.postBond(JOB_ID, client, 10_000_000);
        vm.stopPrank();
    }

    function test_release_returnsFundsToAgent() public {
        _post(10_000_000);
        uint256 before = usdc.balanceOf(agent);
        vm.prank(agent);
        bond.release(JOB_ID);
        assertEq(usdc.balanceOf(agent), before + 10_000_000);
        (, , , , SlaBond.Status s) = bond.bonds(JOB_ID);
        assertEq(uint8(s), uint8(SlaBond.Status.Released));
    }

    function test_release_revertsForStranger() public {
        _post(10_000_000);
        vm.prank(stranger);
        vm.expectRevert(bytes("not agent"));
        bond.release(JOB_ID);
    }

    function test_slash_splits70_30() public {
        _post(10_000_000);
        vm.prank(validator);
        bond.slash(JOB_ID);
        assertEq(usdc.balanceOf(client), 7_000_000);
        assertEq(usdc.balanceOf(validator), 3_000_000);
        (, , , , SlaBond.Status s) = bond.bonds(JOB_ID);
        assertEq(uint8(s), uint8(SlaBond.Status.Slashed));
    }

    function test_slash_revertsForNonValidator() public {
        _post(10_000_000);
        vm.prank(stranger);
        vm.expectRevert(bytes("not validator"));
        bond.slash(JOB_ID);
    }

    function test_slash_revertsAfterRelease() public {
        _post(10_000_000);
        vm.prank(agent);
        bond.release(JOB_ID);
        vm.prank(validator);
        vm.expectRevert(bytes("bad status"));
        bond.slash(JOB_ID);
    }

    function test_release_revertsAfterSlash() public {
        _post(10_000_000);
        vm.prank(validator);
        bond.slash(JOB_ID);
        vm.prank(agent);
        vm.expectRevert(bytes("bad status"));
        bond.release(JOB_ID);
    }

    function test_setValidator_onlyDeployer() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("not deployer"));
        bond.setValidator(address(0xFEED));

        vm.prank(deployer);
        bond.setValidator(address(0xFEED));
        assertEq(bond.validator(), address(0xFEED));
    }
}
