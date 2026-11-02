"""Events recorded while a block is applied. They are not part of the state root."""

from core.node import public_key, sign_tx
from core.state import HOUR_MS, State
from core.types import (
    PRICE_SCALE,
    QC,
    SIZE_SCALE,
    USDC_SCALE,
    Block,
    CancelOrder,
    Fill,
    FundingEvent,
    Market,
    Order,
    OrderEvent,
    OrderType,
    PlaceOrder,
    Side,
)
from tests.test_node import make_node
from tests.test_state import (
    ALICE,
    BOB,
    MARKET,
    ONE,
    OTHER,
    PX,
    VALIDATOR,
    block,
    fund,
    long_at,
    oracle,
    place,
)

LIMIT = OrderType.LIMIT
MARKET_ORDER = OrderType.MARKET


def orders(state: State) -> list[OrderEvent]:
    return [event for event in state.events if isinstance(event, OrderEvent)]


def fills(state: State) -> list[Fill]:
    return [event for event in state.events if isinstance(event, Fill)]


def test_a_partial_fill_then_a_full_fill_match_the_book() -> None:
    state = State([MARKET])
    alice = fund(state, ALICE, 1_000 * USDC_SCALE)
    bob = fund(state, BOB, 1_000 * USDC_SCALE)
    state.apply_block(block(1, place(ALICE, 1, 1, Side.SELL, PX, 2 * ONE), timestamp_ms=1_000))
    assert fills(state) == []
    assert orders(state) == [
        OrderEvent(1, 0, 1, alice, "BTC-PERP", "placed", 2 * ONE, "", Side.SELL, LIMIT, PX, 2 * ONE)
    ]
    assert state.books["BTC-PERP"].orders[1].size == 2 * ONE

    state.apply_block(
        block(2, place(BOB, 1, 2, Side.BUY, PX, ONE, MARKET_ORDER), timestamp_ms=2_000)
    )
    assert fills(state) == [Fill(2, 0, "BTC-PERP", PX, ONE, bob, alice, Side.BUY, False, 2_000)]
    assert orders(state) == [
        OrderEvent(2, 0, 1, alice, "BTC-PERP", "partial", ONE, "", Side.SELL, LIMIT, PX, 2 * ONE),
        OrderEvent(2, 0, 2, bob, "BTC-PERP", "filled", 0, "", Side.BUY, MARKET_ORDER, PX, ONE),
    ]
    assert state.books["BTC-PERP"].orders[1].size == ONE
    state.apply_block(
        block(3, place(BOB, 2, 3, Side.BUY, PX, ONE, MARKET_ORDER), timestamp_ms=3_000)
    )
    assert fills(state) == [Fill(3, 0, "BTC-PERP", PX, ONE, bob, alice, Side.BUY, False, 3_000)]
    assert orders(state) == [
        OrderEvent(3, 0, 1, alice, "BTC-PERP", "filled", 0, "", Side.SELL, LIMIT, PX, ONE),
        OrderEvent(3, 0, 3, bob, "BTC-PERP", "filled", 0, "", Side.BUY, MARKET_ORDER, PX, ONE),
    ]
    assert state.books["BTC-PERP"].orders == {}


def test_a_cancel_removes_the_resting_order() -> None:
    state = State([MARKET])
    alice = fund(state, ALICE, 1_000 * USDC_SCALE)
    state.apply_block(block(1, place(ALICE, 1, 7, Side.BUY, PX, ONE), timestamp_ms=10))
    state.apply_block(
        block(2, sign_tx(ALICE, CancelOrder(alice, "BTC-PERP", 7), 2), timestamp_ms=20)
    )
    assert state.events == [
        OrderEvent(2, 0, 7, alice, "BTC-PERP", "cancelled", 0, "", Side.BUY, LIMIT, PX, ONE)
    ]
    assert state.books["BTC-PERP"].orders == {}
    assert state.block_fills == []


def test_a_liquidation_fill_is_marked_and_an_unmatched_one_is_rejected() -> None:
    state = State([MARKET])
    state.oracle_prices["BTC-PERP"] = 10_000 * PRICE_SCALE
    state.accounts["bob"] = long_at("bob", 1_000 * USDC_SCALE, 50_000 * USDC_SCALE)
    state.accounts["alice"] = long_at("alice", 1_000 * USDC_SCALE, 50_000 * USDC_SCALE)
    state.books["BTC-PERP"].place(
        Order(1, "carol", "BTC-PERP", Side.BUY, LIMIT, 10_000 * PRICE_SCALE, ONE)
    )
    state.apply_block(block(1, timestamp_ms=1_000))
    cap = 9_500 * PRICE_SCALE
    assert fills(state) == [
        Fill(1, 0, "BTC-PERP", 10_000 * PRICE_SCALE, ONE, "alice", "carol", Side.SELL, True, 1_000)
    ]
    assert orders(state) == [
        OrderEvent(
            1,
            0,
            1,
            "carol",
            "BTC-PERP",
            "filled",
            0,
            "",
            Side.BUY,
            LIMIT,
            10_000 * PRICE_SCALE,
            ONE,
        ),
        OrderEvent(
            1, 0, 2, "alice", "BTC-PERP", "filled", 0, "", Side.SELL, MARKET_ORDER, cap, ONE
        ),
        OrderEvent(
            1,
            0,
            3,
            "bob",
            "BTC-PERP",
            "rejected",
            ONE,
            "unmatched",
            Side.SELL,
            MARKET_ORDER,
            cap,
            ONE,
        ),
    ]
    assert "BTC-PERP" not in state.accounts["alice"].positions
    assert state.accounts["bob"].positions["BTC-PERP"].size == ONE


def test_an_off_tick_order_is_rejected_and_does_not_rest() -> None:
    market = Market(
        "BTC-PERP", tick_size=10, lot_size=5, max_leverage=10, maintenance_margin_bps=300
    )
    state = State([market])
    signer = public_key(OTHER).hex()
    order = Order(1, signer, "BTC-PERP", Side.BUY, LIMIT, 15, 5)
    state.apply_block(block(1, sign_tx(OTHER, PlaceOrder(order), 1), timestamp_ms=50))
    assert state.events == [
        OrderEvent(1, 0, 1, signer, "BTC-PERP", "rejected", 5, "tick", Side.BUY, LIMIT, 15, 5)
    ]
    assert state.books["BTC-PERP"].orders == {}


def test_funding_events_use_the_block_timestamp() -> None:
    state = State([MARKET], validators={public_key(VALIDATOR).hex()})
    state.apply_block(
        block(
            1,
            place(ALICE, 1, 1, Side.BUY, 130, ONE),
            place(BOB, 1, 2, Side.SELL, 140, ONE),
            oracle(1, price=100),
            timestamp_ms=1_000,
        )
    )
    assert [event for event in state.events if isinstance(event, FundingEvent)] == []
    assert state.mark_prices["BTC-PERP"] == 130
    state.apply_block(block(2, timestamp_ms=1_000 + HOUR_MS))
    assert state.events == [FundingEvent(2, "BTC-PERP", 30, 30, 1_000 + HOUR_MS)]


def test_event_capture_does_not_change_the_state_root() -> None:
    def run(record: bool) -> State:
        state = State([MARKET])
        state.record_events = record
        fund(state, ALICE, 1_000 * USDC_SCALE)
        fund(state, BOB, 1_000 * USDC_SCALE)
        state.apply_block(
            block(
                1,
                place(ALICE, 1, 1, Side.SELL, PX, ONE),
                place(BOB, 1, 2, Side.BUY, PX, ONE, MARKET_ORDER),
                timestamp_ms=1_000,
            )
        )
        return state

    recorded = run(True)
    silent = run(False)
    assert recorded.state_root() == silent.state_root()
    assert recorded.to_bytes() == silent.to_bytes()
    assert silent.events == []
    assert fills(recorded) == [
        Fill(
            1,
            1,
            "BTC-PERP",
            PX,
            ONE,
            public_key(BOB).hex(),
            public_key(ALICE).hex(),
            Side.BUY,
            False,
            1_000,
        )
    ]
    assert silent.block_fills[0].size == SIZE_SCALE


def test_a_preview_does_not_record_events_on_the_live_state() -> None:
    node, _transport = make_node()
    live = node.state.to_bytes()
    preview = Block(bytes(32), 0, 1, QC(0, bytes(32), {}), (), 5, 1, bytes(32))
    assert node.preview_root(preview) is not None
    assert node.state.height == 0
    assert node.state.events == []
    assert node.state.to_bytes() == live
