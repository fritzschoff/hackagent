// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Subset of HyperCore precompile reads needed by the M2 stack.
///
/// Address map and gas formula taken from the public L1Read.sol reference
/// (native-markets/hyperevm-tools, HL_FACTS.md §3). We only expose the
/// reads our agent actually needs — position, oracle price, mark price,
/// withdrawable, account margin summary, perp asset info — to keep the
/// audit surface small. Add more as they become load-bearing.
///
/// Each precompile reverts with all-gas-burn on bad input. We cap the
/// gas forwarded to keep our caller alive on misuse.
library L1Read {
    // ─── precompile addresses ────────────────────────────────────────────
    //
    // Only the reads we actually use are exposed; the full HL precompile
    // map is at .claude/agents/tradewise-memory.md §3. We standardise on
    // POSITION2 (uint32 perp index) since the uint16-indexed POSITION at
    // 0x0800 is the legacy variant.

    address constant WITHDRAWABLE = 0x0000000000000000000000000000000000000803;
    address constant MARK_PX = 0x0000000000000000000000000000000000000806;
    address constant ORACLE_PX = 0x0000000000000000000000000000000000000807;
    address constant PERP_ASSET_INFO = 0x000000000000000000000000000000000000080a;
    address constant ACCOUNT_MARGIN_SUMMARY =
        0x000000000000000000000000000000000000080F;
    address constant POSITION2 = 0x0000000000000000000000000000000000000813;

    // Gas caps ≈ formula (2000 + 65*(input+output)) + ~20%.
    uint256 constant POSITION_GAS = 20_000;
    uint256 constant WITHDRAWABLE_GAS = 7500;
    uint256 constant MARK_PX_GAS = 7500;
    uint256 constant ORACLE_PX_GAS = 7500;
    uint256 constant PERP_ASSET_INFO_GAS = 15_000;
    uint256 constant ACCOUNT_MARGIN_SUMMARY_GAS = 17_500;

    // ─── structs (mirror L1Read reference) ───────────────────────────────

    struct Position {
        int64 szi;
        uint64 entryNtl;
        int64 isolatedRawUsd;
        uint32 leverage;
        bool isIsolated;
    }

    struct AccountMarginSummary {
        int64 accountValue;
        uint64 marginUsed;
        uint64 ntlPos;
        int64 rawUsd;
    }

    struct PerpAssetInfo {
        string coin;
        uint32 marginTableId;
        uint8 szDecimals;
        uint8 maxLeverage;
        bool onlyIsolated;
    }

    // ─── reads ───────────────────────────────────────────────────────────

    /// Position for `user` on `perp` (uint32-indexed).
    function position(
        address user,
        uint32 perp
    ) internal view returns (Position memory) {
        (bool ok, bytes memory data) = POSITION2.staticcall{gas: POSITION_GAS}(
            abi.encode(user, perp)
        );
        require(ok, "L1Read: position failed");
        return abi.decode(data, (Position));
    }

    /// Oracle price for `perp` in HyperCore's native fixed-point.
    /// Returns 0 on success path for non-existent indices; check separately.
    function oraclePx(uint32 perp) internal view returns (uint64) {
        (bool ok, bytes memory data) = ORACLE_PX.staticcall{
            gas: ORACLE_PX_GAS
        }(abi.encode(perp));
        require(ok, "L1Read: oraclePx failed");
        return abi.decode(data, (uint64));
    }

    /// Mark price for `perp` in HyperCore's native fixed-point.
    function markPx(uint32 perp) internal view returns (uint64) {
        (bool ok, bytes memory data) = MARK_PX.staticcall{gas: MARK_PX_GAS}(
            abi.encode(perp)
        );
        require(ok, "L1Read: markPx failed");
        return abi.decode(data, (uint64));
    }

    /// Amount `user` can withdraw without affecting open positions.
    function withdrawable(address user) internal view returns (uint64) {
        (bool ok, bytes memory data) = WITHDRAWABLE.staticcall{
            gas: WITHDRAWABLE_GAS
        }(abi.encode(user));
        require(ok, "L1Read: withdrawable failed");
        return abi.decode(data, (uint64));
    }

    /// Account-level margin summary for `user` on `perp` (perp dex id).
    /// Note: HL is multi-perp-dex; perp=0 is the main dex.
    function accountMarginSummary(
        address user,
        uint32 perp
    ) internal view returns (AccountMarginSummary memory) {
        (bool ok, bytes memory data) = ACCOUNT_MARGIN_SUMMARY.staticcall{
            gas: ACCOUNT_MARGIN_SUMMARY_GAS
        }(abi.encode(user, perp));
        require(ok, "L1Read: marginSummary failed");
        return abi.decode(data, (AccountMarginSummary));
    }

    /// Static asset info (szDecimals, maxLeverage, isolated-only flag).
    /// Useful for tick-size validation before sending an order.
    function perpAssetInfo(
        uint32 perp
    ) internal view returns (PerpAssetInfo memory) {
        (bool ok, bytes memory data) = PERP_ASSET_INFO.staticcall{
            gas: PERP_ASSET_INFO_GAS
        }(abi.encode(perp));
        require(ok, "L1Read: assetInfo failed");
        return abi.decode(data, (PerpAssetInfo));
    }
}
