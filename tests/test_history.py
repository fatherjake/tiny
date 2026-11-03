"""History routes read the store. The sim's node uses MemoryStore."""

import pytest
from fastapi import HTTPException

from core.api import create_app
from core.node import public_key, sign_tx
from core.store import MemoryStore
from core.types import USDC_SCALE, CancelOrder, OrderType, Side
from tests.test_node import make_node
from tests.test_state import ALICE, BOB, ONE, PX, block, fund, place


def test_trade_and_order_routes_page_by_cursor() -> None:
    alice = public_key(ALICE).hex()
    bob = public_key(BOB).hex()
    node, _transport = make_node()
    assert isinstance(node.store, MemoryStore)
    for key in (ALICE, BOB):
        fund(node.state, key, 20_000 * USDC_SCALE)
    app = create_app(node)
    routes = {route.path: route.endpoint for route in app.routes if hasattr(route, "path")}
    blocks = [
        block(
            1,
            place(ALICE, 1, 1, Side.SELL, PX, 2 * ONE),
            place(ALICE, 3, 9, Side.BUY, PX, ONE),
            place(BOB, 1, 2, Side.BUY, PX, ONE, OrderType.MARKET),
            timestamp_ms=1_000,
        ),
        block(2, place(BOB, 2, 3, Side.BUY, PX, ONE, OrderType.MARKET), timestamp_ms=60_000),
        block(3, place(ALICE, 2, 7, Side.BUY, PX, ONE), timestamp_ms=120_000),
    ]
    for item in blocks:
        node.on_commit(item)
    newest = {
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
    older = {**newest, "id": 1, "height": 1, "tx_index": 2, "ts": 1_000}
    assert routes["/trades/{market}"]("BTC-PERP", limit=1) == [newest]
    assert routes["/trades/{market}"]("BTC-PERP", before_height=2, before_tx=0, before_id=2) == [
        older
    ]
    assert routes["/trades/{market}"]("ETH-PERP") == []
    assert routes["/accounts/{addr}/fills"](bob, limit=10) == [newest, older]
    assert routes["/accounts/{addr}/fills"]("nobody") == []
    resting = {
        "order_id": 7,
        "trader": alice,
        "market": "BTC-PERP",
        "side": "buy",
        "type": "limit",
        "price": PX,
        "size": ONE,
        "remaining": ONE,
        "status": "placed",
        "reason": "",
        "created_height": 3,
        "updated_height": 3,
    }
    assert routes["/accounts/{addr}/orders"](alice, status="open") == [resting]
    node.on_commit(
        block(4, sign_tx(ALICE, CancelOrder(alice, "BTC-PERP", 7), 3), timestamp_ms=180_000)
    )
    assert routes["/accounts/{addr}/orders"](alice, status="open") == []
    history = routes["/accounts/{addr}/orders"](alice, status="history", limit=1)
    assert history == [
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
        }
    ]
    page = routes["/accounts/{addr}/orders"](alice, before_height=4, before_order=7, limit=1)
    assert page[0]["order_id"] == 1
    assert page[0]["status"] == "filled"
    candles = routes["/candles/{market}"]("BTC-PERP", interval="1m")
    assert candles == [
        {"ts": 0, "open": PX, "high": PX, "low": PX, "close": PX, "volume": ONE},
        {"ts": 60_000, "open": PX, "high": PX, "low": PX, "close": PX, "volume": ONE},
    ]
    assert routes["/candles/{market}"]("BTC-PERP", interval="1s") == [
        {"ts": 1_000, "open": PX, "high": PX, "low": PX, "close": PX, "volume": ONE},
        {"ts": 60_000, "open": PX, "high": PX, "low": PX, "close": PX, "volume": ONE},
    ]
    assert routes["/funding/{market}"]("BTC-PERP") == []
    with pytest.raises(HTTPException) as bad_cursor:
        routes["/trades/{market}"]("BTC-PERP", before_height=1)
    assert bad_cursor.value.status_code == 400
    with pytest.raises(HTTPException) as bad_interval:
        routes["/candles/{market}"]("BTC-PERP", interval="2s")
    assert bad_interval.value.status_code == 400


def test_the_sim_serves_history_from_its_memory_store() -> None:
    from sim.__main__ import MARKET, build
    from sim.bots import Bot

    net, nodes, keys = build(4, (0, 0), 0.0, seed=0, traders=2)
    assert isinstance(nodes[0].store, MemoryStore)
    bots = [Bot(key, MARKET.name, slot=i) for i, key in enumerate(keys)]
    for _ in range(80):
        net.run_for(50)
        for bot in bots:
            bot.step(nodes[0], net.now)
    net.run_for(1_000)
    app = create_app(nodes[0])
    trades = next(
        route.endpoint for route in app.routes if getattr(route, "path", None) == "/trades/{market}"
    )
    rows = trades("BTC-PERP", limit=5)
    assert rows == nodes[0].store.recent_trades("BTC-PERP", 5)
    assert rows[0]["market"] == "BTC-PERP"
    assert rows[0]["side"] in ("buy", "sell")
    assert int(rows[0]["height"]) > 0
    assert rows[0]["liquidation"] is False
