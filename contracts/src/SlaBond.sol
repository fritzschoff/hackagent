// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Slashable USDC bonds per job — the unlock for B2B agent SLAs.
///
/// Flow:
///   1. agent calls postBond(jobId, client, amount) before serving the job;
///      USDC pulled from agent into escrow.
///   2. happy path: agent calls release(jobId) after validation passes -> bond
///      returned to agent.
///   3. unhappy path: validator (registered single signer) calls
///      slash(jobId) if the validation found bad output. 70% of the bond
///      refunds the client, 30% rewards the slasher (the validator).
///
/// This is the slashable-bond corner of EIP-8004 §3.6 nobody implements.
/// Pair with a marketplace listing per agent and you have insurable agent
/// services.
contract SlaBond is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDC;
    address public immutable deployer;
    address public validator;

    /// 70% of the bond refunds the client on slash; 30% rewards the slasher.
    uint256 public constant CLIENT_BPS = 7_000;
    uint256 public constant SLASHER_BPS = 3_000;
    uint256 public constant BPS_DENOM = 10_000;

    enum Status {
        None,
        Posted,
        Released,
        Slashed
    }

    struct Bond {
        address agent;
        address client;
        uint256 amount;
        uint64 postedAt;
        Status status;
    }

    mapping(bytes32 => Bond) public bonds;

    event ValidatorSet(address indexed validator);
    event BondPosted(
        bytes32 indexed jobId,
        address indexed agent,
        address indexed client,
        uint256 amount
    );
    event BondReleased(bytes32 indexed jobId, uint256 amount);
    event BondSlashed(
        bytes32 indexed jobId,
        address indexed slasher,
        uint256 clientRefund,
        uint256 slasherReward
    );

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

    function postBond(
        bytes32 jobId,
        address client,
        uint256 amount
    ) external nonReentrant {
        require(amount > 0, "zero");
        require(client != address(0), "client zero");
        Bond storage b = bonds[jobId];
        require(b.status == Status.None, "exists");
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        bonds[jobId] = Bond({
            agent: msg.sender,
            client: client,
            amount: amount,
            postedAt: uint64(block.timestamp),
            status: Status.Posted
        });
        emit BondPosted(jobId, msg.sender, client, amount);
    }

    function release(bytes32 jobId) external nonReentrant {
        Bond storage b = bonds[jobId];
        require(b.status == Status.Posted, "bad status");
        require(msg.sender == b.agent, "not agent");
        uint256 amount = b.amount;
        b.status = Status.Released;
        b.amount = 0;
        USDC.safeTransfer(b.agent, amount);
        emit BondReleased(jobId, amount);
    }

    function slash(bytes32 jobId) external nonReentrant {
        Bond storage b = bonds[jobId];
        require(b.status == Status.Posted, "bad status");
        require(msg.sender == validator, "not validator");
        uint256 amount = b.amount;
        uint256 toClient = (amount * CLIENT_BPS) / BPS_DENOM;
        uint256 toSlasher = amount - toClient;
        b.status = Status.Slashed;
        b.amount = 0;
        if (toClient > 0) USDC.safeTransfer(b.client, toClient);
        if (toSlasher > 0) USDC.safeTransfer(msg.sender, toSlasher);
        emit BondSlashed(jobId, msg.sender, toClient, toSlasher);
    }
}
