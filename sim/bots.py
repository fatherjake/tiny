"""Trading bots that keep the order books busy."""

from __future__ import annotations


class Bot:
    """Places random limit and market orders around the mid."""

    def __init__(self, trader: str, seed: int = 0) -> None:
        self.trader = trader
        self.seed = seed

    def step(self) -> None:
        raise NotImplementedError
