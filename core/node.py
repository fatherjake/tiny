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
from collections.abc import Callable

from core.consensus import Replica
from core.net import Transport
from core.state import State
from core.types import Block, Market, NodeId, Tx


class Mempool:
    def __init__(self, max_block_txs: int = 500) -> None:
        self.max_block_txs = max_block_txs
        self.pending: dict[tuple[str, int], Tx] = {}

    def add(self, tx: Tx) -> bool:
        raise NotImplementedError

    def take(self) -> list[Tx]:
        raise NotImplementedError

    def remove_committed(self, block: Block) -> None:
        raise NotImplementedError


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
        """Entry point for the API: verify the signature, add to mempool, gossip."""
        raise NotImplementedError

    def on_message(self, sender: NodeId, msg: object) -> None:
        """Route Proposal / Vote / Timeout / NewView to the replica, Tx to the mempool."""
        raise NotImplementedError

    def on_commit(self, block: Block) -> None:
        self.state.apply_block(block)
        self.mempool.remove_committed(block)
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
