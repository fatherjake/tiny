"""Runs the whole thing: n validators on an in-memory network with configurable delay and drops,
trading bots, the oracle feed, a fake source chain with bridge oracle and relayer, and the API on
validator 0. Can kill or partition validators to show HotStuff staying live with f faults.

    uv run python -m tiny.sim --validators 4 --kill 3

Budget: < 1,000 lines.
"""

from __future__ import annotations

import argparse


class Network:
    """In-memory message bus with per-link delay and drop probability."""

    def __init__(self, delay_ms: tuple[int, int] = (5, 50), drop: float = 0.0) -> None:
        self.delay_ms = delay_ms
        self.drop = drop


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a tiny cluster")
    parser.add_argument("--validators", type=int, default=4)
    parser.add_argument("--kill", type=int, action="append", default=[])
    parser.add_argument("--api-port", type=int, default=8000)
    args = parser.parse_args()
    raise NotImplementedError(args)


if __name__ == "__main__":
    main()
