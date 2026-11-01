// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "./IERC20.sol";
import {IBridgeInbox} from "./IBridgeInbox.sol";

contract BridgeInbox is IBridgeInbox {
    /// @dev seal hashes every waiting deposit, so the queue stops here.
    uint256 public constant MAX_PENDING = 64;

    IERC20 public immutable token;
    uint64 public immutable chainId;
    address public immutable oracle;

    uint64 public nextNonce;
    Pending[] public pending;
    mapping(uint64 => bytes32) public roots;
    mapping(uint64 => bytes32) public blockHashes;
    mapping(uint64 => bool) public isSealed;
    mapping(uint64 => bool) public released;

    constructor(IERC20 token_, uint64 chainId_, address oracle_) {
        token = token_;
        chainId = chainId_;
        oracle = oracle_;
    }

    function deposit(uint256 amount, bytes32 recipient) external {
        if (amount == 0) revert ZeroAmount();
        if (pending.length == MAX_PENDING) revert Full();
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        uint64 nonce = nextNonce++;
        bytes32 sender = bytes32(uint256(uint160(msg.sender)));
        pending.push(Pending(nonce, sender, recipient, amount));
        emit Deposit(nonce, sender, recipient, amount);
    }

    function seal(uint64 height) external returns (bytes32 root, bytes32 blockHash) {
        if (isSealed[height]) revert AlreadySealed();
        uint256 n = pending.length;
        if (n == 0) revert Empty();
        bytes32[] memory leaves = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            Pending memory item = pending[i];
            leaves[i] = messageLeaf(chainId, height, item.nonce, item.sender, item.recipient, item.amount);
        }
        root = merkleRoot(leaves);
        blockHash = sha256(abi.encodePacked(chainId, height, root));
        roots[height] = root;
        blockHashes[height] = blockHash;
        isSealed[height] = true;
        delete pending;
        emit Sealed(height, root, blockHash);
    }

    function release(Withdrawal calldata withdrawal, bytes32[] calldata siblings, uint8 v, bytes32 r, bytes32 s)
        external
    {
        if (released[withdrawal.nonce]) revert AlreadyReleased();
        bytes32 leaf = messageLeaf(
            chainId, withdrawal.height, withdrawal.nonce, withdrawal.sender, withdrawal.recipient, withdrawal.amount
        );
        if (!verify(leaf, withdrawal.index, siblings, withdrawal.receiptsRoot)) revert BadProof();
        bytes32 digest =
            sha256(abi.encodePacked(chainId, withdrawal.height, withdrawal.blockHash, withdrawal.receiptsRoot));
        if (ecrecover(digest, v, r, s) != oracle) revert BadOracle();
        if (uint256(withdrawal.recipient) >> 160 != 0 || withdrawal.recipient == bytes32(0)) revert BadRecipient();
        released[withdrawal.nonce] = true;
        address to = address(uint160(uint256(withdrawal.recipient)));
        if (!token.transfer(to, withdrawal.amount)) revert TransferFailed();
    }

    function messageLeaf(
        uint64 srcChain,
        uint64 srcHeight,
        uint64 nonce,
        bytes32 sender,
        bytes32 recipient,
        uint256 amount
    ) public pure returns (bytes32) {
        return sha256(abi.encodePacked(bytes1(0x00), srcChain, srcHeight, nonce, sender, recipient, amount));
    }

    function merkleRoot(bytes32[] memory leaves) public pure returns (bytes32) {
        if (leaves.length == 0) return sha256("");
        while (leaves.length > 1) {
            if (leaves.length % 2 == 1) {
                bytes32[] memory padded = new bytes32[](leaves.length + 1);
                for (uint256 i = 0; i < leaves.length; i++) {
                    padded[i] = leaves[i];
                }
                padded[leaves.length] = leaves[leaves.length - 1];
                leaves = padded;
            }
            uint256 pairs = leaves.length / 2;
            bytes32[] memory next = new bytes32[](pairs);
            for (uint256 i = 0; i < pairs; i++) {
                next[i] = _branch(leaves[2 * i], leaves[2 * i + 1]);
            }
            leaves = next;
        }
        return leaves[0];
    }

    function verify(bytes32 leaf, uint256 index, bytes32[] memory siblings, bytes32 root) public pure returns (bool) {
        bytes32 acc = leaf;
        uint256 cursor = index;
        for (uint256 i = 0; i < siblings.length; i++) {
            if (cursor % 2 == 0) acc = _branch(acc, siblings[i]);
            else acc = _branch(siblings[i], acc);
            cursor /= 2;
        }
        return cursor == 0 && acc == root;
    }

    function _branch(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return sha256(abi.encodePacked(bytes1(0x01), left, right));
    }
}
