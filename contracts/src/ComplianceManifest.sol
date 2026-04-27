// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Compliance manifest registry for ERC-8004 agents.
///
/// Universal "KYC for agents": each agent commits a Merkle root of a JSON
/// manifest declaring every external data source it touches (URL, ToS hash,
/// license tier). Manifest content is anchored to 0G Storage; only the root
/// + URI live on chain. Anyone can read the manifest off chain and judge for
/// themselves.
///
/// To put teeth on the declaration, agents post a USDC compliance bond.
/// Anyone can challenge the manifest by posting a counter-bond + evidence
/// URI. A registered validator (single signer for now; can be replaced with
/// a DAO or quorum) resolves: if the challenge is upheld, the agent's bond
/// splits 70/30 between challenger and validator (slasher reward), and the
/// manifest enters Slashed state — a permanent on-chain reputation penalty.
///
/// State machine:
///   None → Committed → Challenged → Slashed
///                            ↓
///                          Cleared (challenge dismissed, bonds refunded)
contract ComplianceManifest is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDC;
    address public immutable deployer;
    address public validator;

    /// 70% of the slashed bond goes to the successful challenger; 30% rewards
    /// the validator that resolved.
    uint256 public constant CHALLENGER_BPS = 7_000;
    uint256 public constant VALIDATOR_BPS = 3_000;
    uint256 public constant BPS_DENOM = 10_000;

    enum Status {
        None,
        Committed,
        Challenged,
        Slashed,
        Cleared
    }

    struct Manifest {
        address agent;
        bytes32 manifestRoot;
        string manifestUri; // og:// or ipfs:// or https URI
        uint256 bond;
        uint64 committedAt;
        uint64 challengedAt;
        address challenger;
        uint256 challengerBond;
        string evidenceUri;
        Status status;
    }

    /// agentId → manifest
    mapping(uint256 => Manifest) public manifests;
    uint256 public manifestCount;

    event ValidatorSet(address indexed validator);
    event ManifestCommitted(
        uint256 indexed agentId,
        address indexed agent,
        bytes32 manifestRoot,
        string manifestUri,
        uint256 bond
    );
    event ManifestUpdated(
        uint256 indexed agentId,
        bytes32 newRoot,
        string newUri
    );
    event ManifestChallenged(
        uint256 indexed agentId,
        address indexed challenger,
        uint256 challengerBond,
        string evidenceUri
    );
    event ManifestSlashed(
        uint256 indexed agentId,
        address indexed challenger,
        uint256 challengerReward,
        uint256 validatorReward
    );
    event ManifestCleared(uint256 indexed agentId);
    event BondWithdrawn(uint256 indexed agentId, uint256 amount);

    constructor(address usdc, address validator_) {
        USDC = IERC20(usdc);
        deployer = msg.sender;
        validator = validator_;
        emit ValidatorSet(validator_);
    }

    function setValidator(address newValidator) external {
        require(msg.sender == deployer, "not deployer");
        validator = newValidator;
        emit ValidatorSet(newValidator);
    }

    /// Commit (or re-commit, if not currently challenged) a manifest for the
    /// given agentId. Optionally post a USDC compliance bond in the same call.
    function commitManifest(
        uint256 agentId,
        bytes32 manifestRoot,
        string calldata manifestUri,
        uint256 bondAmount
    ) external nonReentrant {
        require(agentId > 0, "agentId zero");
        require(manifestRoot != bytes32(0), "root zero");
        Manifest storage m = manifests[agentId];
        require(
            m.status == Status.None || m.status == Status.Committed,
            "challenged or slashed"
        );

        bool first = m.status == Status.None;

        if (bondAmount > 0) {
            USDC.safeTransferFrom(msg.sender, address(this), bondAmount);
        }

        if (first) {
            manifests[agentId] = Manifest({
                agent: msg.sender,
                manifestRoot: manifestRoot,
                manifestUri: manifestUri,
                bond: bondAmount,
                committedAt: uint64(block.timestamp),
                challengedAt: 0,
                challenger: address(0),
                challengerBond: 0,
                evidenceUri: "",
                status: Status.Committed
            });
            unchecked {
                manifestCount++;
            }
            emit ManifestCommitted(
                agentId,
                msg.sender,
                manifestRoot,
                manifestUri,
                bondAmount
            );
        } else {
            require(msg.sender == m.agent, "not agent");
            m.manifestRoot = manifestRoot;
            m.manifestUri = manifestUri;
            m.bond += bondAmount;
            emit ManifestUpdated(agentId, manifestRoot, manifestUri);
        }
    }

    /// Anyone can challenge a committed manifest by posting a counter-bond
    /// >= the agent's bond + an evidence URI. Locks the manifest until the
    /// validator resolves.
    function challenge(
        uint256 agentId,
        uint256 challengerBond,
        string calldata evidenceUri
    ) external nonReentrant {
        Manifest storage m = manifests[agentId];
        require(m.status == Status.Committed, "not challengeable");
        require(challengerBond >= m.bond, "bond too small");
        require(challengerBond > 0, "zero bond");
        require(bytes(evidenceUri).length > 0, "no evidence");

        USDC.safeTransferFrom(msg.sender, address(this), challengerBond);

        m.status = Status.Challenged;
        m.challenger = msg.sender;
        m.challengerBond = challengerBond;
        m.evidenceUri = evidenceUri;
        m.challengedAt = uint64(block.timestamp);

        emit ManifestChallenged(agentId, msg.sender, challengerBond, evidenceUri);
    }

    /// Validator-only resolution. If `upheld`, the agent's bond is split 70/30
    /// between the challenger and the validator (slasher reward); the
    /// challenger's own bond is refunded. If dismissed, the challenger's bond
    /// goes to the agent and the manifest returns to Committed.
    function resolve(uint256 agentId, bool upheld) external nonReentrant {
        require(msg.sender == validator, "not validator");
        Manifest storage m = manifests[agentId];
        require(m.status == Status.Challenged, "not challenged");

        uint256 agentBond = m.bond;
        uint256 chBond = m.challengerBond;
        address ch = m.challenger;
        address ag = m.agent;

        m.bond = 0;
        m.challengerBond = 0;

        if (upheld) {
            uint256 toChallenger = (agentBond * CHALLENGER_BPS) / BPS_DENOM;
            uint256 toValidator = agentBond - toChallenger;
            m.status = Status.Slashed;
            // refund challenger their stake + reward share of slashed bond
            if (chBond > 0) USDC.safeTransfer(ch, chBond);
            if (toChallenger > 0) USDC.safeTransfer(ch, toChallenger);
            if (toValidator > 0) USDC.safeTransfer(msg.sender, toValidator);
            emit ManifestSlashed(agentId, ch, toChallenger, toValidator);
        } else {
            // dismissed — challenger's bond goes to the agent as nuisance
            // compensation; agent's bond stays escrowed in place.
            m.status = Status.Committed;
            m.bond = agentBond; // restore (we set to 0 above)
            m.challenger = address(0);
            m.evidenceUri = "";
            m.challengedAt = 0;
            if (chBond > 0) USDC.safeTransfer(ag, chBond);
            emit ManifestCleared(agentId);
        }
    }

    /// Agent withdraws their bond once the manifest is cleared (Slashed or
    /// retired). After Slashed, bond is already distributed; this only
    /// matters after a future "retire" path which we leave open.
    function withdrawBond(uint256 agentId) external nonReentrant {
        Manifest storage m = manifests[agentId];
        require(msg.sender == m.agent, "not agent");
        require(m.status == Status.Cleared, "not cleared");
        uint256 amount = m.bond;
        require(amount > 0, "no bond");
        m.bond = 0;
        USDC.safeTransfer(m.agent, amount);
        emit BondWithdrawn(agentId, amount);
    }

    /// Read helper for the dashboard.
    function getManifest(
        uint256 agentId
    )
        external
        view
        returns (
            address agent,
            bytes32 manifestRoot,
            string memory manifestUri,
            uint256 bond,
            uint64 committedAt,
            Status status,
            address challenger,
            uint256 challengerBond,
            string memory evidenceUri
        )
    {
        Manifest storage m = manifests[agentId];
        return (
            m.agent,
            m.manifestRoot,
            m.manifestUri,
            m.bond,
            m.committedAt,
            m.status,
            m.challenger,
            m.challengerBond,
            m.evidenceUri
        );
    }
}
