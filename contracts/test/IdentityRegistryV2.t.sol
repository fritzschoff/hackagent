// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {IdentityRegistryV2} from "../src/IdentityRegistryV2.sol";
import {AgentINFT} from "../src/AgentINFT.sol";
import {AgentINFTVerifier} from "../src/AgentINFTVerifier.sol";

contract IdentityRegistryV2Test is Test {
    IdentityRegistryV2 internal reg;
    AgentINFTVerifier internal verifier;
    AgentINFT internal inft;

    address internal deployer = address(0xD0A);
    address internal agentEoa = address(0xA110);
    uint256 internal newOwnerPk = 0xBEEF;
    address internal newOwner = vm.addr(newOwnerPk);
    uint256 internal oraclePk = 0xA11CE;
    address internal oracle;

    bytes32 private constant SET_AGENT_WALLET_TYPEHASH =
        keccak256(
            "SetAgentWallet(uint256 agentId,address newWallet,uint256 deadline,uint256 nonce)"
        );

    function setUp() public {
        oracle = vm.addr(oraclePk);
        vm.startPrank(deployer);
        reg = new IdentityRegistryV2();
        verifier = new AgentINFTVerifier(oracle);
        inft = new AgentINFT(address(reg), "https://example.test/inft/", address(verifier), oracle);
        reg.setInft(address(inft));
        vm.stopPrank();

        vm.prank(agentEoa);
        reg.register("tradewise.test", agentEoa);
    }

    /// @dev Build a minimal valid mint proof signed by the test oracle key.
    function _mintProof(bytes32 dataHash, bytes memory nonce) internal view returns (bytes memory) {
        bytes32 messageHash = keccak256(abi.encodePacked("inft-mint-v1", dataHash, nonce));
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, prefixed);
        return abi.encodePacked(bytes1(0x00), abi.encodePacked(r, s, v), dataHash, nonce);
    }

    function test_register_assignsId1() public view {
        assertEq(reg.agentIdOf(agentEoa), 1);
        IdentityRegistryV2.Agent memory a = reg.getAgent(1);
        assertEq(a.agentWallet, agentEoa);
        assertTrue(a.active);
    }

    function test_registerByDeployer_setsAgentAddress() public {
        address third = address(0xC4FE);
        vm.prank(deployer);
        uint256 id = reg.registerByDeployer(third, "third.test", third);
        assertEq(id, 2);
        IdentityRegistryV2.Agent memory a = reg.getAgent(2);
        assertEq(a.agentAddress, third);
        assertEq(a.agentWallet, third);
        assertEq(reg.agentIdOf(third), 2);
    }

    function test_registerByDeployer_revertsForStranger() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(bytes("not deployer"));
        reg.registerByDeployer(address(0xC4FE), "third.test", address(0xC4FE));
    }

    function test_setInft_isOneShot() public {
        vm.prank(deployer);
        vm.expectRevert(bytes("already set"));
        reg.setInft(address(0xDEAD));
    }

    function test_clearAgentWallet_onlyInft() public {
        vm.expectRevert(bytes("only INFT"));
        reg.clearAgentWalletOnTransfer(1);
    }

    function test_inftTransfer_clearsWallet() public {
        vm.prank(deployer);
        inft.mint(agentEoa, 1, _mintProof(keccak256("root"), abi.encodePacked(uint256(999), uint128(0))));

        // Sanity: wallet still set after mint.
        assertEq(reg.getAgent(1).agentWallet, agentEoa);

        vm.prank(agentEoa);
        inft.transferFrom(agentEoa, newOwner, 1);

        assertEq(reg.getAgent(1).agentWallet, address(0));
    }

    function test_setAgentWallet_acceptsValidSig() public {
        vm.prank(deployer);
        inft.mint(agentEoa, 1, _mintProof(keccak256("root"), abi.encodePacked(uint256(999), uint128(0))));
        vm.prank(agentEoa);
        inft.transferFrom(agentEoa, newOwner, 1);

        address payTo = address(0xB0B);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = reg.agentNonces(1);

        bytes32 structHash = keccak256(
            abi.encode(
                SET_AGENT_WALLET_TYPEHASH,
                uint256(1),
                payTo,
                deadline,
                nonce
            )
        );
        bytes32 digest = MessageHashUtilsLite.toTypedDataHash(
            reg.domainSeparator(),
            structHash
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(newOwnerPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        reg.setAgentWallet(1, payTo, deadline, sig);

        assertEq(reg.getAgent(1).agentWallet, payTo);
        assertEq(reg.agentNonces(1), nonce + 1);
    }

    function test_setAgentWallet_rejectsWrongSigner() public {
        vm.prank(deployer);
        inft.mint(agentEoa, 1, _mintProof(keccak256("root"), abi.encodePacked(uint256(999), uint128(0))));
        vm.prank(agentEoa);
        inft.transferFrom(agentEoa, newOwner, 1);

        uint256 wrongPk = 0xDEAD;
        address payTo = address(0xB0B);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = reg.agentNonces(1);

        bytes32 structHash = keccak256(
            abi.encode(
                SET_AGENT_WALLET_TYPEHASH,
                uint256(1),
                payTo,
                deadline,
                nonce
            )
        );
        bytes32 digest = MessageHashUtilsLite.toTypedDataHash(
            reg.domainSeparator(),
            structHash
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(bytes("not inft owner"));
        reg.setAgentWallet(1, payTo, deadline, sig);
    }

    function test_setAgentWallet_rejectsExpired() public {
        vm.prank(deployer);
        inft.mint(agentEoa, 1, _mintProof(keccak256("root"), abi.encodePacked(uint256(999), uint128(0))));
        vm.prank(agentEoa);
        inft.transferFrom(agentEoa, newOwner, 1);

        uint256 deadline = block.timestamp;
        vm.warp(deadline + 1);

        bytes memory emptySig = new bytes(65);
        vm.expectRevert(bytes("deadline passed"));
        reg.setAgentWallet(1, address(0xB0B), deadline, emptySig);
    }
}

library MessageHashUtilsLite {
    function toTypedDataHash(
        bytes32 domainSeparator,
        bytes32 structHash
    ) internal pure returns (bytes32) {
        return
            keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }
}
