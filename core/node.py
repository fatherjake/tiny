"""A validator: everything one participant runs, wired together.

    keypair -> signs votes, timeouts, proposals and oracle price txs
    mempool -> pending txs, deduped by (signer, nonce); feeds proposals when this node leads
    Replica -> HotStuff (consensus.py); on_commit hands blocks to State
    State   -> deterministic state machine (state.py); state_root() compared across nodes in tests
    price submitter -> each block, sign a SetOraclePrice tx from the price feed
    transport -> net.py, in-memory or TCP

Run one validator per process over TCP:

    uv run python -m core.node --id 0 --config cluster.json

Budget: < 1,000 lines.
"""

from __future__ import annotations

import argparse
import logging
from collections.abc import Callable
from dataclasses import replace

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from core.consensus import Replica
from core.net import Transport
from core.state import State
from core.types import Block, Market, NewView, NodeId, Proposal, Timeout, Tx, TxBody, Vote

log = logging.getLogger(__name__)

TxKey = tuple[str, int]  # (signer, nonce)


# ---------------------------------------------------------------- keys and signatures


def public_key(private_key: bytes) -> bytes:
    key = Ed25519PrivateKey.from_private_bytes(private_key).public_key()
    return key.public_bytes(Encoding.Raw, PublicFormat.Raw)


def sign(private_key: bytes, payload: bytes) -> bytes:
    return Ed25519PrivateKey.from_private_bytes(private_key).sign(payload)


def verify(public: bytes, payload: bytes, sig: bytes) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(public).verify(sig, payload)
    except (InvalidSignature, ValueError):
        return False
    return True


def sign_tx(private_key: bytes, body: TxBody, nonce: int) -> Tx:
    """What a client (bot, UI, test) does before POSTing to /tx."""
    unsigned = Tx(body, public_key(private_key).hex(), nonce, b"")
    return replace(unsigned, sig=sign(private_key, unsigned.signing_bytes()))


def verify_tx(tx: Tx) -> bool:
    try:
        signer = bytes.fromhex(tx.signer)
    except ValueError:
        return False
    return verify(signer, tx.signing_bytes(), tx.sig)


# ---------------------------------------------------------------- mempool


class Mempool:
    """Pending txs keyed by (signer, nonce).

    Deduping here only saves work. What stops a tx applying twice is State's nonce rule, so a
    duplicate that slips into two blocks is rejected when the second one is applied.

    In chained HotStuff the next block is proposed before the last one commits, so txs already in
    an uncommitted proposal are marked in flight and skipped by take(). If that proposal never
    commits (its leader timed out), they become takeable again after `retry_after` commits.
    """

    def __init__(
        self, max_block_txs: int = 500, max_pending: int = 10_000, retry_after: int = 5
    ) -> None:
        self.max_block_txs = max_block_txs
        self.max_pending = max_pending
        self.retry_after = retry_after
        self.pending: dict[TxKey, Tx] = {}
        self.in_flight: dict[TxKey, int] = {}  # key -> self.commits when it was proposed
        self.commits = 0

    def add(self, tx: Tx) -> bool:
        key = (tx.signer, tx.nonce)
        if key in self.pending or len(self.pending) >= self.max_pending:
            return False
        self.pending[key] = tx
        return True

    def take(self) -> list[Tx]:
        """Txs for a new proposal, sorted by (signer, nonce) so each signer's nonces go in order."""
        ready = sorted(key for key in self.pending if key not in self.in_flight)
        txs = [self.pending[key] for key in ready[: self.max_block_txs]]
        self.mark_proposed(txs)
        return txs

    def mark_proposed(self, txs: tuple[Tx, ...] | list[Tx]) -> None:
        for tx in txs:
            self.in_flight.setdefault((tx.signer, tx.nonce), self.commits)

    def remove_committed(self, block: Block, nonce_of: Callable[[str], int]) -> None:
        """Drop the block's txs, any tx whose nonce is now used, and stale in-flight marks."""
        self.commits += 1
        for tx in block.txs:
            self.pending.pop((tx.signer, tx.nonce), None)
            self.in_flight.pop((tx.signer, tx.nonce), None)
        stale = [key for key in self.pending if key[1] <= nonce_of(key[0])]
        for key in stale:
            del self.pending[key]
            self.in_flight.pop(key, None)
        expired = [
            key for key, at in self.in_flight.items() if self.commits - at > self.retry_after
        ]
        for key in expired:
            del self.in_flight[key]


# ---------------------------------------------------------------- node


class Node:
    def __init__(
        self,
        node_id: NodeId,
        n: int,
        private_key: bytes,
        validator_pubkeys: dict[NodeId, bytes],
        markets: list[Market],
        transport: Transport,
        price_feed: Callable[[], dict[str, int]] | None = None,
    ) -> None:
        self.id = node_id
        self.private_key = private_key
        self.validator_pubkeys = validator_pubkeys
        self.transport = transport
        self.price_feed = price_feed
        self.mempool = Mempool()
        self.state = State(markets)
        self.committed: list[Block] = []
        self.replica = Replica(
            node_id,
            n,
            send=transport.send,
            broadcast=transport.broadcast,
            on_commit=self.on_commit,
            mempool=self.mempool.take,
        )
        transport.on_message(self.on_message)

    def start(self) -> None:
        """Start the pacemaker timer and the price submitter."""
        raise NotImplementedError

    def stop(self) -> None:
        raise NotImplementedError

    def submit(self, tx: Tx) -> bool:
        """Entry point for the API: check it, add it to the mempool, gossip it to the other nodes.

        Returns False for a bad signature, a used nonce, a duplicate or a full mempool. True only
        means "pending": the tx takes effect, or is rejected, when its block is applied.
        """
        if not self.accept(tx):
            return False
        self.transport.broadcast(tx)
        return True

    def accept(self, tx: Tx) -> bool:
        """Cheap checks only, cheapest first. State has the final say on every tx."""
        if tx.nonce <= self.state.nonce(tx.signer):
            return False
        if not verify_tx(tx):
            return False
        return self.mempool.add(tx)

    def on_message(self, sender: NodeId, msg: object) -> None:
        """Route Proposal / Vote / Timeout / NewView to the replica, Tx to the mempool."""
        match msg:
            case Tx():
                self.accept(msg)  # gossiped by the node it was submitted to; don't re-broadcast
            case Proposal():
                self.mempool.mark_proposed(msg.block.txs)
                self.replica.on_proposal(msg)
            case Vote():
                self.replica.on_vote(msg)
            case Timeout():
                self.replica.on_timeout(msg)
            case NewView():
                self.replica.on_new_view(msg)
            case _:
                log.warning("node %d: dropping unknown message from %d: %r", self.id, sender, msg)

    def on_commit(self, block: Block) -> None:
        self.state.apply_block(block)
        self.mempool.remove_committed(block, self.state.nonce)
        self.committed.append(block)

    def submit_prices(self) -> None:
        raise NotImplementedError


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one tiny validator over TCP")
    parser.add_argument("--id", type=int, required=True)
    parser.add_argument("--config", required=True, help="cluster.json with peers and keys")
    args = parser.parse_args()
    raise NotImplementedError(args)


if __name__ == "__main__":
    main()
