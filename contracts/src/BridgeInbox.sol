// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Locks one ERC20 and releases it back. Leaves match core/bridge.py:
///         sha256(0x00 || chain || height || nonce || sender || recipient || amount)
///         with uint64, uint64, uint64, bytes32, bytes32, uint256 packed tight.
///         A branch is sha256(0x01 || left || right). An odd level duplicates its last node.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract BridgeInbox {
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

    IERC20 public immutable token;
    uint64 public immutable chainId;
    address public immutable oracle;

    uint64 public nextNonce;
    Pending[] public pending;
    mapping(uint64 => bytes32) public roots;
    mapping(uint64 => bytes32) public blockHashes;
    mapping(uint64 => bool) public isSealed;
    mapping(uint64 => bool) public released;
    mapping(uint64 => bytes32[]) private blockLeaves;

    event Deposit(uint64 indexed nonce, bytes32 sender, bytes32 recipient, uint256 amount);
    event Sealed(uint64 indexed height, bytes32 root, bytes32 blockHash);

    error ZeroAddress();
    error ZeroAmount();
    error TransferFailed();
    error Empty();
    error AlreadySealed();
    error UnknownHeight();
    error BadIndex();
    error BadProof();
    error BadOracle();
    error BadRecipient();
    error AlreadyReleased();

    constructor(IERC20 token_, uint64 chainId_, address oracle_) {
        if (address(token_) == address(0) || oracle_ == address(0)) revert ZeroAddress();
        token = token_;
        chainId = chainId_;
        oracle = oracle_;
    }

    function deposit(uint256 amount, bytes32 recipient) external {
        if (amount == 0) revert ZeroAmount();
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        uint64 nonce = nextNonce;
        nextNonce = nonce + 1;
        bytes32 sender = bytes32(uint256(uint160(msg.sender)));
        pending.push(Pending(nonce, sender, recipient, amount));
        emit Deposit(nonce, sender, recipient, amount);
    }

    /// @dev Stamps `height` into the pending deposits and stores their Merkle root.
    function seal(uint64 height) external returns (bytes32 root, bytes32 blockHash) {
        if (isSealed[height]) revert AlreadySealed();
        uint256 n = pending.length;
        if (n == 0) revert Empty();
        bytes32[] memory leaves = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            Pending memory item = pending[i];
            leaves[i] = messageLeaf(chainId, height, item.nonce, item.sender, item.recipient, item.amount);
            blockLeaves[height].push(leaves[i]);
        }
        root = merkleRoot(leaves);
        blockHash = sha256(abi.encodePacked(chainId, height, root));
        roots[height] = root;
        blockHashes[height] = blockHash;
        isSealed[height] = true;
        delete pending;
        emit Sealed(height, root, blockHash);
    }

    /// @dev Pays `amount` of the locked token. The oracle signed sha256(chain || height || blockHash || root)
    ///      with no Ethereum prefix. `recipient` is a left-padded address.
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

    function proof(uint64 height, uint256 index) external view returns (bytes32[] memory siblings) {
        if (!isSealed[height]) revert UnknownHeight();
        bytes32[] storage stored = blockLeaves[height];
        if (index >= stored.length) revert BadIndex();
        uint256 levels = 0;
        uint256 width = stored.length;
        while (width > 1) {
            if (width % 2 == 1) width += 1;
            width /= 2;
            levels += 1;
        }
        siblings = new bytes32[](levels);
        bytes32[] memory level = new bytes32[](stored.length);
        for (uint256 i = 0; i < stored.length; i++) {
            level[i] = stored[i];
        }
        uint256 cursor = index;
        for (uint256 s = 0; s < levels; s++) {
            if (level.length % 2 == 1) {
                bytes32[] memory padded = new bytes32[](level.length + 1);
                for (uint256 i = 0; i < level.length; i++) {
                    padded[i] = level[i];
                }
                padded[level.length] = level[level.length - 1];
                level = padded;
            }
            siblings[s] = level[cursor ^ 1];
            uint256 pairs = level.length / 2;
            bytes32[] memory next = new bytes32[](pairs);
            for (uint256 i = 0; i < pairs; i++) {
                next[i] = _branch(level[2 * i], level[2 * i + 1]);
            }
            level = next;
            cursor /= 2;
        }
    }

    function _branch(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return sha256(abi.encodePacked(bytes1(0x01), left, right));
    }
}
