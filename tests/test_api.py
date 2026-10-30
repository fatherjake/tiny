import pytest

from core.api import BadRequest, parse_tx
from core.types import OrderType, PlaceOrder, Side, Withdraw


def test_parse_place_order() -> None:
    order = {
        "id": 1,
        "trader": "alice",
        "market": "BTC-PERP",
        "side": "buy",
        "type": "limit",
        "price": 60_000_000_000,
        "size": 1_000_000,
    }
    tx = parse_tx(
        {
            "body": {"type": "place_order", "order": order},
            "signer": "alice",
            "nonce": 1,
            "sig": "ab",
        }
    )
    assert isinstance(tx.body, PlaceOrder)
    assert tx.body.order.side is Side.BUY
    assert tx.body.order.type is OrderType.LIMIT
    assert tx.sig == b"\xab"


def test_parse_withdraw() -> None:
    body = {"type": "withdraw", "trader": "bob", "amount": 5, "dest_chain": 1, "dest_address": "0x"}
    tx = parse_tx({"body": body, "signer": "bob", "nonce": 2, "sig": ""})
    assert tx.body == Withdraw("bob", 5, 1, "0x")


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"body": {"type": "nope"}, "signer": "a", "nonce": 1, "sig": ""},
        {"body": {"type": "withdraw"}, "signer": "a", "nonce": 1, "sig": ""},
        {
            "body": {
                "type": "withdraw",
                "trader": "a",
                "amount": "5",
                "dest_chain": 1,
                "dest_address": "x",
            },
            "signer": "a",
            "nonce": 1,
            "sig": "",
        },
        {
            "body": {"type": "cancel_order", "trader": "a", "market": "m", "order_id": 1},
            "signer": "a",
            "nonce": True,
            "sig": "",
        },
        {
            "body": {"type": "cancel_order", "trader": "a", "market": "m", "order_id": 1},
            "signer": "a",
            "nonce": 1,
            "sig": "zz",
        },
    ],
)
def test_parse_rejects_bad_json(payload: object) -> None:
    with pytest.raises(BadRequest):
        parse_tx(payload)
