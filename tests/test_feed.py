from core.types import PRICE_SCALE, Market
from sim.feed import FakePriceFeed
from tests.cluster import Cluster

MARKET = Market("BTC-PERP", tick_size=1, lot_size=1, max_leverage=10, maintenance_margin_bps=300)
PRICE = 42_000 * PRICE_SCALE


def test_seeded_walk_is_stable() -> None:
    feed = FakePriceFeed({"BTC-PERP": 50_000 * PRICE_SCALE}, seed=0)
    assert [feed.tick()["BTC-PERP"] for _ in range(3)] == [
        50_001_706_749,
        50_008_153_205,
        49_963_578_773,
    ]


def test_validators_publish_the_feed_into_the_oracle() -> None:
    cluster = Cluster(n=4, markets=[MARKET], price_feed=lambda: {"BTC-PERP": PRICE})
    cluster.run_for(500)
    assert {node.state.oracle_prices["BTC-PERP"] for node in cluster.nodes} == {PRICE}
    assert {node.state.mark_prices["BTC-PERP"] for node in cluster.nodes} == {PRICE}
    assert len(cluster.state_roots()) == 1
