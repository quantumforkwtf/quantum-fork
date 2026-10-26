// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {QForkAccount} from "../src/QForkAccount.sol";
import {QForkAccountFactory} from "../src/QForkAccountFactory.sol";

contract TestToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

contract Counter {
    uint256 public count;
    address public lastCaller;

    function bump(uint256 by) external {
        count += by;
        lastCaller = msg.sender;
    }

    function boom() external pure {
        revert("boom");
    }
}

contract QForkAccountTest is Test {
    QForkAccountFactory internal factory;
    TestToken internal token;
    Counter internal counter;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal agent = makeAddr("agent");
    address internal shop = makeAddr("shop");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant KEYSET = keccak256("qfork/keyset/v1:example");
    uint64 internal constant DAY = 1 days;

    function setUp() public {
        vm.warp(1_800_000_000);
        factory = new QForkAccountFactory();
        token = new TestToken();
        counter = new Counter();
    }

    /* ---------- helpers ---------- */

    function _owners(address a) internal pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = a;
    }

    function _owners(address a, address b, address c) internal pure returns (address[] memory list) {
        list = new address[](3);
        list[0] = a;
        list[1] = b;
        list[2] = c;
    }

    function _solo() internal returns (QForkAccount account) {
        account = factory.create(_owners(alice), 1, KEYSET, bytes32(0));
        vm.deal(address(account), 100 ether);
        token.mint(address(account), 1_000_000e18);
    }

    function _trio() internal returns (QForkAccount account) {
        account = factory.create(_owners(alice, bob, carol), 2, bytes32(0), bytes32(0));
        vm.deal(address(account), 100 ether);
    }

    /// Runs an owner action on a 1-of-1 account.
    function _self(QForkAccount account, bytes memory data) internal {
        vm.prank(alice);
        (, bool executed) = account.submit(address(account), 0, data);
        assertTrue(executed);
    }

    function _limits(uint128 perTransfer, uint128 perPeriod, uint32 period, bool restricted)
        internal
        view
        returns (QForkAccount.Allowance memory)
    {
        return QForkAccount.Allowance({
            perTransfer: perTransfer,
            perPeriod: perPeriod,
            period: period,
            validUntil: uint64(block.timestamp + 30 days),
            recipientsRestricted: restricted
        });
    }

    function _grantEth(QForkAccount account, uint128 perTransfer, uint128 perPeriod) internal {
        _self(account, abi.encodeCall(QForkAccount.setAllowance, (agent, address(0), _limits(perTransfer, perPeriod, uint32(DAY), false))));
    }

    /* ---------- construction ---------- */

    function test_constructor_setsOwnersThresholdAndKeyset() public {
        QForkAccount account = factory.create(_owners(alice, bob, carol), 2, KEYSET, bytes32(0));
        assertEq(account.owners().length, 3);
        assertTrue(account.isOwner(bob));
        assertFalse(account.isOwner(stranger));
        assertEq(account.threshold(), 2);
        assertEq(account.keyset(), KEYSET);
        assertEq(account.keysetVersion(), 1);
    }

    function test_constructor_noKeysetLeavesVersionZero() public {
        QForkAccount account = factory.create(_owners(alice), 1, bytes32(0), bytes32(0));
        assertEq(account.keysetVersion(), 0);
    }

    function test_constructor_rejectsBadOwners() public {
        vm.expectRevert(QForkAccount.BadOwners.selector);
        new QForkAccount(new address[](0), 1, bytes32(0));

        vm.expectRevert(QForkAccount.BadOwners.selector);
        new QForkAccount(_owners(alice, bob, alice), 1, bytes32(0));

        vm.expectRevert(QForkAccount.BadOwners.selector);
        new QForkAccount(_owners(alice, address(0), bob), 1, bytes32(0));

        address[] memory many = new address[](17);
        for (uint256 i; i < many.length; ++i) many[i] = address(uint160(i + 1));
        vm.expectRevert(QForkAccount.BadOwners.selector);
        new QForkAccount(many, 1, bytes32(0));
    }

    function test_constructor_rejectsBadThreshold() public {
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.BadThreshold.selector, 0, 3));
        new QForkAccount(_owners(alice, bob, carol), 0, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.BadThreshold.selector, 4, 3));
        new QForkAccount(_owners(alice, bob, carol), 4, bytes32(0));
    }

    function test_receive_acceptsEth() public {
        QForkAccount account = _solo();
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(account).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(account).balance, 101 ether);
    }

    /* ---------- proposals ---------- */

    function test_submit_soloExecutesImmediately() public {
        QForkAccount account = _solo();
        vm.prank(alice);
        (uint256 id, bool executed) = account.submit(shop, 1 ether, "");
        assertTrue(executed);
        assertEq(shop.balance, 1 ether);
        assertTrue(account.proposal(id).executed);
    }

    function test_submit_onlyOwners() public {
        QForkAccount account = _solo();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.NotOwner.selector, stranger));
        account.submit(shop, 1 ether, "");
    }

    function test_threshold_needsTwoOfThree() public {
        QForkAccount account = _trio();
        vm.prank(alice);
        (uint256 id, bool executed) = account.submit(shop, 1 ether, "");
        assertFalse(executed);
        assertEq(account.approvals(id), 1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.NotEnoughApprovals.selector, 1, 2));
        account.execute(id);

        vm.prank(bob);
        account.approve(id);
        assertEq(account.approvals(id), 2);
        assertTrue(account.hasApproved(id, bob));

        vm.prank(carol);
        account.execute(id);
        assertEq(shop.balance, 1 ether);

        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.ProposalClosed.selector, id));
        account.approve(id);
    }

    function test_approve_twiceReverts() public {
        QForkAccount account = _trio();
        vm.prank(alice);
        (uint256 id,) = account.submit(shop, 1 ether, "");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.AlreadyApproved.selector, id));
        account.approve(id);
    }

    function test_approve_strangerReverts() public {
        QForkAccount account = _trio();
        vm.prank(alice);
        (uint256 id,) = account.submit(shop, 1 ether, "");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.NotOwner.selector, stranger));
        account.approve(id);
    }

    function test_approve_unknownProposalReverts() public {
        QForkAccount account = _trio();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.UnknownProposal.selector, 7));
        account.approve(7);
    }

    function test_revokeApproval_dropsCount() public {
        QForkAccount account = _trio();
        vm.prank(alice);
        (uint256 id,) = account.submit(shop, 1 ether, "");
        vm.prank(alice);
        account.revokeApproval(id);
        assertEq(account.approvals(id), 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.NotApproved.selector, id));
        account.revokeApproval(id);
    }

    function test_execute_failureRevertsAndStaysOpen() public {
        QForkAccount account = _trio();
        vm.prank(alice);
        (uint256 id,) = account.submit(address(counter), 0, abi.encodeCall(Counter.boom, ()));
        vm.prank(bob);
        account.approve(id);
        vm.prank(bob);
        vm.expectRevert();
        account.execute(id);
        assertFalse(account.proposal(id).executed);
    }

    function test_execute_callsContracts() public {
        QForkAccount account = _solo();
        vm.prank(alice);
        account.submit(address(counter), 0, abi.encodeCall(Counter.bump, (5)));
        assertEq(counter.count(), 5);
        assertEq(counter.lastCaller(), address(account));
    }

    function test_cancel_isAnOwnerActionAndCloses() public {
        QForkAccount account = _trio();
        vm.prank(alice);
        (uint256 id,) = account.submit(shop, 1 ether, "");

        vm.prank(alice);
        vm.expectRevert(QForkAccount.NotSelf.selector);
        account.cancel(id);

        vm.prank(bob);
        (uint256 cancelId,) = account.submit(address(account), 0, abi.encodeCall(QForkAccount.cancel, (id)));
        vm.prank(carol);
        account.approve(cancelId);
        vm.prank(carol);
        account.execute(cancelId);
        assertTrue(account.proposal(id).cancelled);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.ProposalClosed.selector, id));
        account.approve(id);
    }

    /* ---------- owners ---------- */

    function test_adminFunctions_onlyThroughProposals() public {
        QForkAccount account = _solo();
        vm.startPrank(alice);
        vm.expectRevert(QForkAccount.NotSelf.selector);
        account.addOwner(bob, 1);
        vm.expectRevert(QForkAccount.NotSelf.selector);
        account.removeOwner(alice, 1);
        vm.expectRevert(QForkAccount.NotSelf.selector);
        account.setThreshold(1);
        vm.expectRevert(QForkAccount.NotSelf.selector);
        account.setAllowance(agent, address(0), _limits(1, 1, 1, false));
        vm.expectRevert(QForkAccount.NotSelf.selector);
        account.setRecipient(agent, shop, true);
        vm.expectRevert(QForkAccount.NotSelf.selector);
        account.setScope(agent, address(counter), Counter.bump.selector, uint64(block.timestamp + 1));
        vm.expectRevert(QForkAccount.NotSelf.selector);
        account.unfreeze(agent);
        vm.expectRevert(QForkAccount.NotSelf.selector);
        account.rotateKeyset(KEYSET);
        vm.stopPrank();
    }

    function test_addOwner_andRaiseThreshold() public {
        QForkAccount account = _solo();
        _self(account, abi.encodeCall(QForkAccount.addOwner, (bob, 2)));
        assertTrue(account.isOwner(bob));
        assertEq(account.threshold(), 2);

        vm.prank(alice);
        (, bool executed) = account.submit(shop, 1 ether, "");
        assertFalse(executed);
    }

    function test_addOwner_rejectsDuplicateAndBadThreshold() public {
        QForkAccount account = _solo();
        vm.prank(alice);
        vm.expectRevert();
        account.submit(address(account), 0, abi.encodeCall(QForkAccount.addOwner, (alice, 1)));
        vm.prank(alice);
        vm.expectRevert();
        account.submit(address(account), 0, abi.encodeCall(QForkAccount.addOwner, (bob, 3)));
    }

    function test_removeOwner_cannotRemoveLast() public {
        QForkAccount account = _solo();
        vm.prank(alice);
        vm.expectRevert();
        account.submit(address(account), 0, abi.encodeCall(QForkAccount.removeOwner, (alice, 1)));
    }

    function test_removedOwnersApprovalStopsCounting() public {
        QForkAccount account = _trio();
        vm.prank(alice);
        (uint256 pay,) = account.submit(shop, 1 ether, "");
        assertEq(account.approvals(pay), 1);

        vm.prank(bob);
        (uint256 remove,) = account.submit(address(account), 0, abi.encodeCall(QForkAccount.removeOwner, (alice, 2)));
        vm.prank(carol);
        account.approve(remove);
        vm.prank(carol);
        account.execute(remove);

        assertFalse(account.isOwner(alice));
        assertEq(account.approvals(pay), 0);
        assertFalse(account.hasApproved(pay, alice));
    }

    function test_readdedOwnersOldApprovalDoesNotCount() public {
        QForkAccount account = _trio();
        vm.prank(alice);
        (uint256 pay,) = account.submit(shop, 1 ether, "");

        vm.roll(block.number + 1);
        vm.prank(bob);
        (uint256 remove,) = account.submit(address(account), 0, abi.encodeCall(QForkAccount.removeOwner, (alice, 2)));
        vm.prank(carol);
        account.approve(remove);
        vm.prank(carol);
        account.execute(remove);

        vm.roll(block.number + 1);
        vm.prank(bob);
        (uint256 readd,) = account.submit(address(account), 0, abi.encodeCall(QForkAccount.addOwner, (alice, 2)));
        vm.prank(carol);
        account.approve(readd);
        vm.prank(carol);
        account.execute(readd);

        assertTrue(account.isOwner(alice));
        assertEq(account.approvals(pay), 0);
        vm.prank(alice);
        account.approve(pay);
        assertEq(account.approvals(pay), 1);
    }

    function test_readdedInTheSameBlockOldApprovalDoesNotCount() public {
        QForkAccount account = _trio();
        vm.prank(alice);
        (uint256 pay,) = account.submit(shop, 1 ether, "");
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(QForkAccount.removeOwner, (alice, 2));
        calls[1] = abi.encodeCall(QForkAccount.addOwner, (alice, 2));
        vm.prank(bob);
        (uint256 cycle,) = account.submit(address(account), 0, abi.encodeCall(QForkAccount.batch, (calls)));
        vm.prank(carol);
        account.approve(cycle);
        vm.prank(carol);
        account.execute(cycle);

        assertTrue(account.isOwner(alice));
        assertFalse(account.hasApproved(pay, alice));
        assertEq(account.approvals(pay), 0);
        vm.prank(bob);
        account.approve(pay);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.NotEnoughApprovals.selector, 1, 2));
        account.execute(pay);
    }

    /* ---------- allowances ---------- */

    function test_spend_tokenWithoutCodeReverts() public {
        QForkAccount account = _solo();
        address ghost = address(0xdead01);
        _self(account, abi.encodeCall(QForkAccount.setAllowance, (agent, ghost, _limits(5, 10, uint32(DAY), false))));
        vm.prank(agent);
        vm.expectRevert(QForkAccount.TransferFailed.selector);
        account.spend(ghost, shop, 1);
    }

    function test_receivesNfts() public {
        QForkAccount account = _solo();
        assertEq(account.onERC721Received(address(0), address(0), 1, ""), bytes4(0x150b7a02));
        assertEq(account.onERC1155Received(address(0), address(0), 1, 1, ""), bytes4(0xf23a6e61));
        assertEq(account.onERC1155BatchReceived(address(0), address(0), new uint256[](0), new uint256[](0), ""), bytes4(0xbc197c81));
        assertTrue(account.supportsInterface(0x01ffc9a7));
        assertTrue(account.supportsInterface(0x4e2312e0));
        assertFalse(account.supportsInterface(0xffffffff));
    }

    function test_spend_eth_withinLimits() public {
        QForkAccount account = _solo();
        _grantEth(account, 1 ether, 3 ether);

        vm.prank(agent);
        account.spend(address(0), shop, 1 ether);
        assertEq(shop.balance, 1 ether);

        (, uint256 spent, uint256 endsAt) = account.allowance(agent, address(0));
        assertEq(spent, 1 ether);
        assertEq(endsAt, block.timestamp + DAY);
        assertEq(account.spenders().length, 1);
    }

    function test_spend_overTransferLimit() public {
        QForkAccount account = _solo();
        _grantEth(account, 1 ether, 3 ether);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.OverTransferLimit.selector, 1.5 ether, 1 ether));
        account.spend(address(0), shop, 1.5 ether);
    }

    function test_spend_overPeriodLimitThenResets() public {
        QForkAccount account = _solo();
        _grantEth(account, 1 ether, 2 ether);
        vm.startPrank(agent);
        account.spend(address(0), shop, 1 ether);
        account.spend(address(0), shop, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.OverPeriodLimit.selector, 2.5 ether, 2 ether));
        account.spend(address(0), shop, 0.5 ether);

        vm.warp(block.timestamp + DAY - 1);
        vm.expectRevert();
        account.spend(address(0), shop, 0.5 ether);

        vm.warp(block.timestamp + 1);
        account.spend(address(0), shop, 1 ether);
        vm.stopPrank();
        assertEq(shop.balance, 3 ether);
    }

    function test_spend_expired() public {
        QForkAccount account = _solo();
        _grantEth(account, 1 ether, 3 ether);
        vm.warp(block.timestamp + 31 days);
        vm.prank(agent);
        vm.expectRevert();
        account.spend(address(0), shop, 1 ether);
    }

    function test_spend_withoutAllowance() public {
        QForkAccount account = _solo();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.NoAllowance.selector, stranger, address(0)));
        account.spend(address(0), shop, 1);
    }

    function test_spend_badRecipients() public {
        QForkAccount account = _solo();
        _grantEth(account, 1 ether, 3 ether);
        vm.startPrank(agent);
        vm.expectRevert(QForkAccount.BadRecipient.selector);
        account.spend(address(0), address(0), 1);
        vm.expectRevert(QForkAccount.BadRecipient.selector);
        account.spend(address(0), address(account), 1);
        vm.stopPrank();
    }

    function test_spend_recipientAllowList() public {
        QForkAccount account = _solo();
        _self(account, abi.encodeCall(QForkAccount.setAllowance, (agent, address(0), _limits(1 ether, 3 ether, uint32(DAY), true))));

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.RecipientNotAllowed.selector, shop));
        account.spend(address(0), shop, 1 ether);

        _self(account, abi.encodeCall(QForkAccount.setRecipient, (agent, shop, true)));
        vm.prank(agent);
        account.spend(address(0), shop, 1 ether);
        assertEq(shop.balance, 1 ether);
    }

    function test_spend_erc20() public {
        QForkAccount account = _solo();
        _self(account, abi.encodeCall(QForkAccount.setAllowance, (agent, address(token), _limits(100e18, 500e18, uint32(DAY), false))));
        vm.prank(agent);
        account.spend(address(token), shop, 100e18);
        assertEq(token.balanceOf(shop), 100e18);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.NoAllowance.selector, agent, address(0)));
        account.spend(address(0), shop, 1);
    }

    function test_freeze_anyOwnerAtOnce_unfreezeNeedsThreshold() public {
        QForkAccount account = _trio();
        vm.prank(alice);
        (uint256 grant,) = account.submit(
            address(account), 0, abi.encodeCall(QForkAccount.setAllowance, (agent, address(0), _limits(1 ether, 3 ether, uint32(DAY), false)))
        );
        vm.prank(bob);
        account.approve(grant);
        vm.prank(bob);
        account.execute(grant);

        vm.prank(carol);
        account.freeze(agent);
        assertTrue(account.frozen(agent));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.Frozen.selector, agent));
        account.spend(address(0), shop, 1 ether);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.NotOwner.selector, stranger));
        account.freeze(agent);

        vm.prank(alice);
        (uint256 thaw,) = account.submit(address(account), 0, abi.encodeCall(QForkAccount.unfreeze, (agent)));
        assertTrue(account.frozen(agent));
        vm.prank(bob);
        account.approve(thaw);
        vm.prank(bob);
        account.execute(thaw);
        assertFalse(account.frozen(agent));

        vm.prank(agent);
        account.spend(address(0), shop, 1 ether);
    }

    function test_setAllowance_validates() public {
        QForkAccount account = _solo();
        QForkAccount.Allowance memory zeroPerTransfer = _limits(0, 1 ether, uint32(DAY), false);
        QForkAccount.Allowance memory periodBelowTransfer = _limits(2 ether, 1 ether, uint32(DAY), false);
        QForkAccount.Allowance memory zeroPeriod = _limits(1 ether, 1 ether, 0, false);
        QForkAccount.Allowance memory past = _limits(1 ether, 1 ether, uint32(DAY), false);
        past.validUntil = uint64(block.timestamp);

        QForkAccount.Allowance[4] memory bad = [zeroPerTransfer, periodBelowTransfer, zeroPeriod, past];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(alice);
            vm.expectRevert();
            account.submit(address(account), 0, abi.encodeCall(QForkAccount.setAllowance, (agent, address(0), bad[i])));
        }
        vm.prank(alice);
        vm.expectRevert();
        account.submit(address(account), 0, abi.encodeCall(QForkAccount.setAllowance, (address(account), address(0), _limits(1, 1, 1, false))));
    }

    function test_setAllowance_clearRemovesIt() public {
        QForkAccount account = _solo();
        _grantEth(account, 1 ether, 3 ether);
        vm.prank(agent);
        account.spend(address(0), shop, 1 ether);

        QForkAccount.Allowance memory none;
        _self(account, abi.encodeCall(QForkAccount.setAllowance, (agent, address(0), none)));
        (, uint256 spent,) = account.allowance(agent, address(0));
        assertEq(spent, 0);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.NoAllowance.selector, agent, address(0)));
        account.spend(address(0), shop, 1);
    }

    function test_spenders_capped() public {
        QForkAccount account = _solo();
        for (uint160 i = 1; i <= 64; ++i) {
            _self(account, abi.encodeCall(QForkAccount.setRecipient, (address(i), shop, true)));
        }
        vm.prank(alice);
        vm.expectRevert();
        account.submit(address(account), 0, abi.encodeCall(QForkAccount.setRecipient, (address(65), shop, true)));
    }

    function test_spenderInfo_listsEachEntryOnce() public {
        QForkAccount account = _solo();
        _grantEth(account, 1 ether, 2 ether);
        _grantEth(account, 1 ether, 3 ether);
        _self(account, abi.encodeCall(QForkAccount.setAllowance, (agent, address(token), _limits(5e18, 10e18, uint32(DAY), true))));
        _self(account, abi.encodeCall(QForkAccount.setRecipient, (agent, shop, true)));
        _self(account, abi.encodeCall(QForkAccount.setRecipient, (agent, shop, false)));
        _self(account, abi.encodeCall(QForkAccount.setScope, (agent, address(counter), Counter.bump.selector, uint64(block.timestamp + DAY))));
        _self(account, abi.encodeCall(QForkAccount.setScope, (agent, address(counter), Counter.bump.selector, uint64(0))));
        vm.prank(alice);
        account.freeze(agent);

        (bool isFrozen, address[] memory assets, address[] memory recipients, QForkAccount.Scope[] memory scopes) = account.spenderInfo(agent);
        assertTrue(isFrozen);
        assertEq(assets.length, 2);
        assertEq(assets[0], address(0));
        assertEq(assets[1], address(token));
        assertEq(recipients.length, 1);
        assertEq(recipients[0], shop);
        assertFalse(account.recipientAllowed(agent, shop));
        assertEq(scopes.length, 1);
        assertEq(scopes[0].target, address(counter));
        assertEq(scopes[0].selector, Counter.bump.selector);
        assertEq(account.scope(agent, address(counter), Counter.bump.selector), 0);
    }

    function test_batch_appliesAllOrNothing() public {
        QForkAccount account = _trio();
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(QForkAccount.setAllowance, (agent, address(0), _limits(1 ether, 2 ether, uint32(DAY), true)));
        calls[1] = abi.encodeCall(QForkAccount.setRecipient, (agent, shop, true));
        vm.prank(alice);
        (uint256 id,) = account.submit(address(account), 0, abi.encodeCall(QForkAccount.batch, (calls)));
        vm.roll(block.number + 1);
        vm.prank(bob);
        account.approve(id);
        vm.prank(bob);
        account.execute(id);
        assertTrue(account.recipientAllowed(agent, shop));
        (QForkAccount.Allowance memory limits,,) = account.allowance(agent, address(0));
        assertEq(limits.perPeriod, 2 ether);

        calls[0] = abi.encodeCall(QForkAccount.setRecipient, (agent, bob, true));
        calls[1] = abi.encodeCall(QForkAccount.setThreshold, (uint8(9)));
        vm.prank(alice);
        (id,) = account.submit(address(account), 0, abi.encodeCall(QForkAccount.batch, (calls)));
        vm.roll(block.number + 1);
        vm.prank(carol);
        account.approve(id);
        vm.prank(carol);
        vm.expectRevert();
        account.execute(id);
        assertFalse(account.recipientAllowed(agent, bob));
        assertEq(account.threshold(), 2);
    }

    function test_batch_onlySelf() public {
        QForkAccount account = _solo();
        vm.prank(alice);
        vm.expectRevert(QForkAccount.NotSelf.selector);
        account.batch(new bytes[](0));
    }

    function test_spenderInfo_capped() public {
        QForkAccount account = _solo();
        for (uint160 i = 1; i <= 32; ++i) {
            _self(account, abi.encodeCall(QForkAccount.setRecipient, (agent, address(i), true)));
        }
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(QForkAccount.ExecutionFailed.selector, abi.encodeWithSelector(QForkAccount.TooManyEntries.selector))
        );
        account.submit(address(account), 0, abi.encodeCall(QForkAccount.setRecipient, (agent, address(33), true)));
    }

    /* ---------- scoped calls ---------- */

    function test_scopedCall_allowedSelector() public {
        QForkAccount account = _solo();
        _self(account, abi.encodeCall(QForkAccount.setScope, (agent, address(counter), Counter.bump.selector, uint64(block.timestamp + DAY))));
        vm.prank(agent);
        account.scopedCall(address(counter), abi.encodeCall(Counter.bump, (2)));
        assertEq(counter.count(), 2);
        assertEq(counter.lastCaller(), address(account));
    }

    function test_scopedCall_outOfScope() public {
        QForkAccount account = _solo();
        _self(account, abi.encodeCall(QForkAccount.setScope, (agent, address(counter), Counter.bump.selector, uint64(block.timestamp + DAY))));
        vm.startPrank(agent);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.NotInScope.selector, address(counter), Counter.boom.selector));
        account.scopedCall(address(counter), abi.encodeCall(Counter.boom, ()));
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.NotInScope.selector, address(token), Counter.bump.selector));
        account.scopedCall(address(token), abi.encodeCall(Counter.bump, (1)));
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.NotInScope.selector, address(counter), bytes4(0)));
        account.scopedCall(address(counter), hex"01");
        vm.stopPrank();

        vm.warp(block.timestamp + DAY + 1);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.NotInScope.selector, address(counter), Counter.bump.selector));
        account.scopedCall(address(counter), abi.encodeCall(Counter.bump, (1)));
    }

    function test_setScope_refusesTokenMovementAndSelf() public {
        QForkAccount account = _solo();
        bytes4[18] memory blocked = [
            bytes4(0xa9059cbb),
            0x095ea7b3,
            0x23b872dd,
            0x39509351,
            0xa22cb465,
            0xd505accf,
            0x8fcbaf0c,
            0x42842e0e,
            0xb88d4fde,
            0xf242432a,
            0x2eb2c2d6,
            0x4000aea0,
            0x9bd9bbc6,
            0x62ad1b83,
            0x959b8c3f,
            0x87517c45,
            0x2b67b570,
            0x2a2d80d1
        ];
        for (uint256 i; i < blocked.length; ++i) {
            vm.prank(alice);
            vm.expectRevert();
            account.submit(address(account), 0, abi.encodeCall(QForkAccount.setScope, (agent, address(token), blocked[i], uint64(block.timestamp + DAY))));
        }
        vm.prank(alice);
        vm.expectRevert();
        account.submit(address(account), 0, abi.encodeCall(QForkAccount.setScope, (agent, address(account), QForkAccount.submit.selector, uint64(block.timestamp + DAY))));
        assertEq(TestToken.approve.selector, bytes4(0x095ea7b3));
    }

    function test_scopedCall_frozen() public {
        QForkAccount account = _solo();
        _self(account, abi.encodeCall(QForkAccount.setScope, (agent, address(counter), Counter.bump.selector, uint64(block.timestamp + DAY))));
        vm.prank(alice);
        account.freeze(agent);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(QForkAccount.Frozen.selector, agent));
        account.scopedCall(address(counter), abi.encodeCall(Counter.bump, (1)));
    }

    /* ---------- key set ---------- */

    function test_rotateKeyset() public {
        QForkAccount account = _solo();
        bytes32 next = keccak256("qfork/keyset/v1:rotated");
        _self(account, abi.encodeCall(QForkAccount.rotateKeyset, (next)));
        assertEq(account.keyset(), next);
        assertEq(account.keysetVersion(), 2);
    }

    /* ---------- factory ---------- */

    function test_factory_predictsAndIndexes() public {
        address[] memory list = _owners(alice, bob, carol);
        address predicted = factory.predict(dave, list, 2, KEYSET, bytes32("one"));
        vm.prank(dave);
        QForkAccount account = factory.create(list, 2, KEYSET, bytes32("one"));
        assertEq(address(account), predicted);
        assertTrue(factory.isAccount(address(account)));
        assertEq(factory.accountsOf(bob)[0], address(account));
        assertEq(factory.accountsOf(dave).length, 0);
        assertEq(factory.createdBy(dave).length, 1);
        assertEq(factory.createdBy(dave)[0], address(account));
        assertEq(factory.createdBy(bob).length, 0);
    }

    function test_factory_saltIsPerCreator() public {
        vm.prank(alice);
        QForkAccount a = factory.create(_owners(alice), 1, bytes32(0), bytes32("s"));
        vm.prank(bob);
        QForkAccount b = factory.create(_owners(alice), 1, bytes32(0), bytes32("s"));
        assertTrue(address(a) != address(b));

        vm.prank(alice);
        vm.expectRevert();
        factory.create(_owners(alice), 1, bytes32(0), bytes32("s"));
    }

    /* ---------- fuzz ---------- */

    /// No sequence of spends moves more than perPeriod inside one window.
    function testFuzz_periodCapHolds(uint96[8] memory amounts, uint32[8] memory gaps) public {
        QForkAccount account = _solo();
        uint128 perTransfer = 1 ether;
        uint128 perPeriod = 2.5 ether;
        _grantEth(account, perTransfer, perPeriod);

        uint256 windowStart;
        uint256 inWindow;
        for (uint256 i; i < amounts.length; ++i) {
            vm.warp(block.timestamp + (gaps[i] % (DAY / 2)));
            uint256 amount = (uint256(amounts[i]) % perTransfer) + 1;
            if (block.timestamp >= windowStart + DAY) {
                windowStart = block.timestamp;
                inWindow = 0;
            }
            vm.prank(agent);
            try account.spend(address(0), shop, amount) {
                inWindow += amount;
            } catch {}
            assertLe(inWindow, perPeriod);
            (, uint256 spent,) = account.allowance(agent, address(0));
            assertEq(spent, inWindow);
        }
    }

    function testFuzz_onlyApprovedProposalsMoveFunds(uint8 approversMask) public {
        QForkAccount account = _trio();
        vm.prank(alice);
        (uint256 id,) = account.submit(shop, 1 ether, "");
        address[3] memory everyone = [alice, bob, carol];
        uint256 count = 1;
        for (uint256 i = 1; i < 3; ++i) {
            if (approversMask & (1 << i) != 0) {
                vm.prank(everyone[i]);
                account.approve(id);
                ++count;
            }
        }
        vm.prank(alice);
        if (count >= 2) {
            account.execute(id);
            assertEq(shop.balance, 1 ether);
        } else {
            vm.expectRevert();
            account.execute(id);
            assertEq(shop.balance, 0);
        }
    }
}
