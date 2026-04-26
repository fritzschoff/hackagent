// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ValidationRegistry} from "../src/ValidationRegistry.sol";

contract ValidationRegistryTest is Test {
    ValidationRegistry internal val;
    address internal client = makeAddr("client");
    address internal validator = makeAddr("validator");
    bytes32 internal jobId = keccak256("job-1");

    function setUp() public {
        val = new ValidationRegistry();
    }

    function test_requestValidation_creates_request() public {
        vm.prank(client);
        val.requestValidation(1, jobId, "ipfs://detail", uint64(block.timestamp + 1 hours));
        (uint256 agentId, bytes32 jid, address c,, uint64 createdAt, uint64 deadline, bool resolved)
            = val.requests(jobId);
        assertEq(agentId, 1);
        assertEq(jid, jobId);
        assertEq(c, client);
        assertGt(createdAt, 0);
        assertGt(deadline, block.timestamp);
        assertFalse(resolved);
    }

    function test_requestValidation_reverts_on_duplicate() public {
        uint64 dl = uint64(block.timestamp + 1 hours);
        vm.startPrank(client);
        val.requestValidation(1, jobId, "ipfs://detail", dl);
        vm.expectRevert(bytes("already requested"));
        val.requestValidation(1, jobId, "ipfs://detail", dl);
        vm.stopPrank();
    }

    function test_requestValidation_reverts_on_past_deadline() public {
        vm.warp(1000);
        vm.prank(client);
        vm.expectRevert(bytes("deadline in past"));
        val.requestValidation(1, jobId, "ipfs://detail", uint64(500));
    }

    function test_postResponse_marks_resolved_and_emits() public {
        uint64 dl = uint64(block.timestamp + 1 hours);
        vm.prank(client);
        val.requestValidation(1, jobId, "ipfs://detail", dl);

        vm.prank(validator);
        vm.expectEmit(true, true, false, true);
        emit ValidationRegistry.ValidationResponsePosted(
            jobId,
            validator,
            95,
            2,
            "ipfs://attestation",
            uint64(block.timestamp)
        );
        val.postResponse(jobId, 95, 2, "ipfs://attestation");

        assertEq(val.responseCount(jobId), 1);
        ValidationRegistry.ValidationResponse memory r = val.responseAt(jobId, 0);
        assertEq(r.validator, validator);
        assertEq(r.score, 95);
        (,,,,,, bool resolved) = val.requests(jobId);
        assertTrue(resolved);
    }

    function test_postResponse_reverts_when_no_request() public {
        vm.prank(validator);
        vm.expectRevert(bytes("no such request"));
        val.postResponse(jobId, 95, 2, "");
    }

    function test_postResponse_reverts_after_deadline() public {
        uint64 dl = uint64(block.timestamp + 1 hours);
        vm.prank(client);
        val.requestValidation(1, jobId, "ipfs://detail", dl);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(validator);
        vm.expectRevert(bytes("deadline passed"));
        val.postResponse(jobId, 95, 2, "");
    }

    function test_postResponse_allows_multiple_responses() public {
        address validator2 = makeAddr("validator2");
        uint64 dl = uint64(block.timestamp + 1 hours);
        vm.prank(client);
        val.requestValidation(1, jobId, "ipfs://detail", dl);
        vm.prank(validator);
        val.postResponse(jobId, 95, 2, "");
        vm.prank(validator2);
        val.postResponse(jobId, 80, 2, "");
        assertEq(val.responseCount(jobId), 2);
    }
}
