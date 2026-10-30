"""In-memory network for the sim and tests: one event loop, per-link delay, drop probability,
partitions and kills. Seeded so runs are reproducible. Implements core.net.Transport per node."""

from __future__ import annotations

from core.net import Transport
from core.types import NodeId


class MemoryNetwork:
    """Shared bus. Call endpoint(i) to get node i's Transport."""

    def __init__(
        self, n: int, delay_ms: tuple[int, int] = (5, 50), drop: float = 0.0, seed: int = 0
    ) -> None:
        self.n = n
        self.delay_ms = delay_ms
        self.drop = drop
        self.seed = seed
        self.down: set[NodeId] = set()
        self.partitions: list[set[NodeId]] = []

    def endpoint(self, node_id: NodeId) -> Transport:
        raise NotImplementedError

    def kill(self, node_id: NodeId) -> None:
        raise NotImplementedError

    def revive(self, node_id: NodeId) -> None:
        raise NotImplementedError

    def partition(self, *groups: set[NodeId]) -> None:
        raise NotImplementedError

    def heal(self) -> None:
        raise NotImplementedError
