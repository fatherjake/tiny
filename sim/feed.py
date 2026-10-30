"""Fake price feed that validators submit as SetOraclePrice txs."""

from __future__ import annotations


class FakePriceFeed:
    """Random-walk prices per market, seeded so runs are reproducible."""

    def __init__(self, start_prices: dict[str, int], seed: int = 0) -> None:
        self.prices = dict(start_prices)
        self.seed = seed

    def tick(self) -> dict[str, int]:
        raise NotImplementedError
