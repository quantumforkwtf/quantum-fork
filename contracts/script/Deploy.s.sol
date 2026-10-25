// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {QForkRegistry} from "../src/QForkRegistry.sol";

/// @notice Deploys QForkRegistry. The signer comes from the CLI (--account <keystore> or --ledger);
///         no key is read from this script or from the repository.
/// forge script script/Deploy.s.sol --rpc-url base_sepolia --account <name> --broadcast --verify
contract Deploy is Script {
    function run() external returns (QForkRegistry registry) {
        require(
            block.chainid == 84532 || block.chainid == 31337 || vm.envOr("ALLOW_MAINNET", false),
            "Base mainnet needs ALLOW_MAINNET=true"
        );
        vm.startBroadcast();
        registry = new QForkRegistry();
        vm.stopBroadcast();
        console.log("QForkRegistry", address(registry), block.chainid);
    }
}
