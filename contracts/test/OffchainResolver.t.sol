// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {OffchainResolver} from "../src/OffchainResolver.sol";

// Re-declare the interface here so supportsInterface assertions compile
// without importing the full resolver.
interface IExtendedResolver {
    function resolve(bytes memory name, bytes memory data)
        external view returns (bytes memory);
}

contract OffchainResolverTest is Test {
    OffchainResolver internal resolver;
    uint256 internal signerPk = 0x5165B07E;
    string[] internal urls;

    function setUp() public {
        urls.push("https://hackagent-nine.vercel.app/api/ens-gateway/{sender}/{data}.json");
        address derived = vm.addr(signerPk);
        resolver = new OffchainResolver(urls, derived);
    }

    // ------------------------------------------------------------------ Task 1
    function test_resolve_revertsWithOffchainLookup() public {
        // DNS wire-format for "tradewise.agentlab.eth":
        // 09 + "tradewise" (9 bytes) + 08 + "agentlab" (8 bytes) + 03 + "eth" (3 bytes) + 00
        bytes memory name = abi.encodePacked(
            uint8(9), "tradewise",
            uint8(8), "agentlab",
            uint8(3), "eth",
            uint8(0)
        );
        bytes memory data = abi.encodeWithSelector(
            bytes4(keccak256("text(bytes32,string)")),
            keccak256("tradewise.agentlab.eth"),
            "last-seen-at"
        );

        vm.expectRevert();
        resolver.resolve(name, data);
    }

    // ------------------------------------------------------------------ helpers
    function _signResponse(uint64 expires, bytes memory result, bytes memory extraData)
        internal view returns (bytes memory)
    {
        bytes32 messageHash = keccak256(abi.encodePacked(
            hex"1900",
            address(resolver),
            expires,
            keccak256(extraData),
            keccak256(result)
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, messageHash);
        bytes memory sig = abi.encodePacked(r, s, v);
        return abi.encode(expires, result, sig);
    }

    // ------------------------------------------------------------------ Task 3 tests
    function test_resolveWithProof_validSignature_returnsResult() public {
        bytes memory result = abi.encode("hello world");
        bytes memory extraData = hex"deadbeef";
        uint64 expires = uint64(block.timestamp + 60);
        bytes memory response = _signResponse(expires, result, extraData);
        bytes memory got = resolver.resolveWithProof(response, extraData);
        assertEq(got, result);
    }

    function test_resolveWithProof_expired_reverts() public {
        bytes memory result = abi.encode("hello");
        bytes memory extraData = hex"";
        uint64 expires = uint64(block.timestamp - 1);
        bytes memory response = _signResponse(expires, result, extraData);
        vm.expectRevert(OffchainResolver.ExpiredResponse.selector);
        resolver.resolveWithProof(response, extraData);
    }

    function test_resolveWithProof_invalidSigner_reverts() public {
        bytes memory result = abi.encode("hello");
        bytes memory extraData = hex"";
        uint64 expires = uint64(block.timestamp + 60);
        bytes32 messageHash = keccak256(abi.encodePacked(
            hex"1900",
            address(resolver),
            expires,
            keccak256(extraData),
            keccak256(result)
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBADBAD, messageHash);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes memory response = abi.encode(expires, result, sig);
        vm.expectRevert(OffchainResolver.InvalidSigner.selector);
        resolver.resolveWithProof(response, extraData);
    }

    function test_resolveWithProof_extraDataMismatch_reverts() public {
        bytes memory result = abi.encode("hello");
        bytes memory extraData1 = hex"01";
        bytes memory extraData2 = hex"02";
        uint64 expires = uint64(block.timestamp + 60);
        bytes memory response = _signResponse(expires, result, extraData1);
        vm.expectRevert(OffchainResolver.InvalidSigner.selector);
        resolver.resolveWithProof(response, extraData2);
    }

    function test_supportsInterface_extendedAndWildcard() public view {
        assertTrue(resolver.supportsInterface(type(IExtendedResolver).interfaceId));
        assertTrue(resolver.supportsInterface(0x9061b923)); // ENSIP-10
        assertTrue(resolver.supportsInterface(0x01ffc9a7)); // ERC-165
        assertFalse(resolver.supportsInterface(0xdeadbeef));
    }

    function test_setSigner_onlyOwner() public {
        address newSigner = address(0xCAFE);
        vm.prank(address(0xBAD));
        vm.expectRevert("not owner");
        resolver.setSigner(newSigner);
    }

    function test_setUrls_onlyOwner() public {
        string[] memory newUrls = new string[](1);
        newUrls[0] = "https://example.com/{sender}/{data}.json";
        vm.prank(address(0xBAD));
        vm.expectRevert("not owner");
        resolver.setUrls(newUrls);
    }
}
