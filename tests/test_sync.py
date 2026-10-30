"""Catch-up: a new or lagging node reaches the same state root as a node that applied every block."""

from __future__ import annotations

import heapq
import json
from collections.abc import Callable
from dataclasses import replace

from core.net import Handler
from core.node import SYNC_TIMEOUT, Node, public_key
from core.state import State
from core.types import NodeId, Proposal, Snapshot, SyncBlocks, SyncRequest

KEY = tuple((i + 1).to_bytes(32, "big") for i in range(4))


class FakeNet:
    """In-process bus with a manual clock. `tick` advances one second unless given a delay."""

    def __init__(self) -> None:
        self.now = 0
        self.handlers: dict[NodeId, Handler] = {}
        self.queue: list[tuple[NodeId, NodeId, object]] = []
        self.held: list[tuple[NodeId, NodeId, object]] = []
        self.sent: list[tuple[NodeId, NodeId, object]] = []
        self.events: list[tuple[int, int]] = []
        self.fns: dict[int, Callable[[], None]] = {}
        self.silent: set[NodeId] = set()
        self.seq = 0
        self.pumping = False

    def endpoint(self, node_id: NodeId) -> FakeTransport:
        return FakeTransport(self, node_id)

    def call_later(self, delay_ms: int, fn: Callable[[], None]) -> int:
        self.seq += 1
        token = self.seq
        heapq.heappush(self.events, (self.now + delay_ms, token))
        self.fns[token] = fn
        return token

    def cancel(self, token: int) -> None:
        self.fns.pop(token, None)

    def tick(self, ms: int = 1000) -> None:
        self.run_for(ms)

    def run_for(self, ms: int) -> None:
        deadline = self.now + ms
        steps = 0
        while self.events and self.events[0][0] <= deadline:
            steps += 1
            if steps > 2_000_000:
                raise RuntimeError("fake net did not settle")
            due, token = heapq.heappop(self.events)
            self.now = due
            fn = self.fns.pop(token, None)
            if fn is not None:
                fn()
        self.now = deadline

    def send(self, sender: NodeId, to: NodeId, msg: object) -> None:
        self.sent.append((sender, to, msg))
        if to in self.silent:
            self.held.append((sender, to, msg))
            return
        self.queue.append((sender, to, msg))
        if not self.pumping:
            self._pump()

    def release(self) -> None:
        self.silent.clear()
        self.queue.extend(self.held)
        self.held.clear()
        self._pump()

    def _pump(self) -> None:
        self.pumping = True
        try:
            while self.queue:
                sender, to, msg = self.queue.pop(0)
                handler = self.handlers.get(to)
                if handler is not None:
                    handler(sender, msg)
        finally:
            self.pumping = False


class FakeTransport:
    def __init__(self, net: FakeNet, node_id: NodeId) -> None:
        self.net = net
        self.node_id = node_id

    def send(self, to: NodeId, msg: object) -> None:
        self.net.send(self.node_id, to, msg)

    def broadcast(self, msg: object) -> None:
        for peer in list(self.net.handlers):
            self.send(peer, msg)

    def on_message(self, handler: Handler) -> None:
        self.net.handlers[self.node_id] = handler

    def call_later(self, delay_ms: int, fn: Callable[[], None]) -> int:
        return self.net.call_later(delay_ms, fn)

    def cancel(self, token: int) -> None:
        self.net.cancel(token)

    def now_ms(self) -> int:
        return self.net.now

    def tick(self, ms: int = 1000) -> None:
        self.net.tick(ms)


def run_chain(height: int, n: int = 4) -> tuple[FakeNet, list[Node]]:
    net = FakeNet()
    pubs = {i: public_key(KEY[i]) for i in range(n)}
    nodes = [Node(i, n, KEY[i], pubs, [], net.endpoint(i)) for i in range(n)]
    for node in nodes:
        node.start()
    steps = 0
    while min(node.state.height for node in nodes) < height:
        net.tick(50)
        steps += 1
        if steps > height * 40:
            stuck = [node.state.height for node in nodes]
            raise AssertionError(f"chain stuck at {stuck}")
    return net, nodes


def joiner(net: FakeNet, nodes: list[Node]) -> Node:
    pubs = dict(nodes[0].validator_pubkeys)
    pubs.pop(99, None)
    return Node(99, len(nodes), (99).to_bytes(32, "big"), pubs, [], net.endpoint(99))


def test_fresh_node_syncs_from_height_250_by_snapshot() -> None:
    net, nodes = run_chain(250)
    source = nodes[0]
    fresh = joiner(net, nodes)
    fresh.start()
    snaps = [msg for _src, dest, msg in net.sent if dest == fresh.id and isinstance(msg, Snapshot)]
    batches = [
        msg for _src, dest, msg in net.sent if dest == fresh.id and isinstance(msg, SyncBlocks)
    ]
    assert snaps
    assert snaps[0].height >= 100
    assert snaps[0].height % 100 == 0
    assert batches
    assert all(len(batch.blocks) <= 100 for batch in batches)
    assert batches[-1].blocks[-1].height == source.state.height
    assert 1 not in fresh.by_height
    assert fresh.state.height == source.state.height
    assert fresh.state.state_root() == source.state.state_root()


def test_node_three_behind_fetches_the_gap_before_applying_the_future_block() -> None:
    net, nodes = run_chain(6)
    source = nodes[0]
    lag = joiner(net, nodes)
    have = tuple(source.by_height[height] for height in range(1, 4))
    lag.on_message(0, SyncBlocks(have))
    assert lag.state.height == 3
    future = source.by_height[6]
    net.silent.add(future.proposer)
    lag.on_message(future.proposer, Proposal(future))
    assert lag.state.height == 3
    asked = [
        msg
        for _src, dest, msg in net.sent
        if dest == future.proposer and isinstance(msg, SyncRequest)
    ]
    assert asked[-1].from_height == 4
    net.release()
    assert lag.state.height == source.state.height
    assert lag.state.state_root() == source.state.state_root()


def test_sync_response_never_exceeds_100_blocks() -> None:
    net, nodes = run_chain(150)
    source = nodes[0]
    start = len(net.sent)
    source.on_message(1, SyncRequest(1, 10_000))
    batches = [
        msg for _src, dest, msg in net.sent[start:] if dest == 1 and isinstance(msg, SyncBlocks)
    ]
    assert batches
    assert len(batches[0].blocks) <= 100
    assert len(batches[0].blocks) < source.state.height
    assert batches[0].blocks[0].height > 1


def test_sync_requests_are_rate_limited_per_peer() -> None:
    net, nodes = run_chain(2)
    node = nodes[0]
    # Startup requests already spent this second's budget. Move the clock without
    # delivering those timers, so the flood is the only traffic in the new second.
    net.now = net.now // 1000 * 1000 + 1000

    def replies() -> int:
        return sum(
            1
            for _src, dest, msg in net.sent
            if dest == 1 and isinstance(msg, (Snapshot, SyncBlocks))
        )

    base = replies()
    node.on_message(1, SyncRequest(1, 100))
    one = replies() - base
    assert one >= 1
    for _ in range(4):
        node.on_message(1, SyncRequest(1, 100))
    assert replies() - base == 5 * one
    node.on_message(1, SyncRequest(1, 100))
    assert replies() - base == 5 * one
    net.tick()
    mid = replies()
    node.on_message(1, SyncRequest(1, 100))
    assert replies() == mid + one


def test_tampered_snapshot_is_rejected_and_a_good_one_is_applied() -> None:
    net, nodes = run_chain(120)
    source = nodes[0]
    snap = source.latest_snapshot
    assert snap is not None
    raw = json.loads(snap.state_bytes)
    raw["next_order_id"] = raw["next_order_id"] + 1
    bad_bytes = json.dumps(raw, sort_keys=True, separators=(",", ":")).encode()
    header = source.by_height[snap.height]
    assert State.from_bytes(bad_bytes).state_root() != header.state_root
    blocks = tuple(
        source.by_height[height] for height in range(snap.height, source.state.height + 1)
    )
    fresh = joiner(net, nodes)
    fresh.on_message(0, Snapshot(snap.height, bad_bytes))
    fresh.on_message(0, SyncBlocks(blocks))
    assert fresh.state.height == 0
    fresh.on_message(0, snap)
    fresh.on_message(0, SyncBlocks(blocks))
    assert fresh.state.height == source.state.height
    assert fresh.state.state_root() == source.state.state_root()


def test_block_with_a_bad_qc_is_rejected() -> None:
    net, nodes = run_chain(4)
    source = nodes[0]
    fresh = joiner(net, nodes)
    block = source.by_height[1]
    bad = replace(block, qc=replace(block.qc, sigs={0: b"not-a-signature"}))
    fresh.on_message(0, SyncBlocks((bad,)))
    assert fresh.state.height == 0
    good = tuple(source.by_height[height] for height in range(1, source.state.height + 1))
    fresh.on_message(0, SyncBlocks(good))
    assert fresh.state.height == source.state.height
    assert fresh.state.state_root() == source.state.state_root()


def test_silent_peer_is_retried_with_another_peer() -> None:
    net = FakeNet()
    pubs = {i: public_key(KEY[i]) for i in range(3)}
    node = Node(2, 3, KEY[2], pubs, [], net.endpoint(2))
    node.start()
    to_first = [msg for _src, dest, msg in net.sent if dest == 0 and isinstance(msg, SyncRequest)]
    to_second = [msg for _src, dest, msg in net.sent if dest == 1 and isinstance(msg, SyncRequest)]
    assert len(to_first) == 1
    assert to_second == []
    net.tick(SYNC_TIMEOUT)
    to_second = [msg for _src, dest, msg in net.sent if dest == 1 and isinstance(msg, SyncRequest)]
    assert len(to_second) == 1
    assert to_second[0].from_height == 1
