"""
    CLOB, one per market. Price-time priority.
"""

from __future__ import annotations

from bisect import insort
from collections import deque
from collections.abc import Callable
from dataclasses import replace

from core.types import Match, Order, OrderType, Side


def reducible(position: int, side: Side) -> int:
    """How much of `side` closes `position` without flipping past flat."""
    if side == Side.SELL:
        return max(position, 0)
    return max(-position, 0)


class OrderBook:
    def __init__(self, market: str) -> None:
        self.market = market
        self.bids: dict[int, deque[Order]] = {}  # price -> FIFO queue, prices kept ascending
        self.asks: dict[int, deque[Order]] = {}
        self.bid_prices: list[int] = []
        self.ask_prices: list[int] = []
        self.orders: dict[int, Order] = {}

    def place(self, order: Order, position_of: Callable[[str], int] | None = None) -> list[Match]:
        """Match up to the order's price. Limit remainders rest; market orders never do."""
        if order.market != self.market or order.size <= 0 or order.id in self.orders:
            return []
        if order.price <= 0:
            return []
        remaining = order.size
        if order.reduce_only:
            remaining = min(remaining, self._cap(order, position_of))
        fills: list[Match] = []
        while remaining > 0:
            price = self._touch(order.side)
            if price is None:
                break
            if not self._crosses(order, price):
                break
            queue = self.asks[price] if order.side == Side.BUY else self.bids[price]
            while remaining > 0 and queue:
                maker = queue[0]
                cap = maker.size
                if maker.reduce_only:
                    cap = min(cap, self._cap(maker, position_of))
                if cap <= 0:
                    self._remove_front(queue, maker)
                    continue
                trade = min(remaining, cap)
                fills.append(
                    Match(
                        market=self.market,
                        maker_order=maker.id,
                        taker_order=order.id,
                        maker=maker.trader,
                        taker=order.trader,
                        price=maker.price,
                        size=trade,
                        taker_side=order.side,
                    )
                )
                remaining -= trade
                left = maker.size - trade
                if maker.reduce_only:
                    left = min(left, cap - trade)
                if left <= 0:
                    self._remove_front(queue, maker)
                else:
                    updated = replace(maker, size=left)
                    queue[0] = updated
                    self.orders[maker.id] = updated
            if not queue:
                self._drop_level(order.side, price)
        if remaining > 0 and order.type == OrderType.LIMIT:
            self._rest(replace(order, size=remaining))
        return fills

    def restore(self, bids: list[Order], asks: list[Order]) -> None:
        """Put resting orders back without matching. Lists are best price first, then time."""
        for order in bids:
            self._rest(order)
        for order in asks:
            self._rest(order)

    def cancel(self, order_id: int) -> Order | None:
        order = self.orders.get(order_id)
        if order is None:
            return None
        if order.side == Side.BUY:
            levels, prices = self.bids, self.bid_prices
        else:
            levels, prices = self.asks, self.ask_prices
        queue = levels[order.price]
        # This could be better as a d linked list but its find for this toy version for now
        levels[order.price] = deque(resting for resting in queue if resting.id != order_id)
        if not levels[order.price]:
            del levels[order.price]
            prices.remove(order.price)
        del self.orders[order_id]
        return order

    def best_bid(self) -> int | None:
        return self.bid_prices[-1] if self.bid_prices else None

    def best_ask(self) -> int | None:
        return self.ask_prices[0] if self.ask_prices else None

    def mid(self) -> int | None:
        bid, ask = self.best_bid(), self.best_ask()
        if bid is None or ask is None:
            return None
        return (bid + ask) // 2

    def depth(self, levels: int = 20) -> dict[str, list[tuple[int, int]]]:
        """Aggregated (price, size) levels, best price first."""
        return {
            "bids": self._depth(self.bid_prices, self.bids, levels, high_first=True),
            "asks": self._depth(self.ask_prices, self.asks, levels, high_first=False),
        }

    def resting(self) -> dict[str, list[Order]]:
        """Resting orders, best price first and then time order."""
        return {
            "bids": self._orders(self.bid_prices, self.bids, high_first=True),
            "asks": self._orders(self.ask_prices, self.asks, high_first=False),
        }

    def _cap(self, order: Order, position_of: Callable[[str], int] | None) -> int:
        position = 0 if position_of is None else position_of(order.trader)
        return reducible(position, order.side)

    def _touch(self, taker: Side) -> int | None:
        if taker == Side.BUY:
            return self.best_ask()
        return self.best_bid()

    def _crosses(self, order: Order, price: int) -> bool:
        if order.side == Side.BUY:
            return price <= order.price
        return price >= order.price

    def _remove_front(self, queue: deque[Order], maker: Order) -> None:
        queue.popleft()
        del self.orders[maker.id]

    def _drop_level(self, taker: Side, price: int) -> None:
        if taker == Side.BUY:
            del self.asks[price]
            self.ask_prices.remove(price)
        else:
            del self.bids[price]
            self.bid_prices.remove(price)

    def _rest(self, order: Order) -> None:
        if order.side == Side.BUY:
            levels, prices = self.bids, self.bid_prices
        else:
            levels, prices = self.asks, self.ask_prices
        if order.price not in levels:
            insort(prices, order.price)
            levels[order.price] = deque()
        levels[order.price].append(order)
        self.orders[order.id] = order

    def _depth(
        self,
        prices: list[int],
        queues: dict[int, deque[Order]],
        levels: int,
        *,
        high_first: bool,
    ) -> list[tuple[int, int]]:
        ordered = list(reversed(prices)) if high_first else prices
        out: list[tuple[int, int]] = []
        for price in ordered:
            if len(out) >= levels:
                break
            out.append((price, sum(resting.size for resting in queues[price])))
        return out

    def _orders(
        self,
        prices: list[int],
        queues: dict[int, deque[Order]],
        *,
        high_first: bool,
    ) -> list[Order]:
        ordered = list(reversed(prices)) if high_first else prices
        return [resting for price in ordered for resting in queues[price]]
