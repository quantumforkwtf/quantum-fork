// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {QForkAccountFactory} from "../src/QForkAccountFactory.sol";

/// @notice Deploys QForkAccountFactory through the deterministic CREATE2 deployer, so it lands at
///         the same address on every chain. The signer comes from the CLI (--account <keystore> or
///         --ledger); no key is read by this script.
/// Base Sepolia: forge script script/DeployAccounts.s.sol --rpc-url base_sepolia --account <name> --broadcast
/// Base:         ALLOW_MAINNET=true forge script script/DeployAccounts.s.sol --rpc-url base --account <name> --broadcast
contract DeployAccounts is Script {
    bytes32 public constant SALT = keccak256("quantumfork.account-factory.v1");

    function run() external returns (QForkAccountFactory factory) {
        require(
            block.chainid == 84532 || block.chainid == 31337 || vm.envOr("ALLOW_MAINNET", false),
            "Base mainnet needs ALLOW_MAINNET=true"
        );
        address expected = vm.computeCreate2Address(SALT, keccak256(type(QForkAccountFactory).creationCode));
        if (expected.code.length != 0) {
            console.log("QForkAccountFactory already deployed", expected, block.chainid);
            return QForkAccountFactory(expected);
        }
        vm.startBroadcast();
        factory = new QForkAccountFactory{salt: SALT}();
        vm.stopBroadcast();
        require(address(factory) == expected, "unexpected factory address");
        console.log("QForkAccountFactory", address(factory), block.chainid);
    }
}
