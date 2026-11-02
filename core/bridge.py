"""
    Bridge in the style of LayerZero v1
    An oracle posts source-chain block headers and a separate
    relayer posts Merkle proofs of messages against them. 

    Smart contract piece is in contracts/src/BridgeInbox.sol.
"""

from __future__ import annotations

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from core.types import BlockHeader, BridgeMessage, Hash, MessageProof, encode, sha256

_U64 = 2**64
_U256 = 2**256


def merkle_root(leaves: list[Hash]) -> Hash:
    if not leaves:
        return sha256(b"")
    level = list(leaves)
    while len(level) > 1:
        if len(level) % 2 == 1:
            level.append(level[-1])
        level = [_branch(level[i], level[i + 1]) for i in range(0, len(level), 2)]
    return level[0]


def merkle_proof(leaves: list[Hash], index: int) -> tuple[Hash, ...]:
    if index < 0 or index >= len(leaves):
        raise ValueError("leaf index out of range")
    siblings: list[Hash] = []
    level = list(leaves)
    cursor = index
    while len(level) > 1:
        if len(level) % 2 == 1:
            level.append(level[-1])
        siblings.append(level[cursor ^ 1])
        level = [_branch(level[i], level[i + 1]) for i in range(0, len(level), 2)]
        cursor //= 2
    return tuple(siblings)


def verify_merkle(leaf: Hash, index: int, siblings: tuple[Hash, ...], root: Hash) -> bool:
    if index < 0 or len(leaf) != 32 or len(root) != 32:
        return False
    acc = leaf
    for sibling in siblings:
        if len(sibling) != 32:
            return False
        if index % 2 == 0:
            acc = _branch(acc, sibling)
        else:
            acc = _branch(sibling, acc)
        index //= 2
    return index == 0 and acc == root


def message_leaf(message: BridgeMessage) -> Hash:
    """The leaf BridgeInbox.messageLeaf computes for this message."""
    return sha256(b"\x00" + _pack(message))


def sealed_block_hash(chain_id: int, height: int, root: Hash) -> Hash:
    """sha256(uint64 chain || uint64 height || root), matching BridgeInbox.seal."""
    if not _fits(chain_id, _U64) or not _fits(height, _U64) or len(root) != 32:
        raise ValueError("bad seal")
    return sha256(_u64(chain_id) + _u64(height) + root)


def releasable(chain_id: int, dest: str, amount: int) -> bool:
    """True when BridgeInbox.release can pay `amount` of the locked token to `dest` on `chain_id`."""
    if not _fits(chain_id, _U64) or not _fits(amount, _U256) or amount == 0:
        return False
    return eth_address(dest) is not None


def eth_address(value: str) -> bytes | None:
    """Left-padded 20-byte address, or None. Release pays the low 160 bits and refuses 0."""
    try:
        word = _word(value)
    except ValueError:
        return None
    if word[:12] != bytes(12) or word == bytes(32):
        return None
    return word


class Bridge:
    """On-chain endpoint. Deterministic; lives inside State."""

    def __init__(self, oracle_pubkey: bytes = b"") -> None:
        self.oracle_pubkey = oracle_pubkey
        self.headers: dict[tuple[int, int], BlockHeader] = {}  # (chain_id, height) -> header
        self.delivered: set[tuple[int, int]] = set()  # (src_chain, nonce)
        self.outbox: list[BridgeMessage] = []

    def post_header(self, header: BlockHeader, oracle_sig: bytes) -> None:
        """Store a header the oracle signed. A second header for the same height is ignored."""
        if not _fits(header.chain_id, _U64) or not _fits(header.height, _U64):
            return
        if len(header.block_hash) != 32 or len(header.receipts_root) != 32:
            return
        # node.py verifies tx signatures. Importing it would cycle through state.
        if not _ed25519(self.oracle_pubkey, encode(header), oracle_sig):
            return
        key = (header.chain_id, header.height)
        current = self.headers.get(key)
        if current is not None and current != header:
            return
        self.headers[key] = header

    def deliver(self, proof: MessageProof) -> BridgeMessage | None:
        """Verify against a posted header, check the nonce, and return the message to credit.

        None leaves the nonce unspent so a bad proof can be submitted again. A message that
        credits is recorded in `delivered` and will not credit twice.
        """
        message = proof.message
        header = self.headers.get((message.src_chain, message.src_height))
        if header is None or (message.src_chain, message.nonce) in self.delivered:
            return None
        try:
            leaf = message_leaf(message)
        except ValueError:
            return None
        if not verify_merkle(leaf, proof.leaf_index, proof.siblings, header.receipts_root):
            return None
        self.delivered.add((message.src_chain, message.nonce))
        return message

    def queue_withdrawal(self, msg: BridgeMessage) -> None:
        self.outbox.append(msg)


def _branch(left: Hash, right: Hash) -> Hash:
    return sha256(b"\x01" + left + right)


def _pack(message: BridgeMessage) -> bytes:
    return b"".join(
        (
            _u64(message.src_chain),
            _u64(message.src_height),
            _u64(message.nonce),
            _word(message.sender),
            _word(message.recipient),
            _u256(message.amount),
        )
    )


def _fits(n: int, ceiling: int) -> bool:
    return type(n) is int and 0 <= n < ceiling


def _u64(n: int) -> bytes:
    if not _fits(n, _U64):
        raise ValueError("uint64")
    return n.to_bytes(8, "big")


def _u256(n: int) -> bytes:
    if not _fits(n, _U256):
        raise ValueError("uint256")
    return n.to_bytes(32, "big")


def _word(value: str) -> bytes:
    raw = value[2:] if value[:2].lower() == "0x" else value
    try:
        data = bytes.fromhex(raw)
    except ValueError:
        raise ValueError("word") from None
    if not data or len(data) > 32:
        raise ValueError("word")
    return data.rjust(32, b"\x00")


def _ed25519(public: bytes, payload: bytes, sig: bytes) -> bool:
    if len(public) != 32 or not sig:
        return False
    try:
        Ed25519PublicKey.from_public_bytes(public).verify(sig, payload)
    except (InvalidSignature, ValueError):
        return False
    return True
