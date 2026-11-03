"""Fault scenarios. Each checks liveness (commits keep happening) and safety (every live node has
the same committed chain and state root)."""

from core.types import Block
from tests.cluster import Cluster


def test_happy_path_commits():
    c = Cluster(n=4)
    c.run_for(2_000)
    assert min(c.heights()) > 10
    assert len(c.state_roots()) == 1


def test_one_crashed_node_stays_live():
    c = Cluster(n=4)
    c.net.kill(3)
    c.run_for(5_000)
    assert min(c.heights()[:3]) > 5
    assert len(c.state_roots()) == 1


def test_two_crashed_nodes_halt_but_stay_safe():
    c = Cluster(n=4)
    c.run_for(1_000)
    before = c.heights()
    c.net.kill(2)
    c.net.kill(3)
    c.run_for(3_000)
    assert c.heights()[:2] == before[:2]


def test_partition_heals():
    c = Cluster(n=4)
    c.net.partition({0, 1}, {2, 3})
    c.run_for(2_000)
    c.net.heal()
    c.run_for(3_000)
    assert len(c.state_roots(alive_only=False)) == 1


def test_lossy_network_stays_safe():
    c = Cluster(n=4, drop=0.2, seed=1)
    c.run_for(10_000)
    assert len(c.state_roots()) == 1


def test_work_per_block_does_not_grow_with_the_chain(monkeypatch):
    calls = 0
    real = Block.hash.fget

    def counted(block: Block) -> bytes:
        nonlocal calls
        calls += 1
        return real(block)

    monkeypatch.setattr(Block, "hash", property(counted))
    c = Cluster(n=4)

    def hashes_per_block(ms: int) -> float:
        nonlocal calls
        calls, start = 0, min(c.heights())
        c.run_for(ms)
        return calls / max(1, min(c.heights()) - start)

    early = hashes_per_block(1_000)
    c.run_for(6_000)
    late = hashes_per_block(1_000)
    assert late < 2 * early
