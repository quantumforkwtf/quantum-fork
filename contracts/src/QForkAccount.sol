// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title QForkAccount
/// @notice A smart account on Base for a person, an organization or a fleet of AI agents.
///         - Owners act together: every owner action is a proposal that needs `threshold` approvals.
///         - Owners grant spenders (agents or team members) bounded allowances per asset: a cap per
///           transfer, a cap per rolling period, an expiry and an optional recipient allow-list.
///         - Owners can scope a spender to specific contract functions, which never move tokens.
///         - The account records a commitment to its post-quantum key set, so keys can rotate
///           without moving the assets.
/// @dev Every authorization here is a Base transaction signature (secp256k1, via msg.sender).
///      Nothing on-chain verifies a post-quantum signature. No owner-less admin, no upgrade path.
contract QForkAccount {
    struct Proposal {
        address to;
        uint64 createdAt;
        bool executed;
        bool cancelled;
        uint256 value;
        bytes data;
    }

    /// @notice A spender's limits for one asset. `asset` 0x0 is ETH. All-zero means no allowance.
    struct Allowance {
        uint128 perTransfer;
        uint128 perPeriod;
        uint32 period;
        uint64 validUntil;
        bool recipientsRestricted;
    }

    struct Window {
        uint64 start;
        uint128 spent;
    }

    struct Scope {
        address target;
        bytes4 selector;
    }

    uint256 public constant MAX_OWNERS = 16;
    uint256 public constant MAX_SPENDERS = 64;
    uint256 public constant MAX_PER_SPENDER = 32;

    address[] private _owners;
    /// @dev A fresh id each time an address becomes an owner; 0 when it is not one. Approvals are
    ///      stored against the id, so an approval never survives its owner being removed and re-added.
    mapping(address owner => uint64 id) private _ownerId;
    uint64 private _ownerNonce;
    uint8 public threshold;

    Proposal[] private _proposals;
    mapping(uint256 id => mapping(address owner => uint64 ownerId)) private _approvedBy;

    address[] private _spenders;
    mapping(address spender => bool) private _isSpender;
    mapping(address spender => address[]) private _assetsOf;
    mapping(address spender => address[]) private _recipientsOf;
    mapping(address spender => Scope[]) private _scopesOf;
    mapping(bytes32 entry => bool) private _listed;
    mapping(address spender => bool) public frozen;
    mapping(address spender => mapping(address asset => Allowance)) private _allowance;
    mapping(address spender => mapping(address asset => Window)) private _window;
    mapping(address spender => mapping(address recipient => bool)) public recipientAllowed;
    mapping(address spender => mapping(address target => mapping(bytes4 selector => uint64 validUntil))) public scope;

    bytes32 public keyset;
    uint32 public keysetVersion;

    event Received(address indexed from, uint256 amount);
    event Proposed(uint256 indexed id, address indexed proposer, address indexed to, uint256 value, bytes data);
    event Approved(uint256 indexed id, address indexed owner);
    event ApprovalRevoked(uint256 indexed id, address indexed owner);
    event Executed(uint256 indexed id, address indexed executor);
    event Cancelled(uint256 indexed id);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ThresholdChanged(uint8 threshold);
    event AllowanceSet(address indexed spender, address indexed asset, Allowance allowance);
    event RecipientSet(address indexed spender, address indexed recipient, bool allowed);
    event ScopeSet(address indexed spender, address indexed target, bytes4 indexed selector, uint64 validUntil);
    event SpenderFrozen(address indexed spender, address indexed by);
    event SpenderUnfrozen(address indexed spender);
    event Spent(address indexed spender, address indexed asset, address indexed to, uint256 amount, uint256 spentInPeriod);
    event ScopedCall(address indexed spender, address indexed target, bytes4 indexed selector);
    event KeysetRotated(uint32 indexed version, bytes32 commitment);

    error NotOwner(address caller);
    error NotSelf();
    error BadOwners();
    error BadThreshold(uint256 threshold, uint256 owners);
    error UnknownProposal(uint256 id);
    error ProposalClosed(uint256 id);
    error AlreadyApproved(uint256 id);
    error NotApproved(uint256 id);
    error NotEnoughApprovals(uint256 have, uint256 need);
    error ExecutionFailed(bytes reason);
    error BadAllowance();
    error TooManySpenders();
    error TooManyEntries();
    error Frozen(address spender);
    error NoAllowance(address spender, address asset);
    error Expired(uint64 validUntil);
    error OverTransferLimit(uint256 amount, uint256 limit);
    error OverPeriodLimit(uint256 wouldSpend, uint256 limit);
    error RecipientNotAllowed(address recipient);
    error BadRecipient();
    error NotInScope(address target, bytes4 selector);
    error TokenMovementNeedsSpend(bytes4 selector);
    error TransferFailed();

    modifier onlyOwner() {
        if (_ownerId[msg.sender] == 0) revert NotOwner(msg.sender);
        _;
    }

    /// @dev Owner changes, limits and rotations happen only through an executed proposal.
    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    constructor(address[] memory owners_, uint8 threshold_, bytes32 keyset_) {
        if (owners_.length == 0 || owners_.length > MAX_OWNERS) revert BadOwners();
        for (uint256 i; i < owners_.length; ++i) {
            _addOwner(owners_[i]);
        }
        _setThreshold(threshold_);
        if (keyset_ != bytes32(0)) _rotateKeyset(keyset_);
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    /* ---------- proposals ---------- */

    /// @notice Proposes an action, approves it as the proposer, and runs it if that is enough.
    function submit(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256 id, bool executed) {
        id = _proposals.length;
        _proposals.push(Proposal({to: to, createdAt: uint64(block.timestamp), executed: false, cancelled: false, value: value, data: data}));
        emit Proposed(id, msg.sender, to, value, data);
        _approve(id);
        if (approvals(id) >= threshold) {
            _execute(id);
            executed = true;
        }
    }

    function approve(uint256 id) external onlyOwner {
        _open(id);
        _approve(id);
    }

    function revokeApproval(uint256 id) external onlyOwner {
        _open(id);
        if (_approvedBy[id][msg.sender] != _ownerId[msg.sender]) revert NotApproved(id);
        delete _approvedBy[id][msg.sender];
        emit ApprovalRevoked(id, msg.sender);
    }

    function execute(uint256 id) external onlyOwner {
        _open(id);
        uint256 have = approvals(id);
        if (have < threshold) revert NotEnoughApprovals(have, threshold);
        _execute(id);
    }

    /// @notice Runs several owner actions as one proposal, all or nothing. Each call is made by
    ///         the account to itself, so only account functions can be reached this way.
    function batch(bytes[] calldata calls) external onlySelf {
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory ret) = address(this).call(calls[i]);
            if (!ok) revert ExecutionFailed(ret);
        }
    }

    /// @notice Withdraws a pending proposal. Cancelling is itself an owner action.
    function cancel(uint256 id) external onlySelf {
        _open(id);
        _proposals[id].cancelled = true;
        emit Cancelled(id);
    }

    /// @notice Approvals from current owners only. Approvals given before an owner was (re)added do not count.
    function approvals(uint256 id) public view returns (uint256 count) {
        for (uint256 i; i < _owners.length; ++i) {
            if (_approvedBy[id][_owners[i]] == _ownerId[_owners[i]]) ++count;
        }
    }

    function hasApproved(uint256 id, address owner) external view returns (bool) {
        uint64 ownerId = _ownerId[owner];
        return ownerId != 0 && _approvedBy[id][owner] == ownerId;
    }

    function proposal(uint256 id) external view returns (Proposal memory) {
        if (id >= _proposals.length) revert UnknownProposal(id);
        return _proposals[id];
    }

    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    /* ---------- owners ---------- */

    function owners() external view returns (address[] memory) {
        return _owners;
    }

    function isOwner(address account) external view returns (bool) {
        return _ownerId[account] != 0;
    }

    function addOwner(address owner, uint8 newThreshold) external onlySelf {
        if (_owners.length == MAX_OWNERS) revert BadOwners();
        _addOwner(owner);
        _setThreshold(newThreshold);
    }

    function removeOwner(address owner, uint8 newThreshold) external onlySelf {
        if (_ownerId[owner] == 0 || _owners.length == 1) revert BadOwners();
        delete _ownerId[owner];
        for (uint256 i; i < _owners.length; ++i) {
            if (_owners[i] == owner) {
                _owners[i] = _owners[_owners.length - 1];
                _owners.pop();
                break;
            }
        }
        emit OwnerRemoved(owner);
        _setThreshold(newThreshold);
    }

    function setThreshold(uint8 newThreshold) external onlySelf {
        _setThreshold(newThreshold);
    }

    /* ---------- spenders ---------- */

    function spenders() external view returns (address[] memory) {
        return _spenders;
    }

    /// @notice Every asset, recipient and scope ever configured for a spender. Read the current
    ///         value of each with allowance(), recipientAllowed() and scope().
    function spenderInfo(address spender)
        external
        view
        returns (bool isFrozen, address[] memory assets, address[] memory recipients, Scope[] memory scopes)
    {
        return (frozen[spender], _assetsOf[spender], _recipientsOf[spender], _scopesOf[spender]);
    }

    function setAllowance(address spender, address asset, Allowance calldata limits) external onlySelf {
        bool clearing = limits.perTransfer == 0 && limits.perPeriod == 0 && limits.period == 0 && limits.validUntil == 0;
        if (!clearing) {
            if (limits.perTransfer == 0 || limits.perPeriod < limits.perTransfer || limits.period == 0) revert BadAllowance();
            if (limits.validUntil <= block.timestamp) revert BadAllowance();
            _track(spender);
            if (_list(keccak256(abi.encode(0, spender, asset)), _assetsOf[spender].length)) _assetsOf[spender].push(asset);
        }
        _allowance[spender][asset] = limits;
        if (clearing) delete _window[spender][asset];
        emit AllowanceSet(spender, asset, limits);
    }

    function setRecipient(address spender, address recipient, bool allowed) external onlySelf {
        _track(spender);
        if (_list(keccak256(abi.encode(1, spender, recipient)), _recipientsOf[spender].length)) _recipientsOf[spender].push(recipient);
        recipientAllowed[spender][recipient] = allowed;
        emit RecipientSet(spender, recipient, allowed);
    }

    /// @notice Lets a spender call `selector` on `target` until `validUntil` (0 removes it).
    function setScope(address spender, address target, bytes4 selector, uint64 validUntil) external onlySelf {
        if (target == address(this)) revert NotInScope(target, selector);
        if (_movesTokens(selector)) revert TokenMovementNeedsSpend(selector);
        _track(spender);
        if (_list(keccak256(abi.encode(2, spender, target, selector)), _scopesOf[spender].length)) {
            _scopesOf[spender].push(Scope({target: target, selector: selector}));
        }
        scope[spender][target][selector] = validUntil;
        emit ScopeSet(spender, target, selector, validUntil);
    }

    /// @notice Any single owner can stop a spender at once. Unfreezing needs the threshold.
    function freeze(address spender) external onlyOwner {
        frozen[spender] = true;
        emit SpenderFrozen(spender, msg.sender);
    }

    function unfreeze(address spender) external onlySelf {
        frozen[spender] = false;
        emit SpenderUnfrozen(spender);
    }

    function allowance(address spender, address asset) external view returns (Allowance memory limits, uint256 spentInPeriod, uint256 periodEndsAt) {
        limits = _allowance[spender][asset];
        Window memory w = _window[spender][asset];
        if (limits.period != 0 && block.timestamp < uint256(w.start) + limits.period) {
            spentInPeriod = w.spent;
            periodEndsAt = uint256(w.start) + limits.period;
        }
    }

    /// @notice Sends `amount` of `asset` (0x0 for ETH) within the caller's allowance.
    function spend(address asset, address to, uint256 amount) external {
        if (frozen[msg.sender]) revert Frozen(msg.sender);
        Allowance memory limits = _allowance[msg.sender][asset];
        if (limits.perTransfer == 0) revert NoAllowance(msg.sender, asset);
        if (block.timestamp > limits.validUntil) revert Expired(limits.validUntil);
        if (to == address(0) || to == address(this)) revert BadRecipient();
        if (amount > limits.perTransfer) revert OverTransferLimit(amount, limits.perTransfer);
        if (limits.recipientsRestricted && !recipientAllowed[msg.sender][to]) revert RecipientNotAllowed(to);

        Window storage w = _window[msg.sender][asset];
        if (block.timestamp >= uint256(w.start) + limits.period) {
            w.start = uint64(block.timestamp);
            w.spent = 0;
        }
        uint256 wouldSpend = uint256(w.spent) + amount;
        if (wouldSpend > limits.perPeriod) revert OverPeriodLimit(wouldSpend, limits.perPeriod);
        // casting to 'uint128' is safe because wouldSpend <= limits.perPeriod, a uint128
        // forge-lint: disable-next-line(unsafe-typecast)
        w.spent = uint128(wouldSpend);

        emit Spent(msg.sender, asset, to, amount, wouldSpend);
        if (asset == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            if (asset.code.length == 0) revert TransferFailed();
            (bool ok, bytes memory ret) = asset.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
            if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
        }
    }

    /// @notice Calls a function the owners scoped for the caller. Never sends ETH.
    /// @dev The spender chooses every argument, and the call runs as the account. Owners should
    ///      scope only functions that cannot move the account's assets to an address the spender picks.
    function scopedCall(address target, bytes calldata data) external returns (bytes memory) {
        if (frozen[msg.sender]) revert Frozen(msg.sender);
        if (data.length < 4) revert NotInScope(target, bytes4(0));
        bytes4 selector = bytes4(data[:4]);
        uint64 validUntil = scope[msg.sender][target][selector];
        if (validUntil == 0 || block.timestamp > validUntil) revert NotInScope(target, selector);
        emit ScopedCall(msg.sender, target, selector);
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) revert ExecutionFailed(ret);
        return ret;
    }

    /* ---------- post-quantum key set ---------- */

    /// @notice Records a new commitment to the account's post-quantum key set.
    function rotateKeyset(bytes32 commitment) external onlySelf {
        _rotateKeyset(commitment);
    }

    /* ---------- internals ---------- */

    function _open(uint256 id) private view {
        if (id >= _proposals.length) revert UnknownProposal(id);
        Proposal storage p = _proposals[id];
        if (p.executed || p.cancelled) revert ProposalClosed(id);
    }

    function _addOwner(address owner) private {
        if (owner == address(0) || owner == address(this) || _ownerId[owner] != 0) revert BadOwners();
        _ownerId[owner] = ++_ownerNonce;
        _owners.push(owner);
        emit OwnerAdded(owner);
    }

    function _approve(uint256 id) private {
        uint64 ownerId = _ownerId[msg.sender];
        if (_approvedBy[id][msg.sender] == ownerId) revert AlreadyApproved(id);
        _approvedBy[id][msg.sender] = ownerId;
        emit Approved(id, msg.sender);
    }

    function _execute(uint256 id) private {
        Proposal storage p = _proposals[id];
        p.executed = true;
        (bool ok, bytes memory ret) = p.to.call{value: p.value}(p.data);
        if (!ok) revert ExecutionFailed(ret);
        emit Executed(id, msg.sender);
    }

    function _setThreshold(uint8 newThreshold) private {
        if (newThreshold == 0 || newThreshold > _owners.length) revert BadThreshold(newThreshold, _owners.length);
        threshold = newThreshold;
        emit ThresholdChanged(newThreshold);
    }

    function _rotateKeyset(bytes32 commitment) private {
        keyset = commitment;
        keysetVersion += 1;
        emit KeysetRotated(keysetVersion, commitment);
    }

    /// @dev True the first time an entry is seen; reverts once a spender's list is full.
    function _list(bytes32 entry, uint256 length) private returns (bool) {
        if (_listed[entry]) return false;
        if (length == MAX_PER_SPENDER) revert TooManyEntries();
        _listed[entry] = true;
        return true;
    }

    function _track(address spender) private {
        if (spender == address(0) || spender == address(this)) revert BadAllowance();
        if (_isSpender[spender]) return;
        if (_spenders.length == MAX_SPENDERS) revert TooManySpenders();
        _isSpender[spender] = true;
        _spenders.push(spender);
    }

    /// @dev ERC-20 transfer, approve, transferFrom, increaseAllowance; EIP-2612 and DAI permit;
    ///      ERC-721/1155 setApprovalForAll and safe transfers; ERC-677 transferAndCall; ERC-777 send,
    ///      operatorSend and authorizeOperator; Permit2 approve and both permit forms.
    function _movesTokens(bytes4 selector) private pure returns (bool) {
        return selector == 0xa9059cbb || selector == 0x095ea7b3 || selector == 0x23b872dd || selector == 0x39509351
            || selector == 0xd505accf || selector == 0x8fcbaf0c || selector == 0xa22cb465 || selector == 0x42842e0e
            || selector == 0xb88d4fde || selector == 0xf242432a || selector == 0x2eb2c2d6 || selector == 0x4000aea0
            || selector == 0x9bd9bbc6 || selector == 0x62ad1b83 || selector == 0x959b8c3f || selector == 0x87517c45
            || selector == 0x2b67b570 || selector == 0x2a2d80d1;
    }

    /* ---------- receiving NFTs ---------- */

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x150b7a02;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xf23a6e61;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return 0xbc197c81;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x4e2312e0 || interfaceId == 0x150b7a02;
    }
}
