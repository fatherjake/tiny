"""Price oracle. Each validator fetches (or fakes) external prices off-chain and submits a signed
SetOraclePrice tx; state.py takes the stake-weighted median of submissions.

Two sources: a random-walk fake for the sim, and an optional real feed over HTTP.

Budget: < 1,000 lines.
"""

from __future__ import annotations

from tiny.types import NodeId, OraclePrice


class FakeFeed:
    def __init__(self, start_prices: dict[str, int], seed: int = 0) -> None:
        self.prices = dict(start_prices)
        self.seed = seed

    def tick(self) -> dict[str, int]:
        raise NotImplementedError


class OracleSubmitter:
    def __init__(self, node_id: NodeId, feed: FakeFeed) -> None:
        self.node_id = node_id
        self.feed = feed

    def make_submission(self, timestamp_ms: int) -> list[OraclePrice]:
        raise NotImplementedError


def median_price(submissions: list[OraclePrice]) -> int:
    raise NotImplementedError
