from core.book import OrderBook
from core.types import Order, OrderType, Side


def order(
    order_id: int,
    side: Side,
    price: int,
    size: int,
    trader: str = "alice",
    order_type: OrderType = OrderType.LIMIT,
    reduce_only: bool = False,
) -> Order:
    return Order(order_id, trader, "BTC-PERP", side, order_type, price, size, reduce_only)


def test_price_time_priority_and_maker_price() -> None:
    book = OrderBook("BTC-PERP")
    book.place(order(1, Side.BUY, 100, 4, trader="ann"))
    book.place(order(2, Side.BUY, 100, 4, trader="bob"))
    book.place(order(3, Side.BUY, 101, 1, trader="cam"))
    fills = book.place(order(4, Side.SELL, 90, 3, trader="dan"))
    assert [(fill.maker_order, fill.price, fill.size) for fill in fills] == [
        (3, 101, 1),
        (1, 100, 2),
    ]
    assert book.orders[1].size == 2
    assert book.orders[2].size == 4
    assert 4 not in book.orders


def test_market_orders_take_and_never_rest() -> None:
    book = OrderBook("BTC-PERP")
    book.place(order(1, Side.SELL, 100, 4, trader="ann"))
    book.place(order(2, Side.SELL, 110, 4, trader="bob"))
    fills = book.place(order(3, Side.BUY, 110, 10, trader="dan", order_type=OrderType.MARKET))
    assert [(fill.price, fill.size) for fill in fills] == [(100, 4), (110, 4)]
    assert 3 not in book.orders
    assert book.best_ask() is None
    assert book.best_bid() is None


def test_limit_remainder_rests_and_quotes_update() -> None:
    book = OrderBook("BTC-PERP")
    book.place(order(1, Side.SELL, 100, 4, trader="ann"))
    fills = book.place(order(2, Side.BUY, 100, 10, trader="bob"))
    assert [(fill.price, fill.size) for fill in fills] == [(100, 4)]
    assert book.orders[2].size == 6
    assert book.best_bid() == 100
    assert book.best_ask() is None
    book.place(order(3, Side.SELL, 110, 2, trader="cam"))
    assert book.mid() == 105
    assert book.depth(levels=1) == {"bids": [(100, 6)], "asks": [(110, 2)]}


def test_a_limit_that_does_not_cross_rests_behind_better_prices() -> None:
    book = OrderBook("BTC-PERP")
    book.place(order(1, Side.BUY, 90, 1))
    book.place(order(2, Side.BUY, 80, 2))
    book.place(order(3, Side.BUY, 90, 4, trader="bob"))
    assert book.depth() == {"bids": [(90, 5), (80, 2)], "asks": []}
    assert book.place(order(4, Side.SELL, 90, 1, order_type=OrderType.MARKET))[0].maker_order == 1


def test_reduce_only_cannot_flip_or_rest_the_excess() -> None:
    book = OrderBook("BTC-PERP")
    positions = {"ann": 5}

    def position_of(trader: str) -> int:
        return positions.get(trader, 0)

    book.place(order(1, Side.BUY, 100, 9, trader="bob"))
    fills = book.place(order(2, Side.SELL, 100, 9, trader="ann", reduce_only=True), position_of)
    assert [(fill.size, fill.price) for fill in fills] == [(5, 100)]
    assert 2 not in book.orders
    assert book.orders[1].size == 4

    rested = book.place(order(3, Side.SELL, 110, 9, trader="ann", reduce_only=True), position_of)
    assert rested == []
    assert book.orders[3].size == 5
    assert book.place(order(4, Side.BUY, 110, 1, trader="ann", reduce_only=True), position_of) == []
    assert 4 not in book.orders


def test_a_stale_reduce_only_maker_is_cancelled_instead_of_filled() -> None:
    book = OrderBook("BTC-PERP")
    positions = {"ann": -4, "bob": 0}

    def position_of(trader: str) -> int:
        return positions.get(trader, 0)

    book.place(order(1, Side.BUY, 100, 10, trader="ann", reduce_only=True), position_of)
    book.place(order(2, Side.BUY, 100, 6, trader="cam"))
    assert book.orders[1].size == 4
    positions["ann"] = 0
    fills = book.place(
        order(3, Side.SELL, 100, 5, trader="bob", order_type=OrderType.MARKET), position_of
    )
    assert [(fill.maker_order, fill.size) for fill in fills] == [(2, 5)]
    assert 1 not in book.orders
    assert book.orders[2].size == 1


def test_market_buy_priced_below_the_ask_does_not_trade() -> None:
    book = OrderBook("BTC-PERP")
    book.place(order(1, Side.SELL, 100, 4, trader="ann"))
    fills = book.place(order(2, Side.BUY, 99, 4, trader="dan", order_type=OrderType.MARKET))
    assert fills == []
    assert 2 not in book.orders
    assert book.depth() == {"bids": [], "asks": [(100, 4)]}


def test_market_buy_stops_between_levels_and_drops_the_rest() -> None:
    book = OrderBook("BTC-PERP")
    book.place(order(1, Side.SELL, 100, 4, trader="ann"))
    book.place(order(2, Side.SELL, 110, 4, trader="bob"))
    fills = book.place(order(3, Side.BUY, 105, 10, trader="dan", order_type=OrderType.MARKET))
    assert [(fill.price, fill.size) for fill in fills] == [(100, 4)]
    assert 3 not in book.orders
    assert book.depth() == {"bids": [], "asks": [(110, 4)]}


def test_market_sell_stops_between_levels_and_drops_the_rest() -> None:
    book = OrderBook("BTC-PERP")
    book.place(order(1, Side.BUY, 100, 4, trader="ann"))
    book.place(order(2, Side.BUY, 90, 4, trader="bob"))
    fills = book.place(order(3, Side.SELL, 95, 10, trader="dan", order_type=OrderType.MARKET))
    assert [(fill.price, fill.size) for fill in fills] == [(100, 4)]
    assert 3 not in book.orders
    assert book.depth() == {"bids": [(90, 4)], "asks": []}


def test_a_market_order_with_a_non_positive_price_is_rejected() -> None:
    book = OrderBook("BTC-PERP")
    book.place(order(1, Side.SELL, 100, 4, trader="ann"))
    book.place(order(2, Side.BUY, 90, 3, trader="bob"))
    assert book.place(order(3, Side.BUY, 0, 1, order_type=OrderType.MARKET)) == []
    assert book.place(order(4, Side.SELL, -5, 1, order_type=OrderType.MARKET)) == []
    assert 3 not in book.orders
    assert 4 not in book.orders
    assert book.depth() == {"bids": [(90, 3)], "asks": [(100, 4)]}


def test_cancel_removes_one_order_and_keeps_the_level() -> None:
    book = OrderBook("BTC-PERP")
    book.place(order(1, Side.BUY, 100, 2))
    book.place(order(2, Side.BUY, 100, 3, trader="bob"))
    assert book.cancel(99) is None
    cancelled = book.cancel(1)
    assert cancelled is not None and cancelled.id == 1
    assert book.best_bid() == 100
    assert book.depth()["bids"] == [(100, 3)]
    book.cancel(2)
    assert book.best_bid() is None
    assert book.mid() is None
