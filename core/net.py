"""Transports. Nodes only see the Transport interface, so the same Node runs in-memory (sim and
tests) or over TCP (one process per validator).

- MemoryNetwork: one event loop, per-link delay, drop probability, partitions and kills. Seeded so
  test runs are reproducible.
- TcpTransport: length-prefixed frames over asyncio streams.

Budget: < 1,000 lines.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from core.types import NodeId

Handler = Callable[[NodeId, object], None]  # (sender, message)


class Transport(Protocol):
    def send(self, to: NodeId, msg: object) -> None: ...
    def broadcast(self, msg: object) -> None: ...
    def on_message(self, handler: Handler) -> None: ...


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


class TcpTransport:
    def __init__(self, node_id: NodeId, peers: dict[NodeId, tuple[str, int]]) -> None:
        self.node_id = node_id
        self.peers = peers

    def send(self, to: NodeId, msg: object) -> None:
        raise NotImplementedError

    def broadcast(self, msg: object) -> None:
        raise NotImplementedError

    def on_message(self, handler: Handler) -> None:
        raise NotImplementedError
