// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ComplianceManifest} from "../src/ComplianceManifest.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("MockUSDC", "USDC") {}
    function decimals() public pure override returns (uint8) {
        return 6;
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ComplianceManifestTest is Test {
    ComplianceManifest internal manifest;
    MockUSDC internal usdc;

    address internal deployer = address(this);
    address internal validator = address(0xA110);
    address internal agent = address(0xA1);
    address internal challenger = address(0xC1);

    bytes32 internal constant ROOT_A = keccak256("manifest-v1");
    bytes32 internal constant ROOT_B = keccak256("manifest-v2");
    string internal constant URI_A = "og://manifest-v1";
    string internal constant URI_B = "og://manifest-v2";

    uint256 internal constant AGENT_ID = 1;
    uint256 internal constant BOND = 1_000_000; // 1 USDC

    function setUp() public {
        usdc = new MockUSDC();
        manifest = new ComplianceManifest(address(usdc), validator);

        usdc.mint(agent, 100_000_000);
        usdc.mint(challenger, 100_000_000);

        vm.prank(agent);
        usdc.approve(address(manifest), type(uint256).max);
        vm.prank(challenger);
        usdc.approve(address(manifest), type(uint256).max);
    }

    function test_constructor_setsValidator() public {
        assertEq(manifest.validator(), validator);
        assertEq(address(manifest.USDC()), address(usdc));
        assertEq(manifest.deployer(), deployer);
    }

    function test_setValidator_onlyDeployer() public {
        vm.prank(agent);
        vm.expectRevert(bytes("not deployer"));
        manifest.setValidator(address(0xBEEF));

        manifest.setValidator(address(0xBEEF));
        assertEq(manifest.validator(), address(0xBEEF));
    }

    function test_commitManifest_first_storesRootBondAndStatus() public {
        vm.prank(agent);
        manifest.commitManifest(AGENT_ID, ROOT_A, URI_A, BOND);

        (
            address ag,
            bytes32 root,
            string memory uri,
            uint256 bond,
            ,
            ComplianceManifest.Status status,
            ,
            ,

        ) = manifest.getManifest(AGENT_ID);
        assertEq(ag, agent);
        assertEq(root, ROOT_A);
        assertEq(uri, URI_A);
        assertEq(bond, BOND);
        assertEq(uint256(status), uint256(ComplianceManifest.Status.Committed));
        assertEq(usdc.balanceOf(address(manifest)), BOND);
        assertEq(manifest.manifestCount(), 1);
    }

    function test_commitManifest_zeroAgentId_reverts() public {
        vm.prank(agent);
        vm.expectRevert(bytes("agentId zero"));
        manifest.commitManifest(0, ROOT_A, URI_A, 0);
    }

    function test_commitManifest_zeroRoot_reverts() public {
        vm.prank(agent);
        vm.expectRevert(bytes("root zero"));
        manifest.commitManifest(AGENT_ID, bytes32(0), URI_A, 0);
    }

    function test_commitManifest_recommit_updatesAndAccumulatesBond() public {
        vm.prank(agent);
        manifest.commitManifest(AGENT_ID, ROOT_A, URI_A, BOND);

        vm.prank(agent);
        manifest.commitManifest(AGENT_ID, ROOT_B, URI_B, BOND);

        (
            ,
            bytes32 root,
            string memory uri,
            uint256 bond,
            ,
            ComplianceManifest.Status status,
            ,
            ,

        ) = manifest.getManifest(AGENT_ID);
        assertEq(root, ROOT_B);
        assertEq(uri, URI_B);
        assertEq(bond, BOND * 2);
        assertEq(uint256(status), uint256(ComplianceManifest.Status.Committed));
        assertEq(manifest.manifestCount(), 1);
    }

    function test_commitManifest_recommit_byNonAgent_reverts() public {
        vm.prank(agent);
        manifest.commitManifest(AGENT_ID, ROOT_A, URI_A, BOND);

        vm.prank(challenger);
        vm.expectRevert(bytes("not agent"));
        manifest.commitManifest(AGENT_ID, ROOT_B, URI_B, 0);
    }

    function test_challenge_happyPath_locksManifest() public {
        vm.prank(agent);
        manifest.commitManifest(AGENT_ID, ROOT_A, URI_A, BOND);

        vm.prank(challenger);
        manifest.challenge(AGENT_ID, BOND, "og://evidence");

        (
            ,
            ,
            ,
            ,
            ,
            ComplianceManifest.Status status,
            address ch,
            uint256 chBond,
            string memory ev
        ) = manifest.getManifest(AGENT_ID);
        assertEq(uint256(status), uint256(ComplianceManifest.Status.Challenged));
        assertEq(ch, challenger);
        assertEq(chBond, BOND);
        assertEq(ev, "og://evidence");
        assertEq(usdc.balanceOf(address(manifest)), BOND * 2);
    }

    function test_challenge_bondTooSmall_reverts() public {
        vm.prank(agent);
        manifest.commitManifest(AGENT_ID, ROOT_A, URI_A, BOND);

        vm.prank(challenger);
        vm.expectRevert(bytes("bond too small"));
        manifest.challenge(AGENT_ID, BOND - 1, "og://evidence");
    }

    function test_challenge_emptyEvidence_reverts() public {
        vm.prank(agent);
        manifest.commitManifest(AGENT_ID, ROOT_A, URI_A, BOND);

        vm.prank(challenger);
        vm.expectRevert(bytes("no evidence"));
        manifest.challenge(AGENT_ID, BOND, "");
    }

    function test_challenge_notCommitted_reverts() public {
        vm.prank(challenger);
        vm.expectRevert(bytes("not challengeable"));
        manifest.challenge(AGENT_ID, BOND, "og://evidence");
    }

    function test_challenge_alreadyChallenged_reverts() public {
        vm.prank(agent);
        manifest.commitManifest(AGENT_ID, ROOT_A, URI_A, BOND);
        vm.prank(challenger);
        manifest.challenge(AGENT_ID, BOND, "og://evidence");

        vm.prank(challenger);
        vm.expectRevert(bytes("not challengeable"));
        manifest.challenge(AGENT_ID, BOND, "og://evidence-2");
    }

    function test_resolve_upheld_70_30_split_andSlashed() public {
        vm.prank(agent);
        manifest.commitManifest(AGENT_ID, ROOT_A, URI_A, BOND);
        vm.prank(challenger);
        manifest.challenge(AGENT_ID, BOND, "og://evidence");

        uint256 chBefore = usdc.balanceOf(challenger);
        uint256 vBefore = usdc.balanceOf(validator);

        vm.prank(validator);
        manifest.resolve(AGENT_ID, true);

        // Challenger gets back their own bond (BOND) + 70% of agent's bond
        uint256 reward = (BOND * 7000) / 10000;
        uint256 vReward = BOND - reward;
        assertEq(usdc.balanceOf(challenger), chBefore + BOND + reward);
        assertEq(usdc.balanceOf(validator), vBefore + vReward);

        (, , , uint256 bond, , ComplianceManifest.Status status, , , ) =
            manifest.getManifest(AGENT_ID);
        assertEq(uint256(status), uint256(ComplianceManifest.Status.Slashed));
        assertEq(bond, 0);
    }

    function test_resolve_dismissed_refundsToAgent_returnsToCommitted() public {
        vm.prank(agent);
        manifest.commitManifest(AGENT_ID, ROOT_A, URI_A, BOND);
        vm.prank(challenger);
        manifest.challenge(AGENT_ID, BOND, "og://evidence");

        uint256 agBefore = usdc.balanceOf(agent);

        vm.prank(validator);
        manifest.resolve(AGENT_ID, false);

        // Agent receives the challenger's bond as nuisance comp
        assertEq(usdc.balanceOf(agent), agBefore + BOND);

        (
            ,
            ,
            ,
            uint256 bond,
            ,
            ComplianceManifest.Status status,
            address ch,
            uint256 chBond,
            string memory ev
        ) = manifest.getManifest(AGENT_ID);
        assertEq(uint256(status), uint256(ComplianceManifest.Status.Committed));
        assertEq(bond, BOND); // agent's original bond preserved
        assertEq(ch, address(0));
        assertEq(chBond, 0);
        assertEq(bytes(ev).length, 0);
    }

    function test_resolve_onlyValidator() public {
        vm.prank(agent);
        manifest.commitManifest(AGENT_ID, ROOT_A, URI_A, BOND);
        vm.prank(challenger);
        manifest.challenge(AGENT_ID, BOND, "og://evidence");

        vm.prank(challenger);
        vm.expectRevert(bytes("not validator"));
        manifest.resolve(AGENT_ID, true);
    }

    function test_resolve_notChallenged_reverts() public {
        vm.prank(agent);
        manifest.commitManifest(AGENT_ID, ROOT_A, URI_A, BOND);

        vm.prank(validator);
        vm.expectRevert(bytes("not challenged"));
        manifest.resolve(AGENT_ID, true);
    }

    function test_resolve_canBeRechallengedAfterDismiss() public {
        vm.prank(agent);
        manifest.commitManifest(AGENT_ID, ROOT_A, URI_A, BOND);
        vm.prank(challenger);
        manifest.challenge(AGENT_ID, BOND, "og://evidence");
        vm.prank(validator);
        manifest.resolve(AGENT_ID, false);

        // Status is Committed again — can re-challenge
        vm.prank(challenger);
        manifest.challenge(AGENT_ID, BOND, "og://evidence-2");
        (, , , , , ComplianceManifest.Status status, , , ) =
            manifest.getManifest(AGENT_ID);
        assertEq(uint256(status), uint256(ComplianceManifest.Status.Challenged));
    }

    function test_emit_ManifestCommitted_onFirstCommit() public {
        vm.expectEmit(true, true, false, true);
        emit ComplianceManifest.ManifestCommitted(AGENT_ID, agent, ROOT_A, URI_A, BOND);
        vm.prank(agent);
        manifest.commitManifest(AGENT_ID, ROOT_A, URI_A, BOND);
    }

    function test_emit_ManifestSlashed_onUpheld() public {
        vm.prank(agent);
        manifest.commitManifest(AGENT_ID, ROOT_A, URI_A, BOND);
        vm.prank(challenger);
        manifest.challenge(AGENT_ID, BOND, "og://evidence");

        uint256 reward = (BOND * 7000) / 10000;
        uint256 vReward = BOND - reward;
        vm.expectEmit(true, true, false, true);
        emit ComplianceManifest.ManifestSlashed(AGENT_ID, challenger, reward, vReward);
        vm.prank(validator);
        manifest.resolve(AGENT_ID, true);
    }
}
