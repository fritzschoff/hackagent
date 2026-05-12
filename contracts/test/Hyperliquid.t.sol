// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {L1Read} from "../src/L1Read.sol";
import {HyperliquidActions, ICoreWriter} from "../src/HyperliquidActions.sol";

/// @notice Foundry tests for the HyperCore Solidity adapters. Uses
/// `vm.mockCall` to stand in for the HyperEVM precompiles and the
/// CoreWriter system contract — no live HyperEVM RPC required.
contract L1ReadTest is Test {
    address constant USER = address(0xA9E);
    uint32 constant ETH_PERP = 4;

    function test_oraclePx_decodesUint64() public {
        vm.mockCall(
            L1Read.ORACLE_PX,
            abi.encode(ETH_PERP),
            abi.encode(uint64(2_277_600_000))
        );
        uint64 px = L1Read.oraclePx(ETH_PERP);
        assertEq(px, 2_277_600_000);
    }

    function test_markPx_decodesUint64() public {
        vm.mockCall(
            L1Read.MARK_PX,
            abi.encode(ETH_PERP),
            abi.encode(uint64(2_282_800_000))
        );
        uint64 px = L1Read.markPx(ETH_PERP);
        assertEq(px, 2_282_800_000);
    }

    function test_withdrawable_decodesUint64() public {
        vm.mockCall(
            L1Read.WITHDRAWABLE,
            abi.encode(USER),
            abi.encode(uint64(123_456_789))
        );
        assertEq(L1Read.withdrawable(USER), 123_456_789);
    }

    function test_accountMarginSummary_decodesStruct() public {
        L1Read.AccountMarginSummary memory expected = L1Read
            .AccountMarginSummary({
                accountValue: int64(100_000_000),
                marginUsed: 25_000_000,
                ntlPos: 50_000_000,
                rawUsd: int64(75_000_000)
            });
        vm.mockCall(
            L1Read.ACCOUNT_MARGIN_SUMMARY,
            abi.encode(USER, uint32(0)),
            abi.encode(expected)
        );
        L1Read.AccountMarginSummary memory got = L1Read.accountMarginSummary(
            USER,
            0
        );
        assertEq(got.accountValue, expected.accountValue);
        assertEq(got.marginUsed, expected.marginUsed);
        assertEq(got.ntlPos, expected.ntlPos);
        assertEq(got.rawUsd, expected.rawUsd);
    }

    function test_position_decodesStruct() public {
        L1Read.Position memory expected = L1Read.Position({
            szi: -1_000_000_000, // short 1 unit, szDecimals=9 implies ~$1 notional
            entryNtl: 2_277_600_000,
            isolatedRawUsd: 0,
            leverage: 5,
            isIsolated: false
        });
        vm.mockCall(
            L1Read.POSITION2,
            abi.encode(USER, ETH_PERP),
            abi.encode(expected)
        );
        L1Read.Position memory got = L1Read.position(USER, ETH_PERP);
        assertEq(got.szi, expected.szi);
        assertEq(got.entryNtl, expected.entryNtl);
        assertEq(got.leverage, expected.leverage);
    }

    function _oraclePxTramp(uint32 perp) external view returns (uint64) {
        return L1Read.oraclePx(perp);
    }

    function test_oraclePx_revertsWhenPrecompileFails() public {
        vm.mockCallRevert(L1Read.ORACLE_PX, abi.encode(uint32(999)), "boom");
        vm.expectRevert(
            abi.encodeWithSignature("Error(string)", "L1Read: oraclePx failed")
        );
        this._oraclePxTramp(999);
    }
}

contract HyperliquidActionsTest is Test {
    /// Trampoline that simply forwards to the library so we can call it
    /// in a context where `address(this)` is the agent.
    function _sendLimit(
        uint32 asset,
        bool isBuy,
        uint64 px,
        uint64 sz,
        bool reduceOnly,
        uint8 tif,
        uint128 cloid
    ) external returns (bytes memory) {
        bytes memory enc = HyperliquidActions.encodeLimitOrder(
            asset,
            isBuy,
            px,
            sz,
            reduceOnly,
            tif,
            cloid
        );
        HyperliquidActions.send(enc);
        return enc;
    }

    function test_encodeLimitOrder_headerLayout() public pure {
        bytes memory enc = HyperliquidActions.encodeLimitOrder(
            4,
            true,
            2_282_800_000,
            1_000_000,
            false,
            HyperliquidActions.TIF_IOC,
            0
        );
        // First byte = version 0x01.
        assertEq(uint8(enc[0]), 1);
        // Next 3 bytes = action ID 1 (big-endian uint24).
        assertEq(uint8(enc[1]), 0);
        assertEq(uint8(enc[2]), 0);
        assertEq(uint8(enc[3]), 1);
        // Total length = 4-byte header + abi.encode of
        // (uint32,bool,uint64,uint64,bool,uint8,uint128) = 7 * 32 = 224.
        assertEq(enc.length, 4 + 224);
    }

    function test_encodeUsdClassTransfer_headerLayout() public pure {
        bytes memory enc = HyperliquidActions.encodeUsdClassTransfer(
            uint64(500_000),
            true
        );
        assertEq(uint8(enc[0]), 1);
        // action ID 7
        assertEq(uint8(enc[1]), 0);
        assertEq(uint8(enc[2]), 0);
        assertEq(uint8(enc[3]), 7);
        // abi.encode(uint64, bool) = 2 * 32 = 64
        assertEq(enc.length, 4 + 64);
    }

    function test_encodeCancelByCloid_headerLayout() public pure {
        bytes memory enc = HyperliquidActions.encodeCancelByCloid(
            4,
            type(uint128).max
        );
        assertEq(uint8(enc[0]), 1);
        assertEq(uint8(enc[3]), 11);
        assertEq(enc.length, 4 + 64);
    }

    function test_send_forwardsToCoreWriter() public {
        // CoreWriter must be called with exactly the encoded action bytes.
        bytes memory enc = HyperliquidActions.encodeLimitOrder(
            4,
            true,
            1_000_000,
            1,
            false,
            HyperliquidActions.TIF_IOC,
            0
        );
        vm.expectCall(
            HyperliquidActions.CORE_WRITER,
            abi.encodeWithSelector(ICoreWriter.sendRawAction.selector, enc)
        );
        // The mock just accepts the call.
        vm.mockCall(
            HyperliquidActions.CORE_WRITER,
            abi.encodeWithSelector(ICoreWriter.sendRawAction.selector, enc),
            bytes("")
        );
        this._sendLimit(4, true, 1_000_000, 1, false, HyperliquidActions.TIF_IOC, 0);
    }

    function test_tifConstants_unique() public pure {
        assertTrue(HyperliquidActions.TIF_ALO != HyperliquidActions.TIF_GTC);
        assertTrue(HyperliquidActions.TIF_GTC != HyperliquidActions.TIF_IOC);
        assertTrue(HyperliquidActions.TIF_ALO != HyperliquidActions.TIF_IOC);
    }
}
