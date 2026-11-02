"""Fake price feed that validators submit as SetOraclePrice txs."""

from __future__ import annotations

import math
import random
from collections.abc import Callable

# One standard deviation of price move per minute. Real BTC is around 0.07%.
VOL_PER_MINUTE = 0.001
MINUTE_MS = 60_000


class FakePriceFeed:
    """Random-walk prices per market, seeded so runs are reproducible.

    The walk is scaled by the clock, not by how often it is read: more blocks a second
    must not mean a wilder price. Prices never reach zero.
    """

    def __init__(
        self, start_prices: dict[str, int], clock: Callable[[], int], seed: int = 0
    ) -> None:
        self.prices = dict(start_prices)
        self.clock = clock
        self.seed = seed
        self._rng = random.Random(seed)
        self._last_ms = clock()

    def tick(self) -> dict[str, int]:
        now = self.clock()
        elapsed = max(0, now - self._last_ms)
        self._last_ms = now
        sigma = VOL_PER_MINUTE * math.sqrt(elapsed / MINUTE_MS)
        stepped: dict[str, int] = {}
        for market in sorted(self.prices):
            price = self.prices[market]
            stepped[market] = max(1, round(price * (1 + self._rng.gauss(0, sigma))))
        self.prices = stepped
        return dict(self.prices)
