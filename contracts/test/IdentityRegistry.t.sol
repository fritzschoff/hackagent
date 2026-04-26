// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";

contract IdentityRegistryTest is Test {
    IdentityRegistry internal reg;
    address internal agent = makeAddr("agent");
    address internal wallet = makeAddr("wallet");

    function setUp() public {
        reg = new IdentityRegistry();
    }

    function test_register_assigns_incrementing_ids() public {
        vm.prank(agent);
        uint256 id1 = reg.register("tradewise.agentlab.eth", wallet);
        assertEq(id1, 1);

        address agent2 = makeAddr("agent2");
        vm.prank(agent2);
        uint256 id2 = reg.register("other.agentlab.eth", wallet);
        assertEq(id2, 2);
    }

    function test_register_emits_event() public {
        vm.prank(agent);
        vm.expectEmit(true, true, false, true);
        emit IdentityRegistry.AgentRegistered(1, "tradewise.agentlab.eth", agent, wallet);
        reg.register("tradewise.agentlab.eth", wallet);
    }

    function test_register_reverts_on_duplicate() public {
        vm.startPrank(agent);
        reg.register("tradewise.agentlab.eth", wallet);
        vm.expectRevert(bytes("already registered"));
        reg.register("tradewise.agentlab.eth", wallet);
        vm.stopPrank();
    }

    function test_register_reverts_on_zero_wallet() public {
        vm.prank(agent);
        vm.expectRevert(bytes("wallet zero"));
        reg.register("tradewise.agentlab.eth", address(0));
    }

    function test_update_changes_wallet_and_active() public {
        vm.startPrank(agent);
        reg.register("tradewise.agentlab.eth", wallet);
        address newWallet = makeAddr("newWallet");
        reg.update("tradewise.agentlab.eth", newWallet, false);
        vm.stopPrank();

        IdentityRegistry.Agent memory a = reg.getAgent(1);
        assertEq(a.agentWallet, newWallet);
        assertEq(a.active, false);
    }

    function test_update_reverts_when_not_registered() public {
        vm.prank(agent);
        vm.expectRevert(bytes("not registered"));
        reg.update("x.eth", wallet, true);
    }

    function test_getAgent_returns_struct_for_id_one() public {
        vm.prank(agent);
        reg.register("tradewise.agentlab.eth", wallet);
        IdentityRegistry.Agent memory a = reg.getAgent(1);
        assertEq(a.agentId, 1);
        assertEq(a.agentDomain, "tradewise.agentlab.eth");
        assertEq(a.agentAddress, agent);
        assertEq(a.agentWallet, wallet);
        assertTrue(a.active);
    }
}
