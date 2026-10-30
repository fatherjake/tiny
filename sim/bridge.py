"""Off-chain side of the bridge: a toy source chain, the oracle that posts its headers and the
relayer that posts Merkle proofs of its messages. They submit PostHeader and Deposit txs to a node;
core/bridge.py verifies them on-chain."""

from __future__ import annotations

from core.types import BlockHeader, BridgeMessage, MessageProof


class FakeSourceChain:
    """A toy source chain that produces blocks of deposit messages."""

    def __init__(self, chain_id: int) -> None:
        self.chain_id = chain_id
        self.height = 0
        self.blocks: list[tuple[BlockHeader, list[BridgeMessage]]] = []

    def deposit(self, sender: str, recipient: str, amount: int) -> BridgeMessage:
        raise NotImplementedError

    def mine(self) -> BlockHeader:
        raise NotImplementedError


class Oracle:
    """Watches the source chain and submits PostHeader txs."""

    def poll(self, chain: FakeSourceChain) -> list[BlockHeader]:
        raise NotImplementedError


class Relayer:
    """Watches the source chain and submits Deposit txs carrying Merkle proofs."""

    def poll(self, chain: FakeSourceChain) -> list[MessageProof]:
        raise NotImplementedError
