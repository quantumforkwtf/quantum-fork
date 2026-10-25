// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title QForkRegistry
/// @notice Public index of Quantum Fork configurations. A record binds a creator to the
///         content hash of an offchain Chain DNA document. The document itself is not stored.
/// @dev No owner, no upgrade path, no fees, and no way to receive ETH. Records cannot be deleted.
contract QForkRegistry {
    /// @notice What the configuration describes. A record is an index entry, never a running chain.
    enum Kind {
        Configuration,
        BaseContracts,
        DevEnvironment,
        DedicatedChain
    }

    struct Record {
        address creator;
        uint64 registeredAt;
        uint32 version;
        Kind kind;
        bytes32 configHash;
        bytes32 parent;
        string metadataURI;
    }

    uint256 public constant MAX_URI_BYTES = 512;

    mapping(bytes32 id => Record) private _records;

    event Registered(
        bytes32 indexed id,
        address indexed creator,
        bytes32 indexed configHash,
        Kind kind,
        uint32 version,
        bytes32 parent,
        string metadataURI
    );
    event MetadataUpdated(bytes32 indexed id, string metadataURI);

    error ZeroConfigHash();
    error AlreadyRegistered(bytes32 id);
    error UnknownRecord(bytes32 id);
    error NotCreator(bytes32 id, address caller);
    error URITooLong(uint256 length);

    /// @notice A creator can register a given configuration hash once.
    function recordId(address creator, bytes32 configHash) public pure returns (bytes32) {
        return keccak256(abi.encode(creator, configHash));
    }

    /// @notice Registers version 1 of a configuration for msg.sender.
    function register(bytes32 configHash, Kind kind, string calldata metadataURI) external returns (bytes32) {
        return _register(configHash, kind, metadataURI, bytes32(0), 1);
    }

    /// @notice Registers a new version that descends from one of msg.sender's records.
    function registerVersion(bytes32 parent, bytes32 configHash, Kind kind, string calldata metadataURI)
        external
        returns (bytes32)
    {
        Record storage previous = _records[parent];
        if (previous.creator == address(0)) revert UnknownRecord(parent);
        if (previous.creator != msg.sender) revert NotCreator(parent, msg.sender);
        return _register(configHash, kind, metadataURI, parent, previous.version + 1);
    }

    /// @notice Points a record at a new metadata document. The configuration hash never changes.
    function updateMetadata(bytes32 id, string calldata metadataURI) external {
        Record storage record = _records[id];
        if (record.creator == address(0)) revert UnknownRecord(id);
        if (record.creator != msg.sender) revert NotCreator(id, msg.sender);
        if (bytes(metadataURI).length > MAX_URI_BYTES) revert URITooLong(bytes(metadataURI).length);
        record.metadataURI = metadataURI;
        emit MetadataUpdated(id, metadataURI);
    }

    function get(bytes32 id) external view returns (Record memory) {
        Record memory record = _records[id];
        if (record.creator == address(0)) revert UnknownRecord(id);
        return record;
    }

    function exists(bytes32 id) external view returns (bool) {
        return _records[id].creator != address(0);
    }

    function _register(bytes32 configHash, Kind kind, string calldata metadataURI, bytes32 parent, uint32 version)
        private
        returns (bytes32 id)
    {
        if (configHash == bytes32(0)) revert ZeroConfigHash();
        if (bytes(metadataURI).length > MAX_URI_BYTES) revert URITooLong(bytes(metadataURI).length);
        id = recordId(msg.sender, configHash);
        if (_records[id].creator != address(0)) revert AlreadyRegistered(id);
        _records[id] = Record({
            creator: msg.sender,
            registeredAt: uint64(block.timestamp),
            version: version,
            kind: kind,
            configHash: configHash,
            parent: parent,
            metadataURI: metadataURI
        });
        emit Registered(id, msg.sender, configHash, kind, version, parent, metadataURI);
    }
}
