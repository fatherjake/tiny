// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Locks one ERC20 and releases it back. Leaves match core/bridge.py:
///         sha256(0x00 || chain || height || nonce || sender || recipient || amount)
///         with uint64, uint64, uint64, bytes32, bytes32, uint256 packed tight.
///         A branch is sha256(0x01 || left || right). An odd level duplicates its last node.
///         The queue is capped so seal can hash every waiting deposit in one transaction.
interface IBridgeInbox {
    struct Pending {
        uint64 nonce;
        bytes32 sender;
        bytes32 recipient;
        uint256 amount;
    }

    struct Withdrawal {
        bytes32 blockHash;
        bytes32 receiptsRoot;
        uint64 height;
        bytes32 sender;
        bytes32 recipient;
        uint256 amount;
        uint64 nonce;
        uint256 index;
    }

    event Deposit(uint64 indexed nonce, bytes32 sender, bytes32 recipient, uint256 amount);
    event Sealed(uint64 indexed height, bytes32 root, bytes32 blockHash);

    error ZeroAmount();
    error TransferFailed();
    error Full();
    error Empty();
    error AlreadySealed();
    error BadProof();
    error BadOracle();
    error BadRecipient();
    error AlreadyReleased();

    function deposit(uint256 amount, bytes32 recipient) external;

    /// @dev Stamps `height` into the waiting deposits and stores their Merkle root.
    function seal(uint64 height) external returns (bytes32 root, bytes32 blockHash);

    /// @dev Pays `amount` of the locked token. The oracle signed sha256(chain || height || blockHash || root)
    ///      with no Ethereum prefix. `recipient` is a left-padded address.
    function release(Withdrawal calldata withdrawal, bytes32[] calldata siblings, uint8 v, bytes32 r, bytes32 s)
        external;

    function messageLeaf(
        uint64 srcChain,
        uint64 srcHeight,
        uint64 nonce,
        bytes32 sender,
        bytes32 recipient,
        uint256 amount
    ) external pure returns (bytes32);

    function merkleRoot(bytes32[] memory leaves) external pure returns (bytes32);

    function verify(bytes32 leaf, uint256 index, bytes32[] memory siblings, bytes32 root) external pure returns (bool);
}
