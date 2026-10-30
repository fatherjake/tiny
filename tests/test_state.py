import pytest

from core.node import public_key, sign_tx
from core.state import State
from core.types import (
    QC,
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
