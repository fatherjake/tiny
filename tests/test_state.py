import pytest

from core.node import public_key, sign_tx
from core.state import State
from core.types import (
    PRICE_SCALE,
    QC,
    SIZE_SCALE,
    USDC_SCALE,
    Account,
    Block,
    CancelOrder,
    Market,
    OraclePrice,
    Order,
    OrderType,
    PlaceOrder,
    SetOraclePrice,
    Side,
    Tx,
)

MARKET = Market("BTC-PERP", tick_size=1, lot_size=1, max_leverage=10, maintenance_margin_bps=300)
VALIDATOR = bytes(range(32))
OTHER = bytes(range(1, 33))


def block(height: int, *txs: Tx, timestamp_ms: int = 0) -> Block:
    return Block(bytes(32), 0, height, QC(0, bytes(32), {}), txs, timestamp_ms, height)


def oracle(nonce: int, key: bytes = VALIDATOR, price: int = 100, market: str = "BTC-PERP") -> Tx:
    return sign_tx(key, SetOraclePrice(OraclePrice(market, price, 0, {})), nonce)


def test_apply_block_commits_the_next_height() -> None:
    state = State([MARKET])
    state.apply_block(block(1, timestamp_ms=1_000))
    assert state.height == 1
    state.apply_block(block(2, timestamp_ms=2_000))
    assert state.height == 2


def test_apply_block_rejects_a_gap_or_a_replay() -> None:
    state = State([MARKET])
    with pytest.raises(AssertionError):
        state.apply_block(block(2))
    state.apply_block(block(1))
    with pytest.raises(AssertionError):
        state.apply_block(block(1))
    assert state.height == 1


def test_nonce_must_be_exactly_one_ahead() -> None:
    state = State([MARKET], validators={public_key(VALIDATOR).hex()})
    signer = oracle(1).signer
    state.apply_tx(oracle(1), 0)
    assert state.nonce(signer) == 1
    state.apply_tx(oracle(1), 0)
    state.apply_tx(oracle(3), 0)
    assert state.nonce(signer) == 1
    state.apply_tx(oracle(2), 0)
    assert state.nonce(signer) == 2


def test_oracle_vote_is_one_validator_submission_per_block() -> None:
    validator = public_key(VALIDATOR).hex()
    other = public_key(OTHER).hex()
    state = State([MARKET], validators={validator})
    state.apply_tx(oracle(1, price=10), 0)
    state.apply_tx(oracle(2, price=99), 0)
    state.apply_tx(oracle(1, key=OTHER, price=50), 0)
    assert [item.price for item in state.oracle_submissions["BTC-PERP"]] == [10]
    assert state.oracle_voters == {validator}
    assert state.nonce(other) == 1
    assert state.nonce(validator) == 2


def test_a_non_positive_oracle_price_uses_up_the_vote() -> None:
    validator = public_key(VALIDATOR).hex()
    state = State([MARKET], validators={validator})
    state.apply_tx(oracle(1, price=0), 0)
    state.apply_tx(oracle(2, price=10), 0)
    assert state.oracle_submissions == {}
    assert state.oracle_voters == {validator}


def test_a_validator_can_vote_again_on_the_next_block() -> None:
    state = State([MARKET], validators={public_key(VALIDATOR).hex()})
    state.apply_block(block(1, oracle(1, price=10)))
    assert state.oracle_submissions == {}
    assert state.oracle_voters == set()
    state.apply_tx(oracle(2, price=12), 0)
    assert [item.price for item in state.oracle_submissions["BTC-PERP"]] == [12]


def test_place_and_cancel_for_another_trader_are_skipped() -> None:
    state = State([MARKET])
    signer = public_key(OTHER).hex()
    foreign = Order(1, "alice", "BTC-PERP", Side.BUY, OrderType.LIMIT, 100, 1)
    state.apply_tx(sign_tx(OTHER, PlaceOrder(foreign), 1), 0)
    state.apply_tx(sign_tx(OTHER, CancelOrder("alice", "BTC-PERP", 1), 2), 0)
    assert state.nonce(signer) == 2
    assert state.books["BTC-PERP"].orders == {}


ALICE = bytes(range(4, 36))
BOB = bytes(range(5, 37))
ONE = SIZE_SCALE
PX = 50_000 * PRICE_SCALE


def fund(state: State, key: bytes, collateral: int) -> str:
    trader = public_key(key).hex()
    state.accounts[trader] = Account(trader, collateral=collateral)
    return trader


def place(
    key: bytes,
    nonce: int,
    order_id: int,
    side: Side,
    price: int,
    size: int,
    order_type: OrderType = OrderType.LIMIT,
    reduce_only: bool = False,
) -> Tx:
    trader = public_key(key).hex()
    order = Order(order_id, trader, "BTC-PERP", side, order_type, price, size, reduce_only)
    return sign_tx(key, PlaceOrder(order), nonce)


def test_fills_charge_fees_and_open_signed_positions() -> None:
    state = State([MARKET])
    alice = fund(state, ALICE, 1_000 * USDC_SCALE)
    bob = fund(state, BOB, 1_000 * USDC_SCALE)
    state.apply_tx(place(ALICE, 1, 1, Side.SELL, PX, ONE), 0)
    state.apply_tx(place(BOB, 1, 2, Side.BUY, 0, ONE, OrderType.MARKET), 0)
    assert state.accounts[alice].positions["BTC-PERP"].size == -ONE
    assert state.accounts[alice].positions["BTC-PERP"].entry_notional == 50_000 * USDC_SCALE
    assert state.accounts[alice].collateral == 990 * USDC_SCALE
    assert state.accounts[bob].positions["BTC-PERP"].size == ONE
    assert state.accounts[bob].positions["BTC-PERP"].entry_notional == 50_000 * USDC_SCALE
    assert state.accounts[bob].collateral == 975 * USDC_SCALE


def test_closing_realizes_pnl_and_reduce_only_cannot_flip() -> None:
    state = State([MARKET])
    alice = fund(state, ALICE, 20_000 * USDC_SCALE)
    bob = fund(state, BOB, 20_000 * USDC_SCALE)
    state.apply_tx(place(ALICE, 1, 1, Side.SELL, PX, ONE), 0)
    state.apply_tx(place(BOB, 1, 2, Side.BUY, 0, ONE, OrderType.MARKET), 0)
    state.apply_tx(place(ALICE, 2, 3, Side.BUY, 60_000 * PRICE_SCALE, ONE), 0)
    state.apply_tx(place(BOB, 2, 4, Side.SELL, 0, 5 * ONE, OrderType.MARKET, reduce_only=True), 0)
    assert "BTC-PERP" not in state.accounts[bob].positions
    assert "BTC-PERP" not in state.accounts[alice].positions
    assert state.accounts[bob].collateral == 29_945 * USDC_SCALE
    assert state.accounts[alice].collateral == 9_978 * USDC_SCALE
    assert 4 not in state.books["BTC-PERP"].orders


def test_a_partial_close_keeps_the_remaining_entry() -> None:
    state = State([MARKET])
    alice = fund(state, ALICE, 1_000 * USDC_SCALE)
    bob = fund(state, BOB, 1_000 * USDC_SCALE)
    state.apply_tx(place(ALICE, 1, 1, Side.SELL, PX, 2 * ONE), 0)
    state.apply_tx(place(BOB, 1, 2, Side.BUY, 0, 2 * ONE, OrderType.MARKET), 0)
    state.apply_tx(place(BOB, 2, 3, Side.SELL, PX, ONE), 0)
    state.apply_tx(place(ALICE, 2, 4, Side.BUY, 0, ONE, OrderType.MARKET), 0)
    assert state.accounts[bob].positions["BTC-PERP"].size == ONE
    assert state.accounts[bob].positions["BTC-PERP"].entry_notional == 50_000 * USDC_SCALE
    assert state.accounts[bob].collateral == 940 * USDC_SCALE
    assert state.accounts[alice].positions["BTC-PERP"].size == -ONE
    assert state.accounts[alice].positions["BTC-PERP"].entry_notional == 50_000 * USDC_SCALE
    assert state.accounts[alice].collateral == 955 * USDC_SCALE


def test_a_fill_that_flips_the_position_opens_the_remainder() -> None:
    state = State([MARKET])
    alice = fund(state, ALICE, 1_000 * USDC_SCALE)
    bob = fund(state, BOB, 1_000 * USDC_SCALE)
    state.apply_tx(place(ALICE, 1, 1, Side.SELL, PX, ONE), 0)
    state.apply_tx(place(BOB, 1, 2, Side.BUY, 0, ONE, OrderType.MARKET), 0)
    state.apply_tx(place(BOB, 2, 3, Side.SELL, PX, 2 * ONE), 0)
    state.apply_tx(place(ALICE, 2, 4, Side.BUY, 0, 2 * ONE, OrderType.MARKET), 0)
    assert state.accounts[alice].positions["BTC-PERP"].size == ONE
    assert state.accounts[alice].positions["BTC-PERP"].entry_notional == 50_000 * USDC_SCALE
    assert state.accounts[alice].collateral == 940 * USDC_SCALE
    assert state.accounts[bob].positions["BTC-PERP"].size == -ONE
    assert state.accounts[bob].positions["BTC-PERP"].entry_notional == 50_000 * USDC_SCALE
    assert state.accounts[bob].collateral == 955 * USDC_SCALE


def test_off_tick_or_off_lot_orders_do_not_reach_the_book() -> None:
    market = Market(
        "BTC-PERP", tick_size=10, lot_size=5, max_leverage=10, maintenance_margin_bps=300
    )
    state = State([market])
    signer = public_key(OTHER).hex()
    off_tick = Order(1, signer, "BTC-PERP", Side.BUY, OrderType.LIMIT, 15, 5)
    off_lot = Order(2, signer, "BTC-PERP", Side.BUY, OrderType.LIMIT, 20, 4)
    state.apply_tx(sign_tx(OTHER, PlaceOrder(off_tick), 1), 0)
    state.apply_tx(sign_tx(OTHER, PlaceOrder(off_lot), 2), 0)
    assert state.books["BTC-PERP"].orders == {}
