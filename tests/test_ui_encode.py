"""Golden strings shared with ui/src/lib/encode.ts. encode() must emit them unchanged."""

from core.types import (
    CancelOrder,
    OraclePrice,
    Order,
    OrderType,
    PlaceOrder,
    SetOraclePrice,
    Side,
    encode,
)


def test_place_order_matches_the_ui_encoder() -> None:
    body = PlaceOrder(
        Order(1, "alice", "BTC-PERP", Side.BUY, OrderType.LIMIT, 60_000_000_000, 1_000_000, False)
    )
    assert encode(body).decode() == (
        '{"kind":"place_order","order":{"id":1,"market":"BTC-PERP","price":60000000000,'
        '"reduce_only":false,"side":"buy","size":1000000,"trader":"alice","type":"limit"}}'
    )


def test_cancel_order_matches_the_ui_encoder() -> None:
    body = CancelOrder('a"b\\c', "BTC-PERP", 7)
    assert encode(body).decode() == (
        '{"kind":"cancel_order","market":"BTC-PERP","order_id":7,"trader":"a\\"b\\\\c"}'
    )


def test_oracle_bytes_and_large_int_match_the_ui_encoder() -> None:
    body = SetOraclePrice(OraclePrice("BTC-PERP", 2**60, 2, {10: b"\xff", 2: b"\x00"}))
    assert encode(body).decode() == (
        '{"kind":"set_oracle_price","price":{"market":"BTC-PERP",'
        '"price":1152921504606846976,"sigs":{"10":"ff","2":"00"},"timestamp_ms":2}}'
    )
