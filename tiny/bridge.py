"""Bridge in the style of LayerZero v1: an oracle posts source-chain block headers and a separate
relayer posts Merkle proofs of messages against them. A message is accepted only when its proof
checks out against a header the oracle posted, so the oracle and relayer have to collude to forge
a deposit.

On-chain side (called from state.py): store headers, verify proofs, dedupe nonces, credit
deposits, queue withdrawals.
Off-chain side (run by sim.py): a fake source chain, an Oracle that posts its headers and a
Relayer that posts proofs.

Budget: < 1,000 lines.
"""

from __future__ import annotations

from tiny.types import BlockHeader, BridgeMessage, Hash, MessageProof


def merkle_root(leaves: list[Hash]) -> Hash:
    raise NotImplementedError


def merkle_proof(leaves: list[Hash], index: int) -> tuple[Hash, ...]:
    raise NotImplementedError


def verify_merkle(leaf: Hash, index: int, siblings: tuple[Hash, ...], root: Hash) -> bool:
    raise NotImplementedError


class Bridge:
    """On-chain endpoint. Deterministic; lives inside State."""

    def __init__(self, oracle_pubkey: bytes = b"") -> None:
        self.oracle_pubkey = oracle_pubkey
        self.headers: dict[tuple[int, int], BlockHeader] = {}  # (chain_id, height) -> header
        self.delivered: set[tuple[int, int]] = set()          # (src_chain, nonce)
        self.outbox: list[BridgeMessage] = []

    def post_header(self, header: BlockHeader, oracle_sig: bytes) -> None:
        raise NotImplementedError

    def deliver(self, proof: MessageProof) -> BridgeMessage:
        """Verify against a posted header, check the nonce, return the message to credit."""
        raise NotImplementedError

    def queue_withdrawal(self, msg: BridgeMessage) -> None:
        raise NotImplementedError


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
