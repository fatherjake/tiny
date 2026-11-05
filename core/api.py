"""
    HTTP + WebSocket API

    POST /tx                        -> accept a signed tx into the mempool
    GET /book/{market}              -> bid and ask depth, with the oracle and mark
    GET /account/{trader}           -> collateral, positions, value and maintenance margin
    GET /markets                    -> each market's oracle, mark, fees, funding index and hour-old index
    GET /trades                     -> recent trades, newest first
    GET /status                     -> height, view, tip, mempool size and state root
    GET /trades/{market}            -> paged fills for one market
    GET /accounts/{addr}/fills      -> paged fills for one account
    GET /accounts/{addr}/orders     -> open orders, or paged order history
    GET /candles/{market}           -> open, high, low, close and volume
    GET /funding/{market}           -> recent funding index and rate
    WS: /ws                         -> streams new committed blocks, book depth, and trades.
"""

from __future__ import annotations

import asyncio

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import ConfigDict, RootModel, ValidationError

from core.node import Node
from core.state import HOUR_MS, MAKER_FEE_BPS, TAKER_FEE_BPS
from core.types import Account, Block, Market, Tx

WS_INTERVAL_S = 0.25
MAX_LIMIT = 500
JSON_CONFIG = ConfigDict(strict=True, val_json_bytes="hex", ser_json_bytes="hex")


def _limit(limit: int) -> int:
    if limit < 1:
        raise HTTPException(400, "limit must be positive")
    return min(limit, MAX_LIMIT)


def _fill_cursor(
    height: int | None, tx_index: int | None, row_id: int | None
) -> tuple[int, int, int] | None:
    if height is None and tx_index is None and row_id is None:
        return None
    if height is None or tx_index is None or row_id is None:
        raise HTTPException(400, "before_height, before_tx and before_id are set together")
    return height, tx_index, row_id


def _order_cursor(height: int | None, order_id: int | None) -> tuple[int, int] | None:
    if height is None and order_id is None:
        return None
    if height is None or order_id is None:
        raise HTTPException(400, "before_height and before_order are set together")
    return height, order_id


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
        now = state.last_funding_ms
        return [
            {
                **MarketJson(market).model_dump(),
                "oracle_price": state.oracle_prices.get(name),
                "mark_price": state.mark_prices.get(name),
                "funding_index": state.funding_index[name],
                "funding_ts": now,
                "maker_fee_bps": MAKER_FEE_BPS,
                "taker_fee_bps": TAKER_FEE_BPS,
                # The oldest funding row in the last hour, to average the rate over.
                "funding_base": None
                if now is None
                else node.store.funding_since(name, now - HOUR_MS),
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
        # Report the settled view. The account itself stays lazy so a read cannot move state_root.
        body["collateral"] = found.collateral - node.state.funding_payment(found)
        for name, pos in body["positions"].items():
            pos["funding_index"] = node.state.funding_index[name]
        return {**body, "account_value": value, "maintenance_margin": maintenance}

    @app.get("/status")
    def status() -> dict[str, object]:
        return {
            "node": node.id,
            "height": node.state.height,
            "view": node.consensus.view,
            "tip": node.committed[-1].hash.hex() if node.committed else None,
            "mempool": len(node.mempool.pending),
            "state_root": node.state.state_root().hex(),
        }

    @app.get("/trades")
    def trades(market: str = "", limit: int = 40) -> list[dict[str, object]]:
        rows = [row for row in node.trades if not market or row["market"] == market]
        return list(reversed(rows[-limit:]))

    @app.get("/trades/{market}")
    def market_trades(
        market: str,
        limit: int = 40,
        before_height: int | None = None,
        before_tx: int | None = None,
        before_id: int | None = None,
    ) -> list[dict[str, object]]:
        before = _fill_cursor(before_height, before_tx, before_id)
        return node.store.recent_trades(market, _limit(limit), before)

    @app.get("/accounts/{addr}/fills")
    def account_fills(
        addr: str,
        limit: int = 40,
        before_height: int | None = None,
        before_tx: int | None = None,
        before_id: int | None = None,
    ) -> list[dict[str, object]]:
        before = _fill_cursor(before_height, before_tx, before_id)
        return node.store.trades_for(addr, _limit(limit), before)

    @app.get("/accounts/{addr}/orders")
    def account_orders(
        addr: str,
        status: str = "",
        limit: int = 40,
        before_height: int | None = None,
        before_order: int | None = None,
    ) -> list[dict[str, object]]:
        if status == "open":
            return node.store.open_orders(addr)
        if status not in ("", "history"):
            raise HTTPException(400, "status must be open or history")
        before = _order_cursor(before_height, before_order)
        return node.store.order_history(addr, _limit(limit), before)

    @app.get("/candles/{market}")
    def candles(
        market: str,
        interval: str = "1m",
        start: int | None = None,
        end: int | None = None,
    ) -> list[dict[str, object]]:
        try:
            return node.store.candles(market, interval, start, end)
        except ValueError as err:
            raise HTTPException(400, str(err)) from err

    @app.get("/funding/{market}")
    def funding(market: str, limit: int = 40) -> list[dict[str, object]]:
        return node.store.funding_history(market, _limit(limit))

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
