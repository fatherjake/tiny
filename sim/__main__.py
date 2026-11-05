"""Playground: run a whole cluster in one process and watch it.

Starts n Nodes on a MemoryNetwork, a fake price feed and a few trading bots, then serves the
API and UI on node 0. Opening balances are deposits of one token, checked by the bridge and
applied on every node before the first block. Kill a node with --kill to watch HotStuff with f faults.

    uv run python -m sim --validators 4 --kill 3

sim/ is not under the 1,000-line limit, but keep it small.
"""

from __future__ import annotations

import argparse
import logging
import threading
import time

import uvicorn

from core.api import create_app
from core.node import Node, public_key
from core.state import State
from core.store import SqliteStore
from core.types import PRICE_SCALE, USDC_SCALE, Block, Market, Tx
from sim.bots import Bot
from sim.bridge import credit_accounts
from sim.feed import FakePriceFeed
from sim.net import MemoryNetwork

log = logging.getLogger(__name__)

MARKET = Market("BTC-PERP", tick_size=1, lot_size=1, max_leverage=10, maintenance_margin_bps=300)
START_PRICE = 50_000 * PRICE_SCALE
MOCK_COLLATERAL = 1_000_000 * USDC_SCALE
PACE_MS = 50
REAL_TIME_MS = 946_684_800_000  # 2000-01-01. Older block times came from the old clock.


def demo_key(index: int) -> bytes:
    """Deterministic demo trader. Validators use 1..n, so these start at 1000."""
    return (1_000 + index).to_bytes(32, "big")


def build(
    n: int,
    delay_ms: tuple[int, int],
    drop: float,
    seed: int,
    traders: int,
    db: str | None = None,
) -> tuple[MemoryNetwork, list[Node], list[bytes]]:
    net = MemoryNetwork(n, delay_ms=delay_ms, drop=drop, seed=seed)
    keys = [(i + 1).to_bytes(32, "big") for i in range(n)]
    pubs = {i: public_key(key) for i, key in enumerate(keys)}
    feed = FakePriceFeed({MARKET.name: START_PRICE}, clock=lambda: net.now, seed=seed)
    validators = {pub.hex() for pub in pubs.values()}
    nodes = [
        Node(
            i,
            n,
            keys[i],
            pubs,
            [MARKET],
            net.endpoint(i),
            feed.tick,
            SqliteStore(db, [MARKET], validators) if db and i == 0 else None,
        )
        for i in range(n)
    ]
    funded = [demo_key(i) for i in range(traders)]
    credit_accounts(nodes, funded, MOCK_COLLATERAL)
    if db:
        saved = nodes[0].store.committed_blocks()
        tip = nodes[0].store.tip_qc()
        if saved and tip is not None and tip.block_hash == saved[-1].hash:
            check_clock(saved[-1])  # before the replay, which can take a while
            # Every node would replay to the same state, so replay once and copy it.
            log.info("replaying %d blocks from %s", len(saved), db)
            nodes[0].resume(saved, tip)
            for node in nodes[1:]:
                copy = State.from_bytes(nodes[0].state.to_bytes())
                node.resume(saved, tip, copy)
    for node in nodes:
        node.start()
    return net, nodes, funded


def drive(
    net: MemoryNetwork,
    nodes: list[Node],
    bots: list[Bot],
    stop: threading.Event,
    lock: threading.RLock,
) -> None:
    """Advance virtual time in small steps so the API can read commits as they happen."""
    while not stop.is_set():
        with lock:
            net.run_for(PACE_MS)
            now = net.now
            for bot in bots:
                bot.step(nodes[0], now)
        time.sleep(PACE_MS / 1000)


def check_clock(tip: Block) -> None:
    # Funding would charge the whole gap from 1970 to now on the next block.
    if tip.timestamp_ms < REAL_TIME_MS:
        raise RuntimeError("the sim db was stamped with the old 1970-based clock. Delete it.")


def wall_clock(nodes: list[Node]) -> None:
    """Stamp new blocks with the current time, and never earlier than the last one.

    The network's virtual clock still paces votes. Block time is what the chart and funding read.
    """
    tip = nodes[0].by_height.get(nodes[0].state.height)
    last = 0 if tip is None else tip.timestamp_ms
    if tip is not None:
        check_clock(tip)

    def now_ms() -> int:
        nonlocal last
        last = max(int(time.time() * 1000), last + 1)
        return last

    for node in nodes:
        node.consensus.now_ms = now_ms


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a tiny cluster")
    parser.add_argument("--validators", type=int, default=4)
    parser.add_argument("--kill", type=int, action="append", default=[])
    parser.add_argument("--delay-ms", type=int, nargs=2, default=[5, 50])
    parser.add_argument("--drop", type=float, default=0.0)
    parser.add_argument("--bots", type=int, default=100)
    parser.add_argument("--api-port", type=int, default=8000)
    parser.add_argument("--db", default="sim.sqlite", help="sqlite file for node 0's block log")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    net, nodes, funded = build(
        args.validators,
        (args.delay_ms[0], args.delay_ms[1]),
        args.drop,
        seed=0,
        traders=args.bots,
        db=args.db or None,
    )
    wall_clock(nodes)
    for node_id in args.kill:
        net.kill(node_id)
    # The API thread submits while the pump thread applies blocks. One lock, re-entered
    # when a commit on node 0 signs the next oracle price.
    lock = threading.RLock()
    raw_submit = nodes[0].submit

    def submit(tx: Tx) -> bool:
        with lock:
            return raw_submit(tx)

    nodes[0].submit = submit  # type: ignore[method-assign]
    bots = [Bot(key, MARKET.name, slot=i) for i, key in enumerate(funded)]
    for key in funded:
        log.info("funded %s", public_key(key).hex())
        log.info("  private key %s", key.hex())
    stop = threading.Event()
    threading.Thread(target=drive, args=(net, nodes, bots, stop, lock), daemon=True).start()
    try:
        uvicorn.run(create_app(nodes[0]), host="127.0.0.1", port=args.api_port, log_level="info")
    finally:
        stop.set()
        for node in nodes:
            node.stop()


if __name__ == "__main__":
    main()
