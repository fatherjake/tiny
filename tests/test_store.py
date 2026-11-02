"""Index tables follow the block log and can be rebuilt from it."""

import sqlite3

import pytest

from core.node import public_key, sign_tx
from core.state import HOUR_MS, State
from core.store import MemoryStore, SqliteStore
from core.types import USDC_SCALE, Block, CancelOrder, OrderType, Side
from tests.test_node import make_node
from tests.test_state import ALICE, BOB, MARKET, ONE, PX, VALIDATOR, block, fund, oracle, place

SELL = Side.SELL
BUY = Side.BUY
LIMIT = OrderType.LIMIT
MARKET_ORDER = OrderType.MARKET


def _genesis(store: MemoryStore | SqliteStore) -> State:
    state = State(store.markets, store.validators)
    for key in (ALICE, BOB):
        fund(state, key, 20_000 * USDC_SCALE)
    return state


def _load(store: MemoryStore | SqliteStore, blocks: list[Block]) -> None:
    state = _genesis(store)
    for item in blocks:
        state.apply_block(item)
        store.append_block(item, tuple(state.events))


def _trades() -> list[Block]:
    return [
        block(
            1,
            place(ALICE, 1, 1, SELL, PX, 2 * ONE),
            place(ALICE, 3, 9, BUY, PX, ONE),
            place(BOB, 1, 2, BUY, PX, ONE, MARKET_ORDER),
            timestamp_ms=1_000,
        ),
        block(2, place(BOB, 2, 3, BUY, PX, ONE, MARKET_ORDER), timestamp_ms=60_000),
        block(3, place(ALICE, 2, 7, BUY, PX, ONE), timestamp_ms=120_000),
        block(
            4,
            sign_tx(ALICE, CancelOrder(public_key(ALICE).hex(), "BTC-PERP", 7), 3),
            timestamp_ms=180_000,
        ),
    ]


def test_rebuild_matches_live_rows_and_a_reopen_keeps_them(tmp_path) -> None:
    alice = public_key(ALICE).hex()
    bob = public_key(BOB).hex()
    blocks = _trades()
    memory = MemoryStore([MARKET])
    sqlite = SqliteStore(tmp_path / "tiny.sqlite", [MARKET])
    _load(memory, blocks)
    _load(sqlite, blocks)

    first = {
        "id": 1,
        "height": 1,
        "tx_index": 2,
        "market": "BTC-PERP",
        "price": PX,
        "size": ONE,
        "taker": bob,
        "maker": alice,
        "side": "buy",
        "liquidation": False,
        "ts": 1_000,
    }
    second = {
        "id": 2,
        "height": 2,
        "tx_index": 0,
        "market": "BTC-PERP",
        "price": PX,
        "size": ONE,
        "taker": bob,
        "maker": alice,
        "side": "buy",
        "liquidation": False,
        "ts": 60_000,
    }
    assert memory.recent_trades("BTC-PERP", 10) == [second, first]
    assert sqlite.recent_trades("BTC-PERP", 10) == [second, first]
    assert sqlite.recent_trades("BTC-PERP", 1) == [second]
    assert sqlite.recent_trades("BTC-PERP", 10, before=(2, 0, 2)) == [first]
    assert sqlite.trades_for(bob, 10, None) == [second, first]
    assert sqlite.trades_for("nobody", 10, None) == []

    alice_orders = [
        {
            "order_id": 7,
            "trader": alice,
            "market": "BTC-PERP",
            "side": "buy",
            "type": "limit",
            "price": PX,
            "size": ONE,
            "remaining": 0,
            "status": "cancelled",
            "reason": "",
            "created_height": 3,
            "updated_height": 4,
        },
        {
            "order_id": 1,
            "trader": alice,
            "market": "BTC-PERP",
            "side": "sell",
            "type": "limit",
            "price": PX,
            "size": 2 * ONE,
            "remaining": 0,
            "status": "filled",
            "reason": "",
            "created_height": 1,
            "updated_height": 2,
        },
        {
            "order_id": 9,
            "trader": alice,
            "market": "BTC-PERP",
            "side": "buy",
            "type": "limit",
            "price": PX,
            "size": ONE,
            "remaining": ONE,
            "status": "rejected",
            "reason": "nonce",
            "created_height": 1,
            "updated_height": 1,
        },
    ]
    assert memory.order_history(alice, 10, None) == alice_orders
    assert sqlite.order_history(alice, 10, None) == alice_orders
    assert sqlite.order_history(alice, 10, (2, 1)) == [alice_orders[2]]
    assert sqlite.open_orders(alice) == []
    assert memory.open_orders(bob) == []

    candles = [
        {"ts": 0, "open": PX, "high": PX, "low": PX, "close": PX, "volume": ONE},
        {"ts": 60_000, "open": PX, "high": PX, "low": PX, "close": PX, "volume": ONE},
    ]
    assert memory.candles("BTC-PERP", "1m", None, None) == candles
    assert sqlite.candles("BTC-PERP", "1m", None, None) == candles
    assert sqlite.candles("BTC-PERP", "1m", 60_000, None) == [candles[1]]
    assert sqlite.candles("BTC-PERP", "1h", None, None) == [
        {"ts": 0, "open": PX, "high": PX, "low": PX, "close": PX, "volume": 2 * ONE}
    ]
    assert memory.candles("BTC-PERP", "1s", None, None) == [
        {"ts": 1_000, "open": PX, "high": PX, "low": PX, "close": PX, "volume": ONE},
        {"ts": 60_000, "open": PX, "high": PX, "low": PX, "close": PX, "volume": ONE},
    ]

    memory.rebuild_indexes(_genesis(memory))
    sqlite.rebuild_indexes(_genesis(sqlite))
    assert memory.recent_trades("BTC-PERP", 10) == [second, first]
    assert sqlite.order_history(alice, 10, None) == alice_orders
    assert sqlite.candles("BTC-PERP", "1m", None, None) == candles
    assert sqlite.funding_history("BTC-PERP", 10) == []

    sqlite.close()
    reopened = SqliteStore(tmp_path / "tiny.sqlite", [MARKET])
    assert reopened.recent_trades("BTC-PERP", 10) == [second, first]
    assert reopened.order_history(alice, 10, None) == alice_orders
    reopened.close()


def test_funding_history_rebuilds_from_the_log(tmp_path) -> None:
    validators = {public_key(VALIDATOR).hex()}
    blocks = [
        block(
            1,
            place(ALICE, 1, 1, BUY, 130, ONE),
            place(BOB, 1, 2, SELL, 140, ONE),
            oracle(1, price=100),
            timestamp_ms=1_000,
        ),
        block(2, timestamp_ms=1_000 + HOUR_MS),
    ]
    store = SqliteStore(tmp_path / "fund.sqlite", [MARKET], validators)
    _load(store, blocks)
    history = [{"height": 2, "market": "BTC-PERP", "index": 30, "rate": 30, "ts": 1_000 + HOUR_MS}]
    assert store.funding_history("BTC-PERP", 10) == history
    store.rebuild_indexes(_genesis(store))
    assert store.funding_history("BTC-PERP", 10) == history
    assert store.funding_since("BTC-PERP", 1_000) == history[0]
    assert store.funding_since("BTC-PERP", 2_000 + HOUR_MS) is None
    store.close()


def test_a_file_from_an_older_schema_is_refused(tmp_path) -> None:
    path = tmp_path / "old.sqlite"
    SqliteStore(path, [MARKET]).close()
    db = sqlite3.connect(path)
    db.execute("ALTER TABLE orders DROP COLUMN reason")
    db.close()
    with pytest.raises(RuntimeError, match="older version"):
        SqliteStore(path, [MARKET])


def test_a_preview_does_not_append_and_a_commit_does(tmp_path) -> None:
    node, _transport = make_node()
    node.store = SqliteStore(tmp_path / "node.sqlite", [MARKET], node.state.validators)
    for key in (ALICE, BOB):
        fund(node.state, key, 20_000 * USDC_SCALE)
    item = block(
        1,
        place(ALICE, 1, 1, SELL, PX, ONE),
        place(BOB, 1, 2, BUY, PX, ONE, MARKET_ORDER),
        timestamp_ms=5_000,
    )
    assert node.preview_root(item) is not None
    assert node.store.recent_trades("BTC-PERP", 5) == []
    node.on_commit(item)
    trades = node.store.recent_trades("BTC-PERP", 5)
    assert trades == [
        {
            "id": 1,
            "height": 1,
            "tx_index": 1,
            "market": "BTC-PERP",
            "price": PX,
            "size": ONE,
            "taker": public_key(BOB).hex(),
            "maker": public_key(ALICE).hex(),
            "side": "buy",
            "liquidation": False,
            "ts": 5_000,
        }
    ]
    with pytest.raises(sqlite3.IntegrityError):
        node.store.append_block(item, ())
    assert node.store.recent_trades("BTC-PERP", 5) == trades
    node.store.close()


def test_unknown_candle_interval_is_rejected(tmp_path) -> None:
    store = SqliteStore(tmp_path / "empty.sqlite", [MARKET])
    memory = MemoryStore([MARKET])
    try:
        for candidate in (store, memory):
            with pytest.raises(ValueError):
                candidate.candles("BTC-PERP", "2s", None, None)
    finally:
        store.close()


@pytest.mark.parametrize("kind", ["memory", "sqlite"])
def test_two_traders_can_use_the_same_order_id_and_reasons_are_kept(tmp_path, kind) -> None:
    alice = public_key(ALICE).hex()
    bob = public_key(BOB).hex()
    store = (
        MemoryStore([MARKET])
        if kind == "memory"
        else SqliteStore(tmp_path / "ids.sqlite", [MARKET])
    )
    state = State([MARKET])
    fund(state, BOB, 10_000 * USDC_SCALE)
    item = block(1, place(ALICE, 1, 7, BUY, PX, ONE), place(BOB, 1, 7, BUY, PX, ONE))
    state.apply_block(item)
    store.append_block(item, tuple(state.events))
    rows = {who: store.order_history(who, 10) for who in (alice, bob)}
    assert [(row["order_id"], row["status"], row["reason"]) for row in rows[alice]] == [
        (7, "rejected", "margin")
    ]
    assert [(row["order_id"], row["status"], row["reason"]) for row in rows[bob]] == [
        (7, "placed", "")
    ]
