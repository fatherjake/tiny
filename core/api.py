"""HTTP + WebSocket API in front of one validator.

REST: POST /tx, GET /book/{market}, GET /account/{trader}, GET /markets, GET /status.
WS:   /ws streams book depth and new committed blocks.
Serves ui.html at /.

JSON is untrusted: it is parsed into core.types here, once, and nothing past this file sees a dict.
Bytes travel as hex strings. Amounts, prices and sizes are integers in the scales in core.types.

Budget: < 1,000 lines.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import assert_never

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from core.node import Node
from core.types import (
    Account,
    Block,
    BlockHeader,
    BridgeMessage,
    CancelOrder,
    Deposit,
    MessageProof,
    OraclePrice,
    Order,
    OrderType,
    PlaceOrder,
    PostHeader,
    SetOraclePrice,
    Side,
    Tx,
    TxBody,
    Withdraw,
)

UI_PATH = Path(__file__).with_name("ui.html")
WS_INTERVAL_S = 0.25


class BadRequest(ValueError):
    """Raised while parsing untrusted JSON; becomes a 400."""


# ---------------------------------------------------------------- parsing (JSON -> types)


def get(data: object, key: str) -> object:
    if not isinstance(data, dict) or key not in data:
        raise BadRequest(f"missing field {key!r}")
    return data[key]


def get_int(data: object, key: str) -> int:
    value = get(data, key)
    if not isinstance(value, int) or isinstance(value, bool):
        raise BadRequest(f"{key!r} must be an integer")
    return value


def get_str(data: object, key: str) -> str:
    value = get(data, key)
    if not isinstance(value, str):
        raise BadRequest(f"{key!r} must be a string")
    return value


def get_bytes(data: object, key: str) -> bytes:
    try:
        return bytes.fromhex(get_str(data, key))
    except ValueError as err:
        raise BadRequest(f"{key!r} must be hex") from err


def get_bool(data: object, key: str, default: bool) -> bool:
    if not isinstance(data, dict) or key not in data:
        return default
    value = data[key]
    if not isinstance(value, bool):
        raise BadRequest(f"{key!r} must be a boolean")
    return value


def parse_enum[E: (Side, OrderType)](enum: type[E], data: object, key: str) -> E:
    try:
        return enum(get_str(data, key))
    except ValueError as err:
        raise BadRequest(f"bad {key!r}") from err


def parse_order(data: object) -> Order:
    return Order(
        id=get_int(data, "id"),
        trader=get_str(data, "trader"),
        market=get_str(data, "market"),
        side=parse_enum(Side, data, "side"),
        type=parse_enum(OrderType, data, "type"),
        price=get_int(data, "price"),
        size=get_int(data, "size"),
        reduce_only=get_bool(data, "reduce_only", False),
    )


def parse_header(data: object) -> BlockHeader:
    return BlockHeader(
        chain_id=get_int(data, "chain_id"),
        height=get_int(data, "height"),
        block_hash=get_bytes(data, "block_hash"),
        receipts_root=get_bytes(data, "receipts_root"),
    )


def parse_message(data: object) -> BridgeMessage:
    return BridgeMessage(
        src_chain=get_int(data, "src_chain"),
        src_height=get_int(data, "src_height"),
        nonce=get_int(data, "nonce"),
        sender=get_str(data, "sender"),
        recipient=get_str(data, "recipient"),
        amount=get_int(data, "amount"),
    )


def parse_proof(data: object) -> MessageProof:
    siblings = get(data, "siblings")
    if not isinstance(siblings, list) or not all(isinstance(s, str) for s in siblings):
        raise BadRequest("'siblings' must be a list of hex strings")
    try:
        sibling_bytes = tuple(bytes.fromhex(s) for s in siblings)
    except ValueError as err:
        raise BadRequest("'siblings' must be hex") from err
    return MessageProof(
        message=parse_message(get(data, "message")),
        leaf_index=get_int(data, "leaf_index"),
        siblings=sibling_bytes,
    )


def parse_body(data: object) -> TxBody:
    match get_str(data, "type"):
        case "place_order":
            return PlaceOrder(parse_order(get(data, "order")))
        case "cancel_order":
            return CancelOrder(
                get_str(data, "trader"), get_str(data, "market"), get_int(data, "order_id")
            )
        case "set_oracle_price":
            price = OraclePrice(
                get_str(data, "market"), get_int(data, "price"), get_int(data, "timestamp_ms"), {}
            )
            return SetOraclePrice(price)
        case "post_header":
            return PostHeader(parse_header(get(data, "header")), get_bytes(data, "oracle_sig"))
        case "deposit":
            return Deposit(parse_proof(get(data, "proof")))
        case "withdraw":
            return Withdraw(
                trader=get_str(data, "trader"),
                amount=get_int(data, "amount"),
                dest_chain=get_int(data, "dest_chain"),
                dest_address=get_str(data, "dest_address"),
            )
        case other:
            raise BadRequest(f"unknown tx type {other!r}")


def parse_tx(data: object) -> Tx:
    """Expects {"body": {"type": ..., ...}, "signer": str, "nonce": int, "sig": hex}."""
    return Tx(
        body=parse_body(get(data, "body")),
        signer=get_str(data, "signer"),
        nonce=get_int(data, "nonce"),
        sig=get_bytes(data, "sig"),
    )


# ---------------------------------------------------------------- rendering (types -> JSON)


def tx_kind(body: TxBody) -> str:
    match body:
        case PlaceOrder():
            return "place_order"
        case CancelOrder():
            return "cancel_order"
        case SetOraclePrice():
            return "set_oracle_price"
        case PostHeader():
            return "post_header"
        case Deposit():
            return "deposit"
        case Withdraw():
            return "withdraw"
        case _:
            assert_never(body)


def account_json(account: Account) -> dict[str, object]:
    positions = [
        {
            "market": p.market,
            "size": p.size,
            "entry_notional": p.entry_notional,
            "funding_index": p.funding_index,
        }
        for _, p in sorted(account.positions.items())
    ]
    return {
        "trader": account.trader,
        "collateral": account.collateral,
        "nonce": account.nonce,
        "positions": positions,
    }


def block_json(height: int, block: Block) -> dict[str, object]:
    return {
        "height": height,
        "hash": block.hash.hex(),
        "parent": block.parent.hex(),
        "view": block.view,
        "proposer": block.proposer,
        "timestamp_ms": block.timestamp_ms,
        "txs": [
            {"type": tx_kind(tx.body), "signer": tx.signer, "nonce": tx.nonce} for tx in block.txs
        ],
    }


def book_json(node: Node, market: str, levels: int) -> dict[str, object]:
    book = node.state.books.get(market)
    if book is None:
        raise HTTPException(404, f"unknown market {market!r}")
    return {
        "market": market,
        "best_bid": book.best_bid(),
        "best_ask": book.best_ask(),
        "oracle_price": node.state.oracle_prices.get(market),
        "mark_price": node.state.mark_prices.get(market),
        **book.depth(levels),
    }


# ---------------------------------------------------------------- app


def create_app(node: Node) -> FastAPI:
    app = FastAPI(title="tiny")

    @app.get("/", response_class=HTMLResponse)
    def ui() -> str:
        return UI_PATH.read_text()

    @app.post("/tx")
    def submit_tx(payload: dict[str, object]) -> dict[str, object]:
        try:
            tx = parse_tx(payload)
        except BadRequest as err:
            raise HTTPException(400, str(err)) from err
        if not node.submit(tx):
            raise HTTPException(400, "rejected: bad signature, stale nonce or duplicate")
        return {"accepted": True, "signer": tx.signer, "nonce": tx.nonce}

    @app.get("/markets")
    def markets() -> list[dict[str, object]]:
        return [
            {
                "name": m.name,
                "tick_size": m.tick_size,
                "lot_size": m.lot_size,
                "max_leverage": m.max_leverage,
                "maintenance_margin_bps": m.maintenance_margin_bps,
                "oracle_price": node.state.oracle_prices.get(m.name),
                "mark_price": node.state.mark_prices.get(m.name),
                "funding_index": node.state.funding_index[m.name],
            }
            for _, m in sorted(node.state.markets.items())
        ]

    @app.get("/book/{market}")
    def book(market: str, levels: int = 20) -> dict[str, object]:
        return book_json(node, market, levels)

    @app.get("/account/{trader}")
    def account(trader: str) -> dict[str, object]:
        found = node.state.accounts.get(trader)
        if found is None:
            raise HTTPException(404, f"no account {trader!r}")
        value, maintenance = node.state.margin(trader)
        return {**account_json(found), "account_value": value, "maintenance_margin": maintenance}

    @app.get("/status")
    def status() -> dict[str, object]:
        tip = node.committed[-1] if node.committed else None
        return {
            "node": node.id,
            "height": node.state.height,
            "view": node.replica.view,
            "tip": tip.hash.hex() if tip else None,
            "mempool": len(node.mempool.pending),
            "state_root": node.state.state_root().hex(),
        }

    @app.websocket("/ws")
    async def stream(socket: WebSocket) -> None:
        """Push new blocks as they commit, and each market's depth when the height moves."""
        await socket.accept()
        seen = len(node.committed)
        try:
            while True:
                fresh = node.committed[seen:]
                for offset, block in enumerate(fresh):
                    await socket.send_json(
                        {"type": "block", **block_json(seen + offset + 1, block)}
                    )
                if fresh:
                    seen += len(fresh)
                    for market in sorted(node.state.books):
                        await socket.send_json({"type": "book", **book_json(node, market, 20)})
                await asyncio.sleep(WS_INTERVAL_S)
        except WebSocketDisconnect:
            return

    return app
