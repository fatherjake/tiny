"""HTTP + WebSocket API in front of one validator.

REST: POST /tx, GET /book/{market}, GET /account/{trader}, GET /markets, GET /trades, GET /status.
WS:   /ws streams new committed blocks, book depth, and trades.
Serves ui.html at /.

JSON is untrusted. Pydantic decodes it straight into the dataclasses in core.types (strict: no
str -> int coercion), once, here; nothing past this file sees a dict. Bytes travel as hex strings,
and each tx body says which variant it is with its `kind` tag.

Budget: < 1,000 lines.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from pydantic import ConfigDict, RootModel, ValidationError

from core.node import Node
from core.types import Account, Block, Market, Tx

UI_PATH = Path(__file__).with_name("ui.html")
WS_INTERVAL_S = 0.25
JSON_CONFIG = ConfigDict(strict=True, val_json_bytes="hex", ser_json_bytes="hex")


# RootModel wrappers carry the JSON config down into the plain dataclasses inside them.
class TxJson(RootModel[Tx]):
    model_config = JSON_CONFIG


class AccountJson(RootModel[Account]):
    model_config = JSON_CONFIG


class MarketJson(RootModel[Market]):
    model_config = JSON_CONFIG


def parse_tx(raw: bytes | str) -> Tx:
    """Raises pydantic.ValidationError naming the bad field."""
    return TxJson.model_validate_json(raw).root


def block_json(height: int, block: Block) -> dict[str, object]:
    txs = [{"kind": tx.body.kind, "signer": tx.signer, "nonce": tx.nonce} for tx in block.txs]
    return {
        "height": height,
        "hash": block.hash.hex(),
        "parent": block.parent.hex(),
        "view": block.view,
        "proposer": block.proposer,
        "timestamp_ms": block.timestamp_ms,
        "txs": txs,
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


def create_app(node: Node) -> FastAPI:
    app = FastAPI(title="tiny")

    @app.get("/", response_class=HTMLResponse)
    def ui() -> str:
        return UI_PATH.read_text()

    @app.post("/tx")
    def submit_tx(raw: bytes = Body(media_type="application/json")) -> dict[str, object]:
        try:
            tx = parse_tx(raw)
        except ValidationError as err:
            raise HTTPException(422, err.errors(include_url=False)) from err
        if not node.submit(tx):
            raise HTTPException(400, "rejected: bad signature, stale nonce or duplicate")
        return {"accepted": True, "signer": tx.signer, "nonce": tx.nonce}

    @app.get("/markets")
    def markets() -> list[dict[str, object]]:
        state = node.state
        return [
            {
                **MarketJson(market).model_dump(),
                "oracle_price": state.oracle_prices.get(name),
                "mark_price": state.mark_prices.get(name),
                "funding_index": state.funding_index[name],
            }
            for name, market in sorted(state.markets.items())
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
        body = AccountJson(found).model_dump(mode="json")
        return {**body, "account_value": value, "maintenance_margin": maintenance}

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

    @app.get("/trades")
    def trades(market: str = "", limit: int = 40) -> list[dict[str, object]]:
        rows = [row for row in node.trades if not market or row["market"] == market]
        return list(reversed(rows[-limit:]))

    @app.websocket("/ws")
    async def stream(socket: WebSocket) -> None:
        """Push new blocks as they commit, then each market's depth and any trades."""
        await socket.accept()
        seen = len(node.committed)
        seen_trade = node.trade_seq
        try:
            while True:
                fresh = node.committed[seen:]
                for offset, block in enumerate(fresh):
                    await socket.send_json(
                        {"type": "block", **block_json(seen + offset + 1, block)}
                    )
                if fresh:
                    seen += len(fresh)
                    for name in sorted(node.state.books):
                        await socket.send_json({"type": "book", **book_json(node, name, 20)})
                fresh_trades = [row for row in node.trades if int(row["seq"]) > seen_trade]
                for row in fresh_trades:
                    await socket.send_json({"type": "trade", **row})
                    seen_trade = int(row["seq"])
                await asyncio.sleep(WS_INTERVAL_S)
        except WebSocketDisconnect:
            return

    return app
