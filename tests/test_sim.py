from core.node import public_key
from core.types import USDC_SCALE
from sim.__main__ import MARKET, MOCK_COLLATERAL, build
from sim.bots import Bot

BALANCE = 1_000_000 * USDC_SCALE


def test_sim_cluster_commits_one_state_and_keeps_the_mock_balance() -> None:
    net, nodes, funded = build(4, (0, 0), 0.0, seed=0, traders=1)
    net.run_for(1_000)
    trader = public_key(funded[0]).hex()
    assert min(len(node.committed) for node in nodes) > 0
    assert len({node.state.state_root() for node in nodes}) == 1
    assert {node.state.accounts[trader].collateral for node in nodes} == {BALANCE}
    assert MOCK_COLLATERAL == BALANCE
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
    assert nodes[0].state.accounts[public_key(keys[0]).hex()].collateral == 1_000_106_999_013
    assert nodes[0].state.accounts[public_key(keys[1]).hex()].collateral == 999_777_186_442
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
