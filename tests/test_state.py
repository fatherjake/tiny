import pytest

from core.node import public_key, sign_tx
from core.state import HOUR_MS, State, median_price
from core.types import (
    PRICE_SCALE,
    QC,
    SIZE_SCALE,
    USDC_SCALE,
    Account,
    Block,
    BlockHeader,
    BridgeMessage,
    CancelOrder,
    Market,
    OraclePrice,
    Order,
    OrderType,
    PlaceOrder,
    Position,
    SetOraclePrice,
    Side,
    Tx,
    Withdraw,
    encode,
    sha256,
)

MARKET = Market("BTC-PERP", tick_size=1, lot_size=1, max_leverage=10, maintenance_margin_bps=300)
VALIDATOR = bytes(range(32))
OTHER = bytes(range(1, 33))


def block(height: int, *txs: Tx, timestamp_ms: int = 0) -> Block:
    return Block(bytes(32), 0, height, QC(0, bytes(32), {}), txs, timestamp_ms, height, bytes(32))


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


def _with_resting_ask() -> tuple[State, str, str]:
    state = State([MARKET])
    alice = fund(state, ALICE, 1_000 * USDC_SCALE)
    bob = fund(state, BOB, 1_000 * USDC_SCALE)
    state.apply_block(block(1, place(ALICE, 1, 1, Side.SELL, PX, ONE), timestamp_ms=1_000))
    return state, alice, bob


def test_a_cancel_in_the_block_runs_before_the_taker() -> None:
    filled, alice, bob = _with_resting_ask()
    filled.apply_block(
        block(2, place(BOB, 1, 2, Side.BUY, PX, ONE, OrderType.MARKET), timestamp_ms=2_000)
    )
    assert filled.accounts[bob].positions["BTC-PERP"].size == ONE
    assert filled.accounts[alice].positions["BTC-PERP"].size == -ONE

    state, alice, bob = _with_resting_ask()
    cancel = sign_tx(ALICE, CancelOrder(alice, "BTC-PERP", 1), 2)
    state.apply_block(
        block(
            2,
            place(BOB, 1, 2, Side.BUY, PX, ONE, OrderType.MARKET),
            cancel,
            timestamp_ms=2_000,
        )
    )
    assert "BTC-PERP" not in state.accounts[bob].positions
    assert "BTC-PERP" not in state.accounts[alice].positions
    assert state.books["BTC-PERP"].orders == {}
    assert state.block_fills == []
    assert state.accounts[bob].collateral == 1_000 * USDC_SCALE
    assert state.accounts[alice].collateral == 1_000 * USDC_SCALE
    assert state.nonce(bob) == 1
    assert state.nonce(alice) == 2


def test_a_later_nonce_cancel_still_applies_ahead_of_its_signer() -> None:
    state, alice, _ = _with_resting_ask()
    bid = place(ALICE, 2, 2, Side.BUY, PX // 2, ONE)
    cancel = sign_tx(ALICE, CancelOrder(alice, "BTC-PERP", 1), 3)
    state.apply_block(block(2, bid, cancel, timestamp_ms=2_000))
    assert 1 not in state.books["BTC-PERP"].orders
    resting = state.books["BTC-PERP"].orders[2]
    assert resting.side == Side.BUY
    assert resting.price == PX // 2
    assert resting.size == ONE
    assert state.nonce(alice) == 3


def test_fills_charge_fees_and_open_signed_positions() -> None:
    state = State([MARKET])
    alice = fund(state, ALICE, 1_000 * USDC_SCALE)
    bob = fund(state, BOB, 1_000 * USDC_SCALE)
    state.apply_tx(place(ALICE, 1, 1, Side.SELL, PX, ONE), 0)
    state.apply_tx(place(BOB, 1, 2, Side.BUY, PX, ONE, OrderType.MARKET), 0)
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
    state.apply_tx(place(BOB, 1, 2, Side.BUY, PX, ONE, OrderType.MARKET), 0)
    state.apply_tx(place(ALICE, 2, 3, Side.BUY, 60_000 * PRICE_SCALE, ONE), 0)
    state.apply_tx(
        place(
            BOB, 2, 4, Side.SELL, 60_000 * PRICE_SCALE, 5 * ONE, OrderType.MARKET, reduce_only=True
        ),
        0,
    )
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
    state.apply_tx(place(BOB, 1, 2, Side.BUY, PX, 2 * ONE, OrderType.MARKET), 0)
    state.apply_tx(place(BOB, 2, 3, Side.SELL, PX, ONE), 0)
    state.apply_tx(place(ALICE, 2, 4, Side.BUY, PX, ONE, OrderType.MARKET), 0)
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
    state.apply_tx(place(BOB, 1, 2, Side.BUY, PX, ONE, OrderType.MARKET), 0)
    state.apply_tx(place(BOB, 2, 3, Side.SELL, PX, 2 * ONE), 0)
    state.apply_tx(place(ALICE, 2, 4, Side.BUY, PX, 2 * ONE, OrderType.MARKET), 0)
    assert state.accounts[alice].positions["BTC-PERP"].size == ONE
    assert state.accounts[alice].positions["BTC-PERP"].entry_notional == 50_000 * USDC_SCALE
    assert state.accounts[alice].collateral == 940 * USDC_SCALE
    assert state.accounts[bob].positions["BTC-PERP"].size == -ONE
    assert state.accounts[bob].positions["BTC-PERP"].entry_notional == 50_000 * USDC_SCALE
    assert state.accounts[bob].collateral == 955 * USDC_SCALE


def test_margin_marks_positions_to_market_and_sums_maintenance() -> None:
    eth = Market("ETH-PERP", tick_size=1, lot_size=1, max_leverage=10, maintenance_margin_bps=500)
    state = State([MARKET, eth])
    state.accounts["alice"] = Account(
        "alice",
        collateral=1_000 * USDC_SCALE,
        positions={
            "BTC-PERP": Position("BTC-PERP", size=ONE, entry_notional=50_000 * USDC_SCALE),
            "ETH-PERP": Position("ETH-PERP", size=-2 * ONE, entry_notional=3_000 * USDC_SCALE),
        },
    )
    assert state.margin("nobody") == (0, 0)
    state.mark_prices["BTC-PERP"] = 60_000 * PRICE_SCALE
    assert state.margin("alice") == (11_000 * USDC_SCALE, 1_800 * USDC_SCALE)
    state.mark_prices["ETH-PERP"] = 2_000 * PRICE_SCALE
    assert state.margin("alice") == (10_000 * USDC_SCALE, 2_000 * USDC_SCALE)


def test_withdraw_keeps_collateral_that_maintenance_still_needs() -> None:
    state = State([MARKET])
    alice = fund(state, ALICE, 10_000 * USDC_SCALE)
    state.accounts[alice].positions["BTC-PERP"] = Position(
        "BTC-PERP", size=ONE, entry_notional=50_000 * USDC_SCALE
    )
    state.mark_prices["BTC-PERP"] = 50_000 * PRICE_SCALE
    state.apply_tx(sign_tx(ALICE, Withdraw(alice, 9_000 * USDC_SCALE, 1, "0x" + "33" * 20), 1), 0)
    assert state.accounts[alice].collateral == 10_000 * USDC_SCALE
    assert state.nonce(alice) == 1


def long_at(name: str, collateral: int, entry: int, size: int = ONE) -> Account:
    return Account(
        name,
        collateral=collateral,
        positions={"BTC-PERP": Position("BTC-PERP", size=size, entry_notional=entry)},
    )


def test_liquidation_closes_underwater_accounts_in_trader_order() -> None:
    state = State([MARKET])
    state.oracle_prices["BTC-PERP"] = 10_000 * PRICE_SCALE
    state.accounts["bob"] = long_at("bob", 1_000 * USDC_SCALE, 50_000 * USDC_SCALE)
    state.accounts["alice"] = long_at("alice", 1_000 * USDC_SCALE, 50_000 * USDC_SCALE)
    state.books["BTC-PERP"].place(
        Order(1, "carol", "BTC-PERP", Side.BUY, OrderType.LIMIT, 10_000 * PRICE_SCALE, ONE)
    )
    state.apply_block(block(1, timestamp_ms=1_000))
    assert "BTC-PERP" not in state.accounts["alice"].positions
    assert state.accounts["alice"].collateral == -39_005 * USDC_SCALE
    assert state.accounts["bob"].positions["BTC-PERP"].size == ONE
    assert state.accounts["bob"].collateral == 1_000 * USDC_SCALE
    assert state.accounts["carol"].positions["BTC-PERP"].size == ONE


def test_liquidation_buys_back_an_underwater_short() -> None:
    state = State([MARKET])
    state.oracle_prices["BTC-PERP"] = 50_000 * PRICE_SCALE
    state.accounts["alice"] = Account(
        "alice",
        collateral=1_000 * USDC_SCALE,
        positions={"BTC-PERP": Position("BTC-PERP", size=-ONE, entry_notional=10_000 * USDC_SCALE)},
    )
    state.books["BTC-PERP"].place(
        Order(7, "bob", "BTC-PERP", Side.SELL, OrderType.LIMIT, 50_000 * PRICE_SCALE, 5 * ONE)
    )
    state.apply_block(block(1, timestamp_ms=1_000))
    assert "BTC-PERP" not in state.accounts["alice"].positions
    assert state.accounts["alice"].collateral == -39_025 * USDC_SCALE
    assert state.accounts["bob"].positions["BTC-PERP"].size == -ONE


def test_an_account_at_maintenance_is_not_liquidated() -> None:
    state = State([MARKET])
    state.oracle_prices["BTC-PERP"] = 10_000 * PRICE_SCALE
    state.accounts["carol"] = long_at("carol", 300 * USDC_SCALE, 10_000 * USDC_SCALE)
    state.books["BTC-PERP"].place(
        Order(1, "dave", "BTC-PERP", Side.BUY, OrderType.LIMIT, 10_000 * PRICE_SCALE, ONE)
    )
    state.apply_block(block(1, timestamp_ms=1_000))
    assert state.accounts["carol"].positions["BTC-PERP"].size == ONE
    assert state.accounts["carol"].collateral == 300 * USDC_SCALE


def test_liquidation_through_a_thin_book_keeps_the_rest_open() -> None:
    state = State([MARKET])
    mark = 10_000 * PRICE_SCALE
    state.oracle_prices["BTC-PERP"] = mark
    state.accounts["alice"] = long_at("alice", 100 * USDC_SCALE, 50_000 * USDC_SCALE, size=3 * ONE)
    inside = 9_600 * PRICE_SCALE
    outside = 9_400 * PRICE_SCALE
    state.books["BTC-PERP"].place(
        Order(1, "bob", "BTC-PERP", Side.BUY, OrderType.LIMIT, inside, ONE)
    )
    state.books["BTC-PERP"].place(
        Order(2, "carol", "BTC-PERP", Side.BUY, OrderType.LIMIT, outside, 10 * ONE)
    )
    state.apply_block(block(1, timestamp_ms=1_000))
    assert [(fill.price, fill.size) for fill in state.block_fills] == [(inside, ONE)]
    assert state.accounts["alice"].positions["BTC-PERP"].size == 2 * ONE
    assert state.books["BTC-PERP"].depth() == {"bids": [(outside, 10 * ONE)], "asks": []}


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


def test_median_price_picks_the_middle_and_averages_an_even_count() -> None:
    def price(value: int) -> OraclePrice:
        return OraclePrice("BTC-PERP", value, 0, {})

    assert median_price([price(10), price(30), price(20)]) == 20
    assert median_price([price(value) for value in (10, 40, 20, 30)]) == 25


def test_mark_follows_the_oracle_inside_the_spread() -> None:
    validator = public_key(VALIDATOR).hex()
    state = State([MARKET], validators={validator})
    bid = place(ALICE, 1, 1, Side.BUY, 100, ONE)
    ask = place(BOB, 1, 2, Side.SELL, 110, ONE)
    state.apply_block(block(1, bid, ask, timestamp_ms=1_000))
    assert state.mark_prices["BTC-PERP"] == 105
    state.apply_block(block(2, oracle(1, price=120), timestamp_ms=2_000))
    assert state.oracle_prices["BTC-PERP"] == 120
    assert state.mark_prices["BTC-PERP"] == 110
    state.apply_block(block(3, oracle(2, price=105), timestamp_ms=3_000))
    assert state.mark_prices["BTC-PERP"] == 105


def test_funding_pays_the_premium_for_elapsed_block_time() -> None:
    keys = [VALIDATOR, OTHER, bytes(range(2, 34))]
    state = State([MARKET], validators={public_key(key).hex() for key in keys})
    alice = fund(state, ALICE, 10_000 * USDC_SCALE)
    bob = fund(state, BOB, 10_000 * USDC_SCALE)
    votes = [
        oracle(1, key=key, price=(49_000 + i * 1_000) * PRICE_SCALE) for i, key in enumerate(keys)
    ]
    opened = block(
        1,
        place(ALICE, 1, 1, Side.SELL, PX, ONE),
        place(BOB, 1, 2, Side.BUY, PX, ONE, OrderType.MARKET),
        place(ALICE, 2, 3, Side.BUY, 51_000 * PRICE_SCALE, ONE),
        place(BOB, 2, 4, Side.SELL, 52_000 * PRICE_SCALE, ONE),
        *votes,
        timestamp_ms=1_000,
    )
    state.apply_block(opened)
    assert state.oracle_prices["BTC-PERP"] == 50_000 * PRICE_SCALE
    assert state.mark_prices["BTC-PERP"] == 51_000 * PRICE_SCALE
    assert state.accounts[alice].collateral == 9_990 * USDC_SCALE
    assert state.accounts[bob].collateral == 9_975 * USDC_SCALE
    state.apply_block(block(2, timestamp_ms=1_000 + HOUR_MS))
    assert state.accounts[bob].collateral == 8_975 * USDC_SCALE
    assert state.accounts[alice].collateral == 10_990 * USDC_SCALE
    state.apply_block(block(3, timestamp_ms=500))
    assert state.accounts[bob].collateral == 8_975 * USDC_SCALE
    state.apply_block(block(4, timestamp_ms=1_000 + HOUR_MS + HOUR_MS // 2))
    assert state.accounts[bob].collateral == 8_475 * USDC_SCALE
    assert state.accounts[alice].collateral == 11_490 * USDC_SCALE
    assert (
        state.accounts[bob].positions["BTC-PERP"].funding_index == state.funding_index["BTC-PERP"]
    )


def test_state_root_hashes_the_canonical_state() -> None:
    state = State([MARKET])
    assert state.state_root() == sha256(
        encode(
            {
                "height": 0,
                "next_order_id": 1,
                "withdrawal_nonce": 0,
                "last_funding_ms": None,
                "markets": [MARKET],
                "validators": [],
                "oracle_voters": [],
                "accounts": {},
                "books": {"BTC-PERP": {"bids": [], "asks": []}},
                "oracle_prices": {},
                "oracle_submissions": {},
                "mark_prices": {},
                "funding_index": {"BTC-PERP": 0},
                "bridge": {
                    "oracle_pubkey": b"",
                    "headers": [],
                    "delivered": [],
                    "outbox": [],
                },
            }
        )
    )


def test_state_root_ignores_insertion_order_and_changes_with_state() -> None:
    left = State([MARKET])
    right = State([MARKET])
    left.accounts["bob"] = Account(
        "bob",
        collateral=1,
        positions={
            "ETH-PERP": Position("ETH-PERP"),
            "BTC-PERP": Position("BTC-PERP", size=1),
        },
    )
    left.accounts["alice"] = Account("alice", collateral=2)
    right.accounts["alice"] = Account("alice", collateral=2)
    right.accounts["bob"] = Account(
        "bob",
        collateral=1,
        positions={
            "BTC-PERP": Position("BTC-PERP", size=1),
            "ETH-PERP": Position("ETH-PERP"),
        },
    )
    left.bridge.delivered.add((2, 1))
    left.bridge.delivered.add((1, 9))
    right.bridge.delivered.add((1, 9))
    right.bridge.delivered.add((2, 1))
    assert left.state_root() == right.state_root()

    left.apply_tx(place(ALICE, 1, 1, Side.BUY, 100, ONE), 0)
    left.apply_tx(place(ALICE, 2, 2, Side.BUY, 100, ONE), 0)
    right.apply_tx(place(ALICE, 1, 2, Side.BUY, 100, ONE), 0)
    right.apply_tx(place(ALICE, 2, 1, Side.BUY, 100, ONE), 0)
    assert left.state_root() != right.state_root()

    same_a = State([MARKET], validators={public_key(VALIDATOR).hex()})
    same_b = State([MARKET], validators={public_key(VALIDATOR).hex()})
    fund(same_a, ALICE, 1_000 * USDC_SCALE)
    fund(same_a, BOB, 1_000 * USDC_SCALE)
    fund(same_b, BOB, 1_000 * USDC_SCALE)
    fund(same_b, ALICE, 1_000 * USDC_SCALE)
    trades = block(
        1,
        place(ALICE, 1, 1, Side.SELL, PX, ONE),
        place(BOB, 1, 2, Side.BUY, PX, ONE, OrderType.MARKET),
        oracle(1, price=PX),
        timestamp_ms=1_000,
    )
    same_a.apply_block(trades)
    same_b.apply_block(trades)
    assert same_a.state_root() == same_b.state_root()
    same_b.apply_block(block(2, timestamp_ms=2_000))
    assert same_a.state_root() != same_b.state_root()


def test_from_bytes_restores_the_state_root() -> None:
    state = State([MARKET], validators={public_key(VALIDATOR).hex()})
    alice = fund(state, ALICE, 1_000 * USDC_SCALE)
    state.accounts[alice].positions["BTC-PERP"] = Position("BTC-PERP", size=ONE, entry_notional=5)
    state.apply_block(block(1, place(ALICE, 1, 7, Side.BUY, PX, ONE), timestamp_ms=1_000))
    state.bridge.oracle_pubkey = b"oracle"
    state.bridge.headers[(1, 2)] = BlockHeader(1, 2, b"\x11" * 32, b"\x22" * 32)
    state.bridge.delivered.add((1, 4))
    state.bridge.outbox.append(BridgeMessage(1, 2, 3, "alice", "bob", 5))
    restored = State.from_bytes(state.to_bytes())
    assert restored.state_root() == state.state_root()
    assert restored.height == 1
    assert restored.accounts[alice].collateral == 1_000 * USDC_SCALE
    assert restored.accounts[alice].positions["BTC-PERP"].size == ONE
    assert restored.books["BTC-PERP"].best_bid() == PX
    assert restored.bridge.oracle_pubkey == b"oracle"
    assert restored.bridge.delivered == {(1, 4)}
    assert restored.markets["BTC-PERP"] == MARKET
