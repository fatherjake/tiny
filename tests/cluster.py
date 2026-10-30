"""Test helper: build n Nodes on a MemoryNetwork and run them for a while."""

from __future__ import annotations

from collections.abc import Callable

from core.node import Node, public_key
from core.types import Market
from sim.net import MemoryNetwork


class Cluster:
    def __init__(
        self,
        n: int = 4,
        seed: int = 0,
        drop: float = 0.0,
        markets: list[Market] | None = None,
        price_feed: Callable[[], dict[str, int]] | None = None,
    ) -> None:
        self.n = n
        self.net = MemoryNetwork(n, delay_ms=(0, 0), drop=drop, seed=seed)
        keys = [(seed * 100 + i + 1).to_bytes(32, "big") for i in range(n)]
        pubs = {i: public_key(key) for i, key in enumerate(keys)}
        books = list(markets or [])
        self.nodes = [
            Node(i, n, keys[i], pubs, books, self.net.endpoint(i), price_feed) for i in range(n)
        ]
        for node in self.nodes:
            node.start()

    def run_for(self, ms: int) -> None:
        self.net.run_for(ms)

    def heights(self) -> list[int]:
        return [len(node.committed) for node in self.nodes]

    def state_roots(self, alive_only: bool = True) -> set[bytes]:
        nodes = self.nodes
        if alive_only:
            nodes = [node for node in nodes if node.id not in self.net.down]
        return {node.state.state_root() for node in nodes}
