"""Playground: run a whole cluster in one process and watch it.

Starts n Nodes on a MemoryNetwork, a fake price feed, a few trading bots, a fake source chain with
the bridge oracle and relayer, and the API + UI on node 0. Kill or partition nodes from the CLI to
watch HotStuff stay live with f faults. Automated fault scenarios live in tests/.

    uv run python -m sim --validators 4 --kill 3

sim/ is not under the 1,000-line limit, but keep it small.
"""

from __future__ import annotations

import argparse

from sim.bots import Bot  # noqa: F401
from sim.feed import FakePriceFeed  # noqa: F401
from sim.net import MemoryNetwork  # noqa: F401


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a tiny cluster")
    parser.add_argument("--validators", type=int, default=4)
    parser.add_argument("--kill", type=int, action="append", default=[])
    parser.add_argument("--delay-ms", type=int, nargs=2, default=[5, 50])
    parser.add_argument("--drop", type=float, default=0.0)
    parser.add_argument("--bots", type=int, default=3)
    parser.add_argument("--api-port", type=int, default=8000)
    args = parser.parse_args()
    raise NotImplementedError(args)


if __name__ == "__main__":
    main()
