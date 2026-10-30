"""Fake price feed that validators submit as SetOraclePrice txs."""

from __future__ import annotations

import random


class FakePriceFeed:
    """Random-walk prices per market, seeded so runs are reproducible.

    Each tick moves a market by at most 0.1% of its price, and never to zero or below.
    """

    def __init__(self, start_prices: dict[str, int], seed: int = 0) -> None:
        self.prices = dict(start_prices)
        self.seed = seed
        self._rng = random.Random(seed)

    def tick(self) -> dict[str, int]:
        stepped: dict[str, int] = {}
        for market in sorted(self.prices):
            price = self.prices[market]
            span = max(1, price // 1_000)
            stepped[market] = max(1, price + self._rng.randrange(-span, span + 1))
        self.prices = stepped
        return dict(self.prices)
