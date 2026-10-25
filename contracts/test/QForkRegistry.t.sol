// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {QForkRegistry} from "../src/QForkRegistry.sol";

contract QForkRegistryTest is Test {
    QForkRegistry internal registry;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    bytes32 internal constant HASH = keccak256("qfork/chain-dna/v1:example");
    string internal constant URI = "https://quantumfork.wtf/api/configs?hash=0x01";

    event Registered(
        bytes32 indexed id,
        address indexed creator,
        bytes32 indexed configHash,
        QForkRegistry.Kind kind,
        uint32 version,
        bytes32 parent,
        string metadataURI
    );
    event MetadataUpdated(bytes32 indexed id, string metadataURI);

    function setUp() public {
        registry = new QForkRegistry();
    }

    function _register(address who, bytes32 hash) internal returns (bytes32) {
        vm.prank(who);
        return registry.register(hash, QForkRegistry.Kind.Configuration, URI);
    }

    /* ---------- register ---------- */

    function test_register_storesRecord() public {
        vm.warp(1_700_000_000);
        bytes32 id = _register(alice, HASH);
        assertEq(id, registry.recordId(alice, HASH));
        assertTrue(registry.exists(id));
        QForkRegistry.Record memory record = registry.get(id);
        assertEq(record.creator, alice);
        assertEq(record.configHash, HASH);
        assertEq(record.version, 1);
        assertEq(record.parent, bytes32(0));
        assertEq(record.registeredAt, 1_700_000_000);
        assertEq(uint8(record.kind), uint8(QForkRegistry.Kind.Configuration));
        assertEq(record.metadataURI, URI);
    }

    function test_register_emitsRegistered() public {
        bytes32 id = registry.recordId(alice, HASH);
        vm.expectEmit(true, true, true, true, address(registry));
        emit Registered(id, alice, HASH, QForkRegistry.Kind.BaseContracts, 1, bytes32(0), URI);
        vm.prank(alice);
        registry.register(HASH, QForkRegistry.Kind.BaseContracts, URI);
    }

    function test_register_revertsOnZeroHash() public {
        vm.expectRevert(QForkRegistry.ZeroConfigHash.selector);
        vm.prank(alice);
        registry.register(bytes32(0), QForkRegistry.Kind.Configuration, URI);
    }

    function test_register_revertsOnDuplicate() public {
        bytes32 id = _register(alice, HASH);
        vm.expectRevert(abi.encodeWithSelector(QForkRegistry.AlreadyRegistered.selector, id));
        _register(alice, HASH);
    }

    function test_register_sameHashForDifferentCreators() public {
        bytes32 first = _register(alice, HASH);
        bytes32 second = _register(bob, HASH);
        assertTrue(first != second);
        assertEq(registry.get(second).creator, bob);
    }

    function test_register_revertsOnLongURI() public {
        uint256 length = registry.MAX_URI_BYTES() + 1;
        string memory long = string(new bytes(length));
        vm.expectRevert(abi.encodeWithSelector(QForkRegistry.URITooLong.selector, length));
        vm.prank(alice);
        registry.register(HASH, QForkRegistry.Kind.Configuration, long);
    }

    function test_register_acceptsMaxLengthURI() public {
        string memory edge = string(new bytes(registry.MAX_URI_BYTES()));
        vm.prank(alice);
        bytes32 id = registry.register(HASH, QForkRegistry.Kind.Configuration, edge);
        assertEq(bytes(registry.get(id).metadataURI).length, registry.MAX_URI_BYTES());
    }

    function test_register_revertsOnInvalidKind() public {
        bytes memory call = abi.encodeWithSignature("register(bytes32,uint8,string)", HASH, uint8(4), URI);
        vm.prank(alice);
        (bool ok,) = address(registry).call(call);
        assertFalse(ok);
        assertFalse(registry.exists(registry.recordId(alice, HASH)));
    }

    /* ---------- versions ---------- */

    function test_registerVersion_linksToParent() public {
        bytes32 parent = _register(alice, HASH);
        bytes32 next = keccak256("v2");
        vm.expectEmit(true, true, true, true, address(registry));
        emit Registered(registry.recordId(alice, next), alice, next, QForkRegistry.Kind.DevEnvironment, 2, parent, URI);
        vm.prank(alice);
        bytes32 child = registry.registerVersion(parent, next, QForkRegistry.Kind.DevEnvironment, URI);
        QForkRegistry.Record memory record = registry.get(child);
        assertEq(record.version, 2);
        assertEq(record.parent, parent);
    }

    function test_registerVersion_onlyCreator() public {
        bytes32 parent = _register(alice, HASH);
        vm.expectRevert(abi.encodeWithSelector(QForkRegistry.NotCreator.selector, parent, bob));
        vm.prank(bob);
        registry.registerVersion(parent, keccak256("v2"), QForkRegistry.Kind.Configuration, URI);
    }

    function test_registerVersion_revertsOnUnknownParent() public {
        bytes32 missing = keccak256("missing");
        vm.expectRevert(abi.encodeWithSelector(QForkRegistry.UnknownRecord.selector, missing));
        vm.prank(alice);
        registry.registerVersion(missing, HASH, QForkRegistry.Kind.Configuration, URI);
    }

    function test_registerVersion_cannotReuseOwnHash() public {
        bytes32 parent = _register(alice, HASH);
        vm.expectRevert(abi.encodeWithSelector(QForkRegistry.AlreadyRegistered.selector, parent));
        vm.prank(alice);
        registry.registerVersion(parent, HASH, QForkRegistry.Kind.Configuration, URI);
    }

    /* ---------- metadata ---------- */

    function test_updateMetadata_byCreator() public {
        bytes32 id = _register(alice, HASH);
        vm.expectEmit(true, false, false, true, address(registry));
        emit MetadataUpdated(id, "ipfs://next");
        vm.prank(alice);
        registry.updateMetadata(id, "ipfs://next");
        assertEq(registry.get(id).metadataURI, "ipfs://next");
        assertEq(registry.get(id).configHash, HASH);
    }

    function test_updateMetadata_onlyCreator() public {
        bytes32 id = _register(alice, HASH);
        vm.expectRevert(abi.encodeWithSelector(QForkRegistry.NotCreator.selector, id, bob));
        vm.prank(bob);
        registry.updateMetadata(id, "ipfs://hijack");
        assertEq(registry.get(id).metadataURI, URI);
    }

    function test_updateMetadata_revertsOnUnknown() public {
        bytes32 missing = keccak256("missing");
        vm.expectRevert(abi.encodeWithSelector(QForkRegistry.UnknownRecord.selector, missing));
        registry.updateMetadata(missing, URI);
    }

    function test_updateMetadata_revertsOnLongURI() public {
        bytes32 id = _register(alice, HASH);
        uint256 length = registry.MAX_URI_BYTES() + 1;
        string memory long = string(new bytes(length));
        vm.expectRevert(abi.encodeWithSelector(QForkRegistry.URITooLong.selector, length));
        vm.prank(alice);
        registry.updateMetadata(id, long);
    }

    /* ---------- reads and value ---------- */

    function test_get_revertsOnUnknown() public {
        bytes32 missing = keccak256("missing");
        vm.expectRevert(abi.encodeWithSelector(QForkRegistry.UnknownRecord.selector, missing));
        registry.get(missing);
    }

    function test_rejectsEther() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(registry).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(registry).balance, 0);
    }

    /* ---------- fuzz ---------- */

    function testFuzz_register(address creator, bytes32 hash, uint8 rawKind, string calldata uri) public {
        vm.assume(creator != address(0) && hash != bytes32(0) && bytes(uri).length <= 512);
        QForkRegistry.Kind kind = QForkRegistry.Kind(bound(rawKind, 0, 3));
        vm.prank(creator);
        bytes32 id = registry.register(hash, kind, uri);
        QForkRegistry.Record memory record = registry.get(id);
        assertEq(id, keccak256(abi.encode(creator, hash)));
        assertEq(record.creator, creator);
        assertEq(record.configHash, hash);
        assertEq(uint8(record.kind), uint8(kind));
        assertEq(record.metadataURI, uri);
    }

    function testFuzz_onlyCreatorCanMutate(address creator, address other, bytes32 hash) public {
        vm.assume(creator != address(0) && other != creator && hash != bytes32(0));
        vm.prank(creator);
        bytes32 id = registry.register(hash, QForkRegistry.Kind.Configuration, URI);
        vm.startPrank(other);
        vm.expectRevert(abi.encodeWithSelector(QForkRegistry.NotCreator.selector, id, other));
        registry.updateMetadata(id, "x");
        vm.expectRevert(abi.encodeWithSelector(QForkRegistry.NotCreator.selector, id, other));
        registry.registerVersion(id, keccak256(abi.encode(hash)), QForkRegistry.Kind.Configuration, URI);
        vm.stopPrank();
    }

    function testFuzz_versionChain(uint8 depth) public {
        depth = uint8(bound(depth, 1, 20));
        bytes32 id = _register(alice, HASH);
        for (uint8 i = 1; i <= depth; i++) {
            vm.prank(alice);
            id = registry.registerVersion(id, keccak256(abi.encode(i)), QForkRegistry.Kind.Configuration, URI);
        }
        assertEq(registry.get(id).version, uint32(depth) + 1);
    }
}
