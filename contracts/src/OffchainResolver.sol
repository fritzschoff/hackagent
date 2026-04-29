// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal interface for ENSIP-10 wildcard resolution (EIP-3668).
interface IExtendedResolver {
    function resolve(bytes memory name, bytes memory data)
        external view returns (bytes memory);
}

/// @notice ERC-165 interface check.
interface ISupportsInterface {
    function supportsInterface(bytes4 interfaceID) external pure returns (bool);
}

/// @notice EIP-3668 offchain resolver for *.agentlab.eth wildcard resolution.
///
/// Every `resolve()` call reverts `OffchainLookup`; wagmi/viem CCIP-Read clients
/// automatically follow up with the gateway URL and call `resolveWithProof()`
/// to verify the signed response on-chain.
///
/// Security posture (W2-α trusted gateway):
///   - Compromise of `expectedGatewaySigner` → malicious resolution.
///   - Worst-case impact is stale/spoofed telemetry records (last-seen-at,
///     reputation-summary, etc.), NOT falsified ownership — ownership lives in
///     the L1 ENS registry, not in this contract.
contract OffchainResolver is IExtendedResolver, ISupportsInterface {
    // ------------------------------------------------------------------ state
    string[] public urls;
    address public expectedGatewaySigner;
    address public immutable owner;

    // ------------------------------------------------------------------ errors
    /// @notice EIP-3668 revert — clients decode this to perform the offchain lookup.
    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );

    /// @notice Response timestamp is in the past.
    error ExpiredResponse();

    /// @notice ecrecover produced an address that does not match expectedGatewaySigner.
    error InvalidSigner();

    // ------------------------------------------------------------------ events
    event SignerChanged(address indexed oldSigner, address indexed newSigner);
    event UrlsChanged();

    // ------------------------------------------------------------------ constructor
    constructor(string[] memory _urls, address _signer) {
        require(_urls.length > 0, "no urls");
        require(_signer != address(0), "signer zero");
        urls = _urls;
        expectedGatewaySigner = _signer;
        owner = msg.sender;
    }

    // ------------------------------------------------------------------ view helpers
    /// @notice Convenience accessor so callers can read the number of gateway URLs.
    function urlsLength() external view returns (uint256) {
        return urls.length;
    }

    // ------------------------------------------------------------------ IExtendedResolver
    /// @notice Always reverts OffchainLookup per EIP-3668.
    ///
    /// The `callData` and `extraData` are both set to `abi.encode(name, data)` so
    /// the gateway can decode both the DNS wire-format name and the resolve selector,
    /// and `resolveWithProof` receives the same bytes for hash verification.
    function resolve(bytes calldata name, bytes calldata data)
        external view returns (bytes memory)
    {
        bytes memory callData = abi.encode(name, data);
        revert OffchainLookup(
            address(this),
            urls,
            callData,
            this.resolveWithProof.selector,
            callData
        );
    }

    // ------------------------------------------------------------------ callback
    /// @notice Called by the CCIP-Read client after receiving the gateway response.
    ///
    /// Response format:
    ///   abi.encode(uint64 expires, bytes result, bytes signature)
    ///
    /// Signed message (EIP-191 v0 / "version 0x00"):
    ///   keccak256(abi.encodePacked(
    ///     hex"1900",          // EIP-191 prefix for v=0 (data with intended validator)
    ///     address(this),      // this contract — ties the sig to this resolver
    ///     expires,            // uint64, prevents replay after TTL
    ///     keccak256(extraData), // ties the sig to the original resolve() callData
    ///     keccak256(result)   // the actual record payload
    ///   ))
    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external view returns (bytes memory)
    {
        (uint64 expires, bytes memory result, bytes memory sig) =
            abi.decode(response, (uint64, bytes, bytes));

        // 1. Expiry check.
        if (block.timestamp > expires) revert ExpiredResponse();

        // 2. Reconstruct EIP-191 message hash.
        bytes32 messageHash = keccak256(abi.encodePacked(
            hex"1900",
            address(this),
            expires,
            keccak256(extraData),
            keccak256(result)
        ));

        // 3. Recover signer — sig must be exactly 65 bytes (r, s, v).
        if (sig.length != 65) revert InvalidSigner();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        address recovered = ecrecover(messageHash, v, r, s);

        // 4. ecrecover returns address(0) on failure; treat as InvalidSigner.
        if (recovered == address(0) || recovered != expectedGatewaySigner) {
            revert InvalidSigner();
        }

        return result;
    }

    // ------------------------------------------------------------------ admin
    /// @notice Update the list of gateway URLs. Owner only.
    function setUrls(string[] calldata _urls) external {
        require(msg.sender == owner, "not owner");
        require(_urls.length > 0, "no urls");
        // Copy element-by-element: string[]calldata → storage not supported by
        // the old Solidity code-generator.
        delete urls;
        for (uint256 i = 0; i < _urls.length; i++) {
            urls.push(_urls[i]);
        }
        emit UrlsChanged();
    }

    /// @notice Update the expected gateway signer address. Owner only.
    function setSigner(address _signer) external {
        require(msg.sender == owner, "not owner");
        require(_signer != address(0), "signer zero");
        emit SignerChanged(expectedGatewaySigner, _signer);
        expectedGatewaySigner = _signer;
    }

    // ------------------------------------------------------------------ ERC-165
    /// @notice Returns true for:
    ///   0x9061b923 — ENSIP-10 wildcard resolver (IExtendedResolver selector)
    ///   type(IExtendedResolver).interfaceId — same value computed by the compiler
    ///   0x01ffc9a7 — ERC-165 itself
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IExtendedResolver).interfaceId  // 0x9061b923 per ENSIP-10
            || id == 0x9061b923                           // explicit constant for clarity
            || id == 0x01ffc9a7;                         // ERC-165
    }
}
