// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal token used only as a Fork Wars workload. Not $QFORK and not deployed anywhere but a local Anvil.
contract BenchERC20 {
    mapping(address => uint256) public balanceOf;

    constructor() {
        balanceOf[msg.sender] = 1_000_000 ether;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @notice One-token ERC-721 style transfer. The benchmark mints token 1 to the deployer.
contract BenchERC721 {
    mapping(uint256 => address) public ownerOf;

    constructor() {
        ownerOf[1] = msg.sender;
    }

    function transferFrom(address from, address to, uint256 id) external {
        require(ownerOf[id] == from, "not owner");
        ownerOf[id] = to;
    }
}

/// @notice Writes `count` storage slots. The benchmark uses a fixed count.
contract BenchStorage {
    function write(uint256 count) external {
        for (uint256 i = 0; i < count; i++) {
            assembly {
                sstore(add(1, i), timestamp())
            }
        }
    }
}

/// @notice Repeated keccak256. The benchmark uses a fixed round count.
contract BenchCompute {
    function hashLoop(uint256 rounds) external pure returns (bytes32 h) {
        h = bytes32(rounds);
        for (uint256 i = 0; i < rounds; i++) {
            h = keccak256(abi.encode(h, i));
        }
    }
}
