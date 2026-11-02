"""Trading bots that keep the order books busy."""

from __future__ import annotations

import random

from core.node import Node, public_key, sign_tx
from core.types import SIZE_SCALE, CancelOrder, Order, OrderType, PlaceOrder, Side

MIN_SIZE = SIZE_SCALE // 100  # 0.01
MAX_SIZE = SIZE_SCALE // 2  # 0.50, for quotes
MAX_TAKE = SIZE_SCALE // 10  # 0.10, for market orders
MIN_GAP_MS = 250
MAX_GAP_MS = 900
KEEP = 6
# Quotes sit 1 to 10 bps from the oracle, and a taker never pays more than 10 bps past
# the touch, so prints stay near fair value instead of sweeping a thin book.
QUOTE_MIN_BPS = 1
QUOTE_MAX_BPS = 10
MARKET_SLIPPAGE_BPS = 10


class Bot:
    """Quotes and crosses on its own clock, with a fresh size each order."""

    def __init__(self, private_key: bytes, market: str, slot: int) -> None:
        self.private_key = private_key
        self.trader = public_key(private_key).hex()
        self.market = market
        self.rng = random.Random(slot)
        self._next_id = 1_000_000 * (slot + 1)
        self.resting: list[int] = []
        self._steps = 0
        self._due = self.rng.randrange(MIN_GAP_MS, MAX_GAP_MS + 1)

    def step(self, node: Node, now_ms: int) -> None:
        if now_ms < self._due:
            return
        self._due = now_ms + self.rng.randrange(MIN_GAP_MS, MAX_GAP_MS + 1)
        state = node.state
        # Quote around the oracle, the index the market should track, not the book's own mark.
        mid = state.oracle_prices.get(self.market)
        if mid is None:
            mid = state.mark_prices.get(self.market)
        if mid is None or mid <= 0:
            return
        book = state.books.get(self.market)
        if book is None:
            return
        live = [order_id for order_id in self.resting if order_id in book.orders]
        bid, ask = book.best_bid(), book.best_ask()
        if bid is not None and ask is not None:
            side = Side.BUY if self._steps % 2 == 0 else Side.SELL
            self._steps += 1
            touch = ask if side == Side.BUY else bid
            band = (
                10_000 + MARKET_SLIPPAGE_BPS if side == Side.BUY else 10_000 - MARKET_SLIPPAGE_BPS
            )
            price = touch * band // 10_000
            if price > 0:
                self._place(node, side, OrderType.MARKET, price, self._size(MAX_TAKE))
        if len(live) >= KEEP:
            order_id = live[0]
            self.resting.remove(order_id)
            body = CancelOrder(self.trader, self.market, order_id)
            if not self._send(node, body):
                self.resting.insert(0, order_id)
            return
        side = Side.BUY if self.rng.randrange(2) == 0 else Side.SELL
        bps = self.rng.randrange(QUOTE_MIN_BPS, QUOTE_MAX_BPS + 1)
        offset = max(1, mid * bps // 10_000)
        price = mid - offset if side == Side.BUY else mid + offset
        self._place(node, side, OrderType.LIMIT, price, self._size(MAX_SIZE))

    def _size(self, most: int) -> int:
        return self.rng.randrange(MIN_SIZE, most + 1)

    def _place(self, node: Node, side: Side, order_type: OrderType, price: int, size: int) -> None:
        order_id = self._next_id
        order = Order(order_id, self.trader, self.market, side, order_type, price, size)
        if order_type == OrderType.LIMIT:
            self.resting.append(order_id)
        if self._send(node, PlaceOrder(order)):
            self._next_id += 1
            return
        if order_type == OrderType.LIMIT:
            self.resting.pop()

    def _send(self, node: Node, body: PlaceOrder | CancelOrder) -> bool:
        pending = [nonce for who, nonce in node.mempool.pending if who == self.trader]
        nonce = max([node.state.nonce(self.trader), *pending]) + 1
        return node.submit(sign_tx(self.private_key, body, nonce))
