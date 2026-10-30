"""Bridge in the style of LayerZero v1: an oracle posts source-chain block headers and a separate
relayer posts Merkle proofs of messages against them. A message is accepted only when its proof
checks out against a header the oracle posted, so the oracle and relayer have to collude to forge
a deposit.

This file is the on-chain side only (called from state.py): store headers, verify proofs, dedupe
nonces, credit deposits, queue withdrawals. The off-chain source chain, oracle and relayer live in
sim/bridge.py.

Budget: < 1,000 lines.
"""

from __future__ import annotations

from core.types import BlockHeader, BridgeMessage, Hash, MessageProof


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
