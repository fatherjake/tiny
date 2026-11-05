import time

import pytest

from core.node import Node, public_key
from core.types import USDC_SCALE
from sim.__main__ import MARKET, build, wall_clock
from sim.bots import Bot

BALANCE = 1_000_000 * USDC_SCALE


def test_sim_cluster_commits_one_state_and_keeps_the_deposit() -> None:
    net, nodes, funded = build(4, (0, 0), 0.0, seed=0, traders=1)
    net.run_for(1_000)
    trader = public_key(funded[0]).hex()
    assert min(len(node.committed) for node in nodes) > 0
    assert len({node.state.state_root() for node in nodes}) == 1
    assert {node.state.accounts[trader].collateral for node in nodes} == {BALANCE}
    assert {tuple(sorted(node.state.bridge.delivered)) for node in nodes} == {((1, 0),)}
    assert nodes[0].state.oracle_prices["BTC-PERP"] > 0


def test_bots_quote_both_sides_and_trade() -> None:
    net, nodes, keys = build(4, (0, 0), 0.0, seed=0, traders=2)
    bots = [Bot(key, MARKET.name, slot=i) for i, key in enumerate(keys)]
    for _ in range(120):
        net.run_for(50)
        for bot in bots:
            bot.step(nodes[0], net.now)
    net.run_for(1_000)
    book = nodes[0].state.books["BTC-PERP"]
    assert [len(node.committed) for node in nodes] == [138, 138, 138, 138]
    assert len({node.state.state_root() for node in nodes}) == 1
    assert book.depth(2) == {
        "bids": [(49_968_149_147, 382_377), (49_965_433_980, 187_867)],
        "asks": [(50_009_984_426, 228_198), (50_012_624_670, 432_066)],
    }
    assert nodes[0].state.accounts[public_key(keys[0]).hex()].collateral == 999_986_662_057
    assert nodes[0].state.accounts[public_key(keys[1]).hex()].collateral == 999_978_511_643
    assert next(iter(nodes[0].trades)) == {
        "seq": 1,
        "height": 42,
        "timestamp_ms": nodes[0].by_height[42].timestamp_ms,
        "market": "BTC-PERP",
        "side": "buy",
        "price": 50_028_634_410,
        "size": 37_519,
    }
    assert list(nodes[0].trades) == list(nodes[1].trades)
    oracle = nodes[0].state.oracle_prices["BTC-PERP"]
    assert all(abs(t["price"] - oracle) * 1_000 < 3 * oracle for t in nodes[0].trades)


def test_restart_keeps_node0_history_and_extends_the_chain(tmp_path) -> None:
    db = str(tmp_path / "sim.sqlite")
    net, nodes, funded = build(4, (0, 0), 0.0, seed=0, traders=1, db=db)
    wall_clock(nodes)  # as the sim runs it, so the restart is not refused as a 1970 db
    bot = Bot(funded[0], "BTC-PERP", slot=0)
    for _ in range(80):
        net.run_for(50)
        bot.step(nodes[0], net.now)
    net.run_for(1_000)
    height = nodes[0].state.height
    assert height > 2
    roots = {node.state.state_root() for node in nodes}
    assert len(roots) == 1
    trades = nodes[0].store.recent_trades("BTC-PERP", 20)
    assert trades
    assert nodes[0].store.tip_qc() is not None
    nodes[0].store.close()

    _net2, nodes2, _funded = build(4, (0, 0), 0.0, seed=0, traders=1, db=db)
    assert {node.state.height for node in nodes2} == {height}
    assert {node.state.state_root() for node in nodes2} == roots
    # Replayed once and copied, so each node still owns its state.
    assert len({id(node.state) for node in nodes2}) == 4
    assert nodes2[0].store.recent_trades("BTC-PERP", 20) == trades
    _net2.run_for(800)
    assert min(node.state.height for node in nodes2) > height
    assert len({node.state.state_root() for node in nodes2}) == 1
    nodes2[0].store.close()


def test_wall_clock_stamps_real_time_without_moving_the_network() -> None:
    net, nodes, _funded = build(1, (0, 0), 0.0, seed=0, traders=0)
    wall_clock(nodes)
    before = int(time.time() * 1000)
    first = nodes[0].consensus.now_ms()
    time.sleep(0.05)
    second = nodes[0].consensus.now_ms()
    assert net.now == 0
    assert abs(first - before) < 1_000
    assert second - first >= 40
    # Two stamps in the same millisecond still move forward.
    assert nodes[0].consensus.now_ms() < nodes[0].consensus.now_ms()


def test_wall_clock_refuses_a_chain_stamped_from_1970() -> None:
    net, nodes, _funded = build(4, (0, 0), 0.0, seed=0, traders=0)
    net.run_for(1_000)
    assert nodes[0].state.height > 0
    with pytest.raises(RuntimeError, match="1970"):
        wall_clock(nodes)


def test_restart_refuses_a_1970_db_before_replaying_it(tmp_path, monkeypatch) -> None:
    db = str(tmp_path / "sim.sqlite")
    net, nodes, _funded = build(4, (0, 0), 0.0, seed=0, traders=0, db=db)
    net.run_for(1_000)
    assert nodes[0].state.height > 0
    nodes[0].store.close()

    def replay(*_args: object) -> None:
        raise AssertionError("replayed before refusing")

    monkeypatch.setattr(Node, "resume", replay)
    with pytest.raises(RuntimeError, match="1970"):
        build(4, (0, 0), 0.0, seed=0, traders=0, db=db)
