// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Interface to HyperCore's `CoreWriter` system contract at
/// 0x3333333333333333333333333333333333333333. Calling `sendRawAction`
/// burns ~25k gas and emits a log that HyperCore picks up on the next
/// L1 block. Action payload layout per HL_FACTS.md §3:
///
///   byte 0:      version    (currently 0x01)
///   bytes 1..3:  action ID  (big-endian uint24)
///   bytes 4..:   ABI-encoded params
interface ICoreWriter {
    function sendRawAction(bytes calldata data) external;
}

/// @notice Pure encoders for the HyperCore actions the M2 stack uses.
///
/// Library is stateless and trusts nothing — every range constraint that
/// would be enforced by HL is documented in NatSpec rather than checked,
/// because HL rejects invalid actions atomically. The treasury layer adds
/// the policy checks (auth, killed, position-tracking) on top.
library HyperliquidActions {
    address constant CORE_WRITER =
        0x3333333333333333333333333333333333333333;

    /// HL `Tif` (time-in-force) enum encoded as a single byte.
    /// Values match the wire format used by `sign_l1_action` in the
    /// Python SDK: 1 = Alo (post-only), 2 = Gtc, 3 = Ioc.
    uint8 constant TIF_ALO = 1;
    uint8 constant TIF_GTC = 2;
    uint8 constant TIF_IOC = 3;

    // ─── action IDs (HL_FACTS.md §3) ─────────────────────────────────────

    uint24 constant ACTION_LIMIT_ORDER = 1;
    uint24 constant ACTION_USD_CLASS_TRANSFER = 7;
    uint24 constant ACTION_CANCEL_BY_OID = 10;
    uint24 constant ACTION_CANCEL_BY_CLOID = 11;

    /// @notice Encode a HyperCore limit order action.
    /// @param asset    Perp asset index (universe order from `meta`).
    /// @param isBuy    true = bid, false = ask.
    /// @param limitPx  Limit price scaled to HyperCore's fixed-point
    ///                 (`price * 10^pxDecimals` where pxDecimals depends
    ///                 on the asset; see L1Read.perpAssetInfo).
    /// @param size     Position size scaled by `10^szDecimals`.
    /// @param reduceOnly  If true, order can only reduce existing position.
    /// @param tif      TIF_ALO | TIF_GTC | TIF_IOC.
    /// @param cloid    Client order id (0 if unused). 16-byte slot.
    function encodeLimitOrder(
        uint32 asset,
        bool isBuy,
        uint64 limitPx,
        uint64 size,
        bool reduceOnly,
        uint8 tif,
        uint128 cloid
    ) internal pure returns (bytes memory) {
        return
            _wrap(
                ACTION_LIMIT_ORDER,
                abi.encode(asset, isBuy, limitPx, size, reduceOnly, tif, cloid)
            );
    }

    /// @notice Move USDC between the `perp` and `spot` ledgers of the
    /// caller's HyperCore account. Needed because limit orders draw
    /// margin from the perp ledger but the bridge deposits USDC into spot.
    /// @param amount  Amount in USDC base units (6 decimals on HL).
    /// @param toPerp  true = spot → perp, false = perp → spot.
    function encodeUsdClassTransfer(
        uint64 amount,
        bool toPerp
    ) internal pure returns (bytes memory) {
        return
            _wrap(
                ACTION_USD_CLASS_TRANSFER,
                abi.encode(amount, toPerp)
            );
    }

    /// @notice Cancel an order by its exchange-assigned `oid`.
    function encodeCancelByOid(
        uint32 asset,
        uint64 oid
    ) internal pure returns (bytes memory) {
        return _wrap(ACTION_CANCEL_BY_OID, abi.encode(asset, oid));
    }

    /// @notice Cancel an order by client order id (cloid).
    function encodeCancelByCloid(
        uint32 asset,
        uint128 cloid
    ) internal pure returns (bytes memory) {
        return _wrap(ACTION_CANCEL_BY_CLOID, abi.encode(asset, cloid));
    }

    /// @notice Submit an already-encoded action to CoreWriter. Costs the
    /// caller ~25k gas + the abi.encoded payload size.
    function send(bytes memory action) internal {
        ICoreWriter(CORE_WRITER).sendRawAction(action);
    }

    // ─── internal ────────────────────────────────────────────────────────

    /// Prepend the version byte + 3-byte action ID to ABI-encoded params.
    /// Big-endian action ID per HL spec.
    function _wrap(
        uint24 actionId,
        bytes memory abiEncodedParams
    ) private pure returns (bytes memory) {
        bytes memory header = abi.encodePacked(
            uint8(1),
            uint8(actionId >> 16),
            uint8(actionId >> 8),
            uint8(actionId)
        );
        return bytes.concat(header, abiEncodedParams);
    }
}
