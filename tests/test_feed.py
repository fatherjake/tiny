from core.types import PRICE_SCALE, Market
from sim.feed import FakePriceFeed
from tests.cluster import Cluster

MARKET = Market("BTC-PERP", tick_size=1, lot_size=1, max_leverage=10, maintenance_margin_bps=300)
PRICE = 42_000 * PRICE_SCALE


def test_the_walk_scales_with_time_not_with_reads() -> None:
    def minute_move(seed: int, reads: int) -> float:
        now = 0
        feed = FakePriceFeed({"BTC-PERP": PRICE}, clock=lambda: now, seed=seed)
        for i in range(1, reads + 1):
            now = 60_000 * i // reads
            price = feed.tick()["BTC-PERP"]
        return abs(price - PRICE) / PRICE

    once = sum(minute_move(seed, 1) for seed in range(300)) / 300
    often = sum(minute_move(seed, 60) for seed in range(300)) / 300
    # Both average about VOL_PER_MINUTE * sqrt(2 / pi), however often the feed is read.
    assert 0.0006 < once < 0.001
    assert 0.0006 < often < 0.001


def test_no_time_means_no_move() -> None:
    feed = FakePriceFeed({"BTC-PERP": PRICE}, clock=lambda: 0, seed=0)
    assert [feed.tick()["BTC-PERP"] for _ in range(3)] == [PRICE] * 3


def test_validators_publish_the_feed_into_the_oracle() -> None:
    cluster = Cluster(n=4, markets=[MARKET], price_feed=lambda: {"BTC-PERP": PRICE})
    cluster.run_for(500)
    assert {node.state.oracle_prices["BTC-PERP"] for node in cluster.nodes} == {PRICE}
    assert {node.state.mark_prices["BTC-PERP"] for node in cluster.nodes} == {PRICE}
    assert len(cluster.state_roots()) == 1
