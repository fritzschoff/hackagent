// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";

contract ReputationRegistryTest is Test {
    IdentityRegistry internal idReg;
    ReputationRegistry internal repReg;
    address internal agent = makeAddr("agent");
    address internal client = makeAddr("client");
    address internal client2 = makeAddr("client2");

    function setUp() public {
        idReg = new IdentityRegistry();
        repReg = new ReputationRegistry(address(idReg));
        vm.prank(agent);
        idReg.register("tradewise.agentlab.eth", agent);
    }

    function test_postFeedback_emits_and_appends() public {
        vm.prank(client);
        vm.expectEmit(true, true, true, true);
        emit ReputationRegistry.FeedbackPosted(
            1,
            client,
            85,
            2,
            bytes32("swap-success"),
            uint64(block.timestamp),
            "ipfs://job-1"
        );
        repReg.postFeedback(1, 85, 2, bytes32("swap-success"), "ipfs://job-1");
        assertEq(repReg.feedbackCount(1), 1);

        ReputationRegistry.Feedback memory f = repReg.feedbackAt(1, 0);
        assertEq(f.agentId, 1);
        assertEq(f.client, client);
        assertEq(f.score, 85);
        assertEq(f.decimals, 2);
        assertEq(f.tag, bytes32("swap-success"));
    }

    function test_postFeedback_reverts_on_unknown_agent() public {
        vm.prank(client);
        vm.expectRevert(bytes("unknown agent"));
        repReg.postFeedback(99, 50, 2, bytes32("swap"), "");
    }

    function test_postFeedback_reverts_when_inactive() public {
        vm.prank(agent);
        idReg.update("tradewise.agentlab.eth", agent, false);
        vm.prank(client);
        vm.expectRevert(bytes("agent inactive"));
        repReg.postFeedback(1, 50, 2, bytes32("swap"), "");
    }

    function test_postFeedback_reverts_on_score_above_100() public {
        vm.prank(client);
        vm.expectRevert(bytes("score>100"));
        repReg.postFeedback(1, 101, 2, bytes32("swap"), "");
    }

    function test_multiple_clients_can_feedback_same_agent() public {
        vm.prank(client);
        repReg.postFeedback(1, 80, 2, bytes32("swap"), "");
        vm.prank(client2);
        repReg.postFeedback(1, 90, 2, bytes32("swap"), "");
        assertEq(repReg.feedbackCount(1), 2);
        assertEq(repReg.feedbackAt(1, 0).client, client);
        assertEq(repReg.feedbackAt(1, 1).client, client2);
    }
}
