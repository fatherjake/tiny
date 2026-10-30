"""In-memory network for the sim and tests: one event loop, per-link delay, drop probability,
partitions and kills. Seeded so runs are reproducible. Implements core.net.Transport per node."""

from __future__ import annotations

import heapq
import random
from collections.abc import Callable

from core.net import Handler, Transport
from core.types import NodeId


class MemoryNetwork:
    """Shared bus. Call endpoint(i) to get node i's Transport."""

    def __init__(
        self, n: int, delay_ms: tuple[int, int] = (5, 50), drop: float = 0.0, seed: int = 0
    ) -> None:
        self.n = n
        self.delay_ms = delay_ms
        self.drop = drop
        self.rng = random.Random(seed)
        self.now = 0
        self.down: set[NodeId] = set()
        self.partitions: list[set[NodeId]] = []
        self._events: list[tuple[int, int]] = []
        self._fns: dict[int, Callable[[], None]] = {}
        self._seq = 0
        self._endpoints: dict[NodeId, Endpoint] = {}

    def endpoint(self, node_id: NodeId) -> Transport:
        endpoint = self._endpoints.get(node_id)
        if endpoint is None:
            endpoint = Endpoint(self, node_id)
            self._endpoints[node_id] = endpoint
        return endpoint

    def kill(self, node_id: NodeId) -> None:
        self.down.add(node_id)

    def revive(self, node_id: NodeId) -> None:
        self.down.discard(node_id)

    def partition(self, *groups: set[NodeId]) -> None:
        self.partitions = [set(group) for group in groups]

    def heal(self) -> None:
        self.partitions.clear()

    def call_later(self, delay_ms: int, fn: Callable[[], None]) -> int:
        self._seq += 1
        token = self._seq
        heapq.heappush(self._events, (self.now + delay_ms, token))
        self._fns[token] = fn
        return token

    def cancel(self, token: int) -> None:
        self._fns.pop(token, None)

    def run_for(self, ms: int) -> None:
        self.run_until(self.now + ms)

    def run_until(self, deadline: int) -> None:
        steps = 0
        while self._events and self._events[0][0] <= deadline:
            steps += 1
            if steps > 2_000_000:
                raise RuntimeError("network event loop did not settle")
            due, token = heapq.heappop(self._events)
            fn = self._fns.pop(token, None)
            if fn is None:
                continue
            self.now = due
            fn()
        self.now = deadline

    def send(self, sender: NodeId, to: NodeId, msg: object) -> None:
        if not self._accept(sender, to):
            return
        if sender != to and self.rng.random() < self.drop:
            return
        if sender == to:
            delay = 0
        else:
            delay = self.rng.randint(self.delay_ms[0], self.delay_ms[1])
        self.call_later(delay, lambda sender=sender, to=to, msg=msg: self._deliver(sender, to, msg))

    def _deliver(self, sender: NodeId, to: NodeId, msg: object) -> None:
        if not self._accept(sender, to):
            return
        endpoint = self._endpoints.get(to)
        if endpoint is not None and endpoint.handler is not None:
            endpoint.handler(sender, msg)

    def _accept(self, sender: NodeId, to: NodeId) -> bool:
        if sender in self.down or to in self.down:
            return False
        if sender == to or not self.partitions:
            return True
        return any(sender in group and to in group for group in self.partitions)


class Endpoint:
    """One node's view of the bus. Loopback is immediate and never dropped."""

    def __init__(self, net: MemoryNetwork, node_id: NodeId) -> None:
        self.net = net
        self.node_id = node_id
        self.handler: Handler | None = None

    def send(self, to: NodeId, msg: object) -> None:
        self.net.send(self.node_id, to, msg)

    def broadcast(self, msg: object) -> None:
        for peer in range(self.net.n):
            self.send(peer, msg)

    def on_message(self, handler: Handler) -> None:
        self.handler = handler

    def call_later(self, delay_ms: int, fn: Callable[[], None]) -> int:
        return self.net.call_later(delay_ms, fn)

    def cancel(self, token: int) -> None:
        self.net.cancel(token)

    def now_ms(self) -> int:
        return self.net.now
