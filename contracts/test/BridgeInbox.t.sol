// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BridgeInbox} from "../src/BridgeInbox.sol";
import {IBridgeInbox} from "../src/IBridgeInbox.sol";
import {IERC20} from "../src/IERC20.sol";

interface Vm {
    function prank(address msgSender) external;
    function addr(uint256 privateKey) external pure returns (address);
    function sign(uint256 privateKey, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
}

/// @notice Stand-in for the one ERC20 the inbox locks. Amounts are the same integers tiny credits.
contract Token is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == owner, "mint");
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _move(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        return _move(from, to, amount);
    }

    function _move(address from, address to, uint256 amount) internal returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract BridgeInboxTest {
    Vm internal constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    uint256 internal constant ORACLE_KEY = 0xA11CE;
    address internal constant ALICE = 0x1111111111111111111111111111111111111111;
    bytes32 internal constant RECIPIENT = hex"2222222222222222222222222222222222222222222222222222222222222222";
    // sha256 of the packed leaf. tests/test_bridge.py asserts the same hex.
    bytes32 internal constant LEAF0 = hex"c37a9f9a2c628abc2075812731e642f6aa5e5817583dbe607dad87cee7fe3241";
    bytes32 internal constant ROOT2 = hex"cb66821c5746b104715a85051aa66d1d5fb182b607cb4da46a609337cc11f38b";
    bytes32 internal constant ROOT3 = hex"0902f47722b3eebadd2321601e43ed78b15a85664eca7e427ca608e8bc6ef481";

    Token internal token;
    BridgeInbox internal inbox;

    error Leaf(bytes32 got);
    error Root(bytes32 got);
    error Balance(uint256 got);
    error Proof();
    error SealedTwice();
    error TookTokens();
    error Full();
    error ReleasedTwice();
    error ReleasedWithBadSig();

    function setUp() public {
        token = new Token();
        inbox = new BridgeInbox(token, 1, vm.addr(ORACLE_KEY));
    }

    function test_deposit_locks_the_token_and_matches_the_leaf() public {
        _mintAndApprove(ALICE, 10_000_000);
        vm.prank(ALICE);
        inbox.deposit(1_000_000, RECIPIENT);
        (bytes32 root, bytes32 blockHash) = inbox.seal(4);
        if (token.balanceOf(address(inbox)) != 1_000_000) revert Balance(token.balanceOf(address(inbox)));
        if (token.balanceOf(ALICE) != 9_000_000) revert Balance(token.balanceOf(ALICE));
        bytes32 sender = bytes32(uint256(uint160(ALICE)));
        bytes32 leaf = inbox.messageLeaf(1, 4, 0, sender, RECIPIENT, 1_000_000);
        if (leaf != LEAF0) revert Leaf(leaf);
        if (root != LEAF0) revert Root(root);
        bytes32 expectHash = sha256(abi.encodePacked(uint64(1), uint64(4), root));
        if (blockHash != expectHash) revert Root(blockHash);
    }

    function test_two_deposits_match_the_root_and_proof() public {
        _mintAndApprove(ALICE, 10_000_000);
        vm.prank(ALICE);
        inbox.deposit(1_000_000, RECIPIENT);
        vm.prank(ALICE);
        inbox.deposit(2_000_000, RECIPIENT);
        (bytes32 root,) = inbox.seal(4);
        if (root != ROOT2) revert Root(root);
        bytes32 sender = bytes32(uint256(uint160(ALICE)));
        bytes32 leaf0 = inbox.messageLeaf(1, 4, 0, sender, RECIPIENT, 1_000_000);
        bytes32 leaf1 = inbox.messageLeaf(1, 4, 1, sender, RECIPIENT, 2_000_000);
        bytes32[] memory siblings = new bytes32[](1);
        siblings[0] = leaf0;
        if (!inbox.verify(leaf1, 1, siblings, root)) revert Proof();
        bytes32 leaf2 = inbox.messageLeaf(1, 4, 2, sender, RECIPIENT, 3_000_000);
        bytes32[] memory three = new bytes32[](3);
        three[0] = leaf0;
        three[1] = leaf1;
        three[2] = leaf2;
        if (inbox.merkleRoot(three) != ROOT3) revert Root(inbox.merkleRoot(three));
        try inbox.seal(4) returns (bytes32, bytes32) {
            revert SealedTwice();
        } catch {}
    }

    function test_a_full_queue_seals_and_the_next_deposit_keeps_its_tokens() public {
        uint256 n = inbox.MAX_PENDING();
        _mintAndApprove(ALICE, n + 1);
        bytes32 sender = bytes32(uint256(uint160(ALICE)));
        bytes32[] memory leaves = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            vm.prank(ALICE);
            inbox.deposit(1, RECIPIENT);
            leaves[i] = inbox.messageLeaf(1, 4, uint64(i), sender, RECIPIENT, 1);
        }
        vm.prank(ALICE);
        try inbox.deposit(1, RECIPIENT) {
            revert TookTokens();
        } catch {}
        if (token.balanceOf(address(inbox)) != n) revert Balance(token.balanceOf(address(inbox)));
        if (token.balanceOf(ALICE) != 1) revert Balance(token.balanceOf(ALICE));
        if (inbox.nextNonce() != n) revert Full();
        (bytes32 root,) = inbox.seal(4);
        if (root != inbox.merkleRoot(leaves)) revert Root(root);
        vm.prank(ALICE);
        inbox.deposit(1, RECIPIENT);
        if (token.balanceOf(address(inbox)) != n + 1) revert Balance(token.balanceOf(address(inbox)));
    }

    function test_deposit_without_approval_keeps_the_tokens() public {
        token.mint(ALICE, 1_000_000);
        vm.prank(ALICE);
        try inbox.deposit(1_000_000, RECIPIENT) {
            revert TookTokens();
        } catch {}
        if (token.balanceOf(address(inbox)) != 0) revert Balance(token.balanceOf(address(inbox)));
        if (token.balanceOf(ALICE) != 1_000_000) revert Balance(token.balanceOf(ALICE));
    }

    function test_release_pays_the_address_once() public {
        _mintAndApprove(ALICE, 1_000_000);
        vm.prank(ALICE);
        inbox.deposit(1_000_000, RECIPIENT);
        inbox.seal(1);
        address bob = address(0xB0B);
        bytes32 recipient = bytes32(uint256(uint160(bob)));
        bytes32 sender = bytes32(uint256(7));
        uint64 height = 9;
        uint64 nonce = 1;
        uint256 amount = 250_000;
        bytes32 leaf = inbox.messageLeaf(1, height, nonce, sender, recipient, amount);
        bytes32 blockHash = sha256(abi.encodePacked(uint64(1), height, leaf));
        bytes32 digest = sha256(abi.encodePacked(uint64(1), height, blockHash, leaf));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ORACLE_KEY, digest);
        bytes32[] memory noSiblings = new bytes32[](0);
        inbox.release(
            IBridgeInbox.Withdrawal(blockHash, leaf, height, sender, recipient, amount, nonce, 0), noSiblings, v, r, s
        );
        if (token.balanceOf(bob) != 250_000) revert Balance(token.balanceOf(bob));
        if (token.balanceOf(address(inbox)) != 750_000) revert Balance(token.balanceOf(address(inbox)));

        bytes32 otherLeaf = inbox.messageLeaf(1, height, 3, sender, recipient, amount);
        bytes32 otherHash = sha256(abi.encodePacked(uint64(1), height, otherLeaf));
        bytes32 otherDigest = sha256(abi.encodePacked(uint64(1), height, otherHash, otherLeaf));
        (uint8 bv, bytes32 br, bytes32 bs) = vm.sign(0xBEEF, otherDigest);
        try inbox.release(
            IBridgeInbox.Withdrawal(otherHash, otherLeaf, height, sender, recipient, amount, 3, 0),
            noSiblings,
            bv,
            br,
            bs
        ) {
            revert ReleasedWithBadSig();
        } catch {}
        try inbox.release(
            IBridgeInbox.Withdrawal(blockHash, leaf, height, sender, recipient, amount, nonce, 0), noSiblings, v, r, s
        ) {
            revert ReleasedTwice();
        } catch {}
        if (token.balanceOf(bob) != 250_000) revert Balance(token.balanceOf(bob));
    }

    function _mintAndApprove(address user, uint256 amount) internal {
        token.mint(user, amount);
        vm.prank(user);
        require(token.approve(address(inbox), type(uint256).max), "approve");
    }
}
