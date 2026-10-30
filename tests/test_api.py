import json

import pytest
from pydantic import ValidationError

from core.api import parse_tx
from core.types import Deposit, OrderType, PlaceOrder, SetOraclePrice, Side, Withdraw


def tx_json(body: dict[str, object], nonce: object = 1, sig: str = "ab") -> str:
    return json.dumps({"body": body, "signer": "alice", "nonce": nonce, "sig": sig})


ORDER = {
    "id": 1,
    "trader": "alice",
    "market": "BTC-PERP",
    "side": "buy",
    "type": "limit",
    "price": 60_000_000_000,
    "size": 1_000_000,
}


def test_parse_place_order() -> None:
    tx = parse_tx(tx_json({"kind": "place_order", "order": ORDER}))
    assert isinstance(tx.body, PlaceOrder)
    assert tx.body.order.side is Side.BUY
    assert tx.body.order.type is OrderType.LIMIT
    assert tx.body.order.reduce_only is False
    assert tx.sig == b"\xab"


def test_parse_withdraw() -> None:
    body = {"kind": "withdraw", "trader": "bob", "amount": 5, "dest_chain": 1, "dest_address": "0x"}
    assert parse_tx(tx_json(body)).body == Withdraw("bob", 5, 1, "0x")


def test_parse_nested_bytes_and_int_keys() -> None:
    message = {
        "src_chain": 1,
        "src_height": 9,
        "nonce": 0,
        "sender": "s",
        "recipient": "r",
        "amount": 7,
    }
    proof = {"message": message, "leaf_index": 0, "siblings": ["00" * 32, "ff" * 32]}
    deposit = parse_tx(tx_json({"kind": "deposit", "proof": proof})).body
    assert isinstance(deposit, Deposit)
    assert deposit.proof.siblings == (bytes(32), b"\xff" * 32)
    price = {"market": "BTC-PERP", "price": 1, "timestamp_ms": 2, "sigs": {"3": "aa"}}
    oracle = parse_tx(tx_json({"kind": "set_oracle_price", "price": price})).body
    assert isinstance(oracle, SetOraclePrice)
    assert oracle.price.sigs == {3: b"\xaa"}


@pytest.mark.parametrize(
    "raw",
    [
        "{}",
        tx_json({"kind": "nope"}),
        tx_json({"kind": "withdraw"}),
        tx_json(
            {"kind": "withdraw", "trader": "a", "amount": "5", "dest_chain": 1, "dest_address": "x"}
        ),
        tx_json({"kind": "cancel_order", "trader": "a", "market": "m", "order_id": 1}, nonce=True),
        tx_json({"kind": "cancel_order", "trader": "a", "market": "m", "order_id": 1}, sig="zz"),
        tx_json({"kind": "place_order", "order": {**ORDER, "side": "up"}}),
    ],
)
def test_parse_rejects_bad_json(raw: str) -> None:
    with pytest.raises(ValidationError):
        parse_tx(raw)
