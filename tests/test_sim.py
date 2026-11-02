import time

from core.node import public_key
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
        "bids": [(49_938_525_367, 129_050), (49_734_260_013, 250_964)],
        "asks": [(50_056_622_280, 175_778), (50_282_307_926, 132_203)],
    }
    assert nodes[0].state.accounts[public_key(keys[0]).hex()].collateral == 1_000_107_012_639
    assert nodes[0].state.accounts[public_key(keys[1]).hex()].collateral == 999_777_172_763
    assert next(iter(nodes[0].trades)) == {
        "seq": 1,
        "height": 42,
        "timestamp_ms": nodes[0].by_height[42].timestamp_ms,
        "market": "BTC-PERP",
        "side": "buy",
        "price": 50_217_026_939,
        "size": 351_622,
    }
    assert list(nodes[0].trades) == list(nodes[1].trades)


def test_restart_keeps_node0_history_and_extends_the_chain(tmp_path) -> None:
    db = str(tmp_path / "sim.sqlite")
    net, nodes, funded = build(4, (0, 0), 0.0, seed=0, traders=1, db=db)
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
    assert nodes2[0].store.recent_trades("BTC-PERP", 20) == trades
    _net2.run_for(800)
    assert min(node.state.height for node in nodes2) > height
    assert len({node.state.state_root() for node in nodes2}) == 1
    nodes2[0].store.close()


def test_wall_clock_advances_block_time_without_moving_the_network() -> None:
    net, nodes, _funded = build(1, (0, 0), 0.0, seed=0, traders=0)
    wall_clock(nodes)
    first = nodes[0].consensus.now_ms()
    time.sleep(0.05)
    second = nodes[0].consensus.now_ms()
    assert net.now == 0
    assert second - first >= 40
