"""Off-chain side of the bridge: a toy source chain, the oracle that posts its headers and the
relayer that posts Merkle proofs of its messages. They submit PostHeader and Deposit txs to a node;
core/bridge.py verifies them on-chain.

The toy chain seals the same leaves as contracts/src/BridgeInbox.sol. It stands in for that
contract inside the one-process playground, which does not run an EVM.
"""

from __future__ import annotations

from dataclasses import replace

from core.bridge import merkle_proof, merkle_root, message_leaf, sealed_block_hash
from core.node import Node, public_key, sign, sign_tx
from core.types import (
    BlockHeader,
    BridgeMessage,
    Deposit,
    MessageProof,
    PostHeader,
    encode,
)

SOURCE_CHAIN = 1
# Validators use 1..n and demo traders start at 1000. These sit far above both.
ORACLE_KEY = (1 << 32).to_bytes(32, "big")
RELAYER_KEY = ((1 << 32) + 1).to_bytes(32, "big")
DEPOSIT_SENDER = "0x" + "11" * 20


class FakeSourceChain:
    """A toy source chain that produces blocks of deposit messages."""

    def __init__(self, chain_id: int) -> None:
        self.chain_id = chain_id
        self.height = 0
        self.blocks: list[tuple[BlockHeader, list[BridgeMessage]]] = []
        self._nonce = 0
        self._pending: list[BridgeMessage] = []

    def deposit(self, sender: str, recipient: str, amount: int) -> BridgeMessage:
        """Queue a deposit. The sealed copy, with this block's height, is what gets proved."""
        message = BridgeMessage(self.chain_id, 0, self._nonce, sender, recipient, amount)
        message_leaf(message)
        self._nonce += 1
        self._pending.append(message)
        return message

    def mine(self) -> BlockHeader:
        if not self._pending:
            raise ValueError("nothing to mine")
        height = self.height + 1
        messages = [replace(message, src_height=height) for message in self._pending]
        leaves = [message_leaf(message) for message in messages]
        root = merkle_root(leaves)
        header = BlockHeader(
            self.chain_id,
            height,
            sealed_block_hash(self.chain_id, height, root),
            root,
        )
        self.blocks.append((header, messages))
        self._pending = []
        self.height = height
        return header


class Oracle:
    """Watches the source chain and submits PostHeader txs."""

    def __init__(self, private_key: bytes = ORACLE_KEY) -> None:
        self.private_key = private_key
        self._next = 0

    def poll(self, chain: FakeSourceChain) -> list[BlockHeader]:
        fresh = [header for header, _messages in chain.blocks[self._next :]]
        self._next = len(chain.blocks)
        return fresh

    def sign_header(self, header: BlockHeader) -> bytes:
        return sign(self.private_key, encode(header))


class Relayer:
    """Watches the source chain and submits Deposit txs carrying Merkle proofs."""

    def __init__(self) -> None:
        self._next = 0

    def poll(self, chain: FakeSourceChain) -> list[MessageProof]:
        proofs: list[MessageProof] = []
        for _header, messages in chain.blocks[self._next :]:
            leaves = [message_leaf(message) for message in messages]
            for index, message in enumerate(messages):
                proofs.append(MessageProof(message, index, merkle_proof(leaves, index)))
        self._next = len(chain.blocks)
        return proofs


def credit_accounts(nodes: list[Node], keys: list[bytes], amount: int) -> None:
    """Apply one checked deposit per key on every node before the first block.

    Opening balances are genesis: every validator has to start from the same state.
    """
    pubkey = public_key(ORACLE_KEY)
    for node in nodes:
        node.state.bridge.oracle_pubkey = pubkey
    if not keys:
        return
    chain = FakeSourceChain(SOURCE_CHAIN)
    recipients = [public_key(key).hex() for key in keys]
    for recipient in recipients:
        chain.deposit(DEPOSIT_SENDER, recipient, amount)
    chain.mine()
    oracle = Oracle(ORACLE_KEY)
    header = oracle.poll(chain)[0]
    sig = oracle.sign_header(header)
    proofs = Relayer().poll(chain)
    for node in nodes:
        node.state.apply_tx(sign_tx(ORACLE_KEY, PostHeader(header, sig), 1), 0)
        for nonce, proof in enumerate(proofs, start=1):
            node.state.apply_tx(sign_tx(RELAYER_KEY, Deposit(proof), nonce), 0)
        for recipient in recipients:
            account = node.state.accounts.get(recipient)
            if account is None or account.collateral != amount:
                raise RuntimeError("deposit was not credited")
