// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {QForkAccount} from "./QForkAccount.sol";

/// @title QForkAccountFactory
/// @notice Deploys QForkAccounts at addresses that can be known in advance, and indexes them by
///         their initial owners so a wallet can find its accounts without scanning logs.
/// @dev No owner, no fees. The owner index lists initial owners only; later owner changes live on the
///      account. Anyone can name anyone as an owner, so that index can be filled by others; the
///      creator index only grows when the creator itself creates an account.
contract QForkAccountFactory {
    uint256 public constant MAX_INDEXED = 64;

    mapping(address account => bool) public isAccount;
    mapping(address owner => address[]) private _accountsOf;
    mapping(address creator => address[]) private _createdBy;

    event AccountCreated(address indexed account, address indexed creator, address[] owners, uint8 threshold, bytes32 keyset);

    function create(address[] calldata owners, uint8 threshold, bytes32 keyset, bytes32 salt) external returns (QForkAccount account) {
        account = new QForkAccount{salt: _salt(msg.sender, salt)}(owners, threshold, keyset);
        isAccount[address(account)] = true;
        _createdBy[msg.sender].push(address(account));
        for (uint256 i; i < owners.length; ++i) {
            if (_accountsOf[owners[i]].length < MAX_INDEXED) _accountsOf[owners[i]].push(address(account));
        }
        emit AccountCreated(address(account), msg.sender, owners, threshold, keyset);
    }

    function createdBy(address creator) external view returns (address[] memory) {
        return _createdBy[creator];
    }

    function predict(address creator, address[] calldata owners, uint8 threshold, bytes32 keyset, bytes32 salt) external view returns (address) {
        bytes32 initCodeHash = keccak256(abi.encodePacked(type(QForkAccount).creationCode, abi.encode(owners, threshold, keyset)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(creator, salt), initCodeHash)))));
    }

    function accountsOf(address owner) external view returns (address[] memory) {
        return _accountsOf[owner];
    }

    function _salt(address creator, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encode(creator, salt));
    }
}
