import logging
import os
import sqlite3
import threading
import time

import pytest

from core.node import Node, public_key
from core.store import with_progress
from core.types import USDC_SCALE
from sim.__main__ import MARKET, build, shutdown, wall_clock
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


def test_restart_logs_each_startup_stage(tmp_path, caplog) -> None:
    db = str(tmp_path / "sim.sqlite")
    with caplog.at_level(logging.INFO):
        net, nodes, _funded = build(4, (0, 0), 0.0, seed=0, traders=0, db=db)
        assert "no saved blocks, starting from genesis" in caplog.messages
        wall_clock(nodes)
        net.run_for(1_000)
        height = nodes[0].state.height
        assert height > 0
        nodes[0].store.close()

        caplog.clear()
        _net2, nodes2, _funded = build(4, (0, 0), 0.0, seed=0, traders=0, db=db)
        nodes2[0].store.close()
    for expected in (
        f"reading saved blocks from {db} from height 1...",
        f"replaying {height} blocks...",
        "copying state to 3 other nodes...",
        f"resumed at height {height}",
    ):
        assert expected in caplog.messages


def _run_and_restart(db: str) -> tuple[int, list[Node]]:
    net, nodes, _funded = build(4, (0, 0), 0.0, seed=0, traders=1, db=db)
    wall_clock(nodes)
    net.run_for(1_000)
    height = nodes[0].state.height
    nodes[0].store.close()
    net2, nodes2, _funded = build(4, (0, 0), 0.0, seed=0, traders=1, db=db)
    net2.run_for(500)
    nodes2[0].store.close()
    return height, nodes2


def test_restart_replays_only_the_blocks_after_the_last_snapshot(
    tmp_path, caplog, monkeypatch
) -> None:
    monkeypatch.setattr("core.node.SNAPSHOT_EVERY", 5)
    db = str(tmp_path / "sim.sqlite")
    with caplog.at_level(logging.INFO):
        height, nodes = _run_and_restart(db)
    snapped = height - height % 5
    assert height > 5
    assert f"reading saved blocks from {db} from height {snapped}..." in caplog.messages
    assert f"replaying {height - snapped} blocks..." in caplog.messages
    assert f"resumed at height {height}" in caplog.messages
    assert [node.state.height > height for node in nodes] == [True, True, True, True]
    assert len({node.state.state_root() for node in nodes}) == 1


def test_restart_from_a_snapshot_matches_a_full_replay(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("core.node.SNAPSHOT_EVERY", 5)
    db = str(tmp_path / "sim.sqlite")
    net, nodes, _funded = build(4, (0, 0), 0.0, seed=0, traders=1, db=db)
    wall_clock(nodes)
    net.run_for(1_000)
    root = nodes[0].state.state_root()
    nodes[0].store.close()
    _net, from_snapshot, _funded = build(4, (0, 0), 0.0, seed=0, traders=1, db=db)
    from_snapshot[0].store.close()
    db_full = sqlite3.connect(db)
    db_full.execute("DELETE FROM snapshot")
    db_full.commit()
    db_full.close()
    _net, from_genesis, _funded = build(4, (0, 0), 0.0, seed=0, traders=1, db=db)
    from_genesis[0].store.close()
    assert from_snapshot[0].state.state_root() == root
    assert from_genesis[0].state.state_root() == root


def test_a_snapshot_that_does_not_match_its_block_falls_back_to_a_full_replay(
    tmp_path, caplog, monkeypatch
) -> None:
    monkeypatch.setattr("core.node.SNAPSHOT_EVERY", 5)
    db = str(tmp_path / "sim.sqlite")
    net, nodes, _funded = build(4, (0, 0), 0.0, seed=0, traders=1, db=db)
    wall_clock(nodes)
    net.run_for(1_000)
    height, root = nodes[0].state.height, nodes[0].state.state_root()
    nodes[0].store.close()
    tamper = sqlite3.connect(db)
    snap_height, body = tamper.execute("SELECT height, state FROM snapshot").fetchone()
    tamper.execute("UPDATE snapshot SET state = ?", (bytes(body).replace(b"1", b"2", 1),))
    tamper.commit()
    tamper.close()
    with caplog.at_level(logging.INFO):
        _net, again, _funded = build(4, (0, 0), 0.0, seed=0, traders=1, db=db)
    again[0].store.close()
    assert (
        f"snapshot at height {snap_height} does not match its block, replaying all"
        in caplog.messages
    )
    assert f"replaying {height} blocks..." in caplog.messages
    assert again[0].state.state_root() == root


def test_a_slow_loop_logs_how_far_it_has_got(caplog) -> None:
    with caplog.at_level(logging.INFO):
        assert list(with_progress("abcd", 4, "read blocks", every_s=0)) == list("abcd")
    assert caplog.messages[1].startswith("read blocks 2/4 (50%), about ")


def test_a_quick_loop_logs_nothing(caplog) -> None:
    with caplog.at_level(logging.INFO):
        list(with_progress("abcd", 4, "read blocks"))
    assert caplog.messages == []


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


def test_shutdown_folds_the_wal_into_the_db_and_keeps_every_block(tmp_path) -> None:
    db = str(tmp_path / "sim.sqlite")
    net, nodes, _funded = build(4, (0, 0), 0.0, seed=0, traders=0, db=db)
    wall_clock(nodes)
    net.run_for(1_000)
    height = nodes[0].state.height
    assert [os.path.exists(db + "-wal"), height > 0] == [True, True]
    shutdown(nodes, threading.Event(), threading.RLock())
    assert [os.path.exists(db + "-wal"), os.path.exists(db + "-shm")] == [False, False]
    saved = sqlite3.connect(db)
    assert saved.execute("SELECT MAX(height) FROM blocks").fetchone()[0] == height
    saved.close()


def test_ctrl_c_during_the_replay_closes_the_db(tmp_path, monkeypatch) -> None:
    db = str(tmp_path / "sim.sqlite")
    net, nodes, _funded = build(4, (0, 0), 0.0, seed=0, traders=0, db=db)
    wall_clock(nodes)
    net.run_for(1_000)
    height = nodes[0].state.height
    shutdown(nodes, threading.Event(), threading.RLock())

    def interrupted(*_args: object) -> None:
        raise KeyboardInterrupt

    monkeypatch.setattr(Node, "resume", interrupted)
    with pytest.raises(KeyboardInterrupt):
        build(4, (0, 0), 0.0, seed=0, traders=0, db=db)
    assert [os.path.exists(db + "-wal"), os.path.exists(db + "-shm")] == [False, False]
    saved = sqlite3.connect(db)
    assert saved.execute("SELECT MAX(height) FROM blocks").fetchone()[0] == height
    saved.close()
