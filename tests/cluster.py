"""Test helper: build n Nodes on a MemoryNetwork and run them for a while."""

from __future__ import annotations

from core.net import MemoryNetwork
from core.node import Node


class Cluster:
    def __init__(self, n: int = 4, seed: int = 0, drop: float = 0.0) -> None:
        self.n = n
        self.net = MemoryNetwork(n, drop=drop, seed=seed)
        self.nodes: list[Node] = []
        raise NotImplementedError  # generate keys, build nodes, start them

    def run_for(self, ms: int) -> None:
        raise NotImplementedError

    def heights(self) -> list[int]:
        return [len(node.committed) for node in self.nodes]

    def state_roots(self, alive_only: bool = True) -> set[bytes]:
        raise NotImplementedError
