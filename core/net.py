"""Transports. Nodes only see the Transport interface, so the same Node runs over TCP (one process
per validator) or on sim.net.MemoryNetwork (sim and tests).

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
