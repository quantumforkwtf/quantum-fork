// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BenchCompute, BenchERC20, BenchERC721, BenchStorage} from "../src/bench/Workloads.sol";

contract WorkloadsTest is Test {
    function testErc20TransferMovesBalance() public {
        BenchERC20 token = new BenchERC20();
        assertTrue(token.transfer(address(2), 5));
        assertEq(token.balanceOf(address(2)), 5);
        assertEq(token.balanceOf(address(this)), 1_000_000 ether - 5);
    }

    function testErc20TransferRevertsWhenBalanceIsShort() public {
        BenchERC20 token = new BenchERC20();
        vm.expectRevert();
        token.transfer(address(2), 1_000_000 ether + 1);
    }

    function testErc721TransferChangesOwner() public {
        BenchERC721 nft = new BenchERC721();
        nft.transferFrom(address(this), address(2), 1);
        assertEq(nft.ownerOf(1), address(2));
    }

    function testStorageAndComputeRun() public {
        BenchStorage storage_ = new BenchStorage();
        storage_.write(4);
        BenchCompute compute = new BenchCompute();
        bytes32 hash = compute.hashLoop(8);
        assertTrue(hash != bytes32(0));
    }
}
