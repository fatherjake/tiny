"""Central limit order book, one per market. Price-time priority.

Pure and deterministic: given the same sequence of orders, every validator produces the same
fills. Margin checks are not done here; state.py checks before calling in and settles fills after.

Budget: < 1,000 lines.
"""

from __future__ import annotations

from core.types import Fill, Order


class OrderBook:
    def __init__(self, market: str) -> None:
        self.market = market
        self.bids: dict[int, list[Order]] = {}  # price -> FIFO queue
        self.asks: dict[int, list[Order]] = {}
        self.orders: dict[int, Order] = {}

    def place(self, order: Order) -> list[Fill]:
        """Match against the opposite side, rest any remainder for limit orders."""
        raise NotImplementedError

    def cancel(self, order_id: int) -> Order | None:
        raise NotImplementedError

    def best_bid(self) -> int | None:
        raise NotImplementedError

    def best_ask(self) -> int | None:
        raise NotImplementedError

    def mid(self) -> int | None:
        raise NotImplementedError

    def depth(self, levels: int = 20) -> dict[str, list[tuple[int, int]]]:
        """Aggregated (price, size) levels for the API and UI."""
        raise NotImplementedError
