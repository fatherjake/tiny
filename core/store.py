"""Query tables for the API. Consensus never reads them.

A committed block and the events from applying it land in one transaction. Drop the
tables and `rebuild_indexes` replays the block log from genesis.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Protocol
from urllib.request import pathname2url

from pydantic import ConfigDict, RootModel

from core.state import State
from core.types import QC, Block, Fill, FundingEvent, Market, OrderEvent, encode

INTERVALS = {"1s": 1_000, "1m": 60_000, "5m": 300_000, "1h": 3_600_000}
_JSON = ConfigDict(strict=True, val_json_bytes="hex", ser_json_bytes="hex")
Row = dict[str, object]
Cursor = tuple[int, int, int]
OrderCursor = tuple[int, int]


class _BlockJson(RootModel[Block]):
    model_config = _JSON


def decode_block(data: bytes) -> Block:
    return _BlockJson.model_validate_json(data).root


class _QcJson(RootModel[QC]):
    model_config = _JSON


def decode_qc(data: bytes) -> QC:
    return _QcJson.model_validate_json(data).root


def _fill_row(fill: Fill, row_id: int) -> Row:
    return {
        "id": row_id,
        "height": fill.height,
        "tx_index": fill.tx_index,
        "market": fill.market,
        "price": fill.price,
        "size": fill.size,
        "taker": fill.taker,
        "maker": fill.maker,
        "side": fill.taker_side.value,
        "liquidation": fill.liquidation,
        "ts": fill.ts,
    }


def _insert_order(orders: dict[tuple[str, int], Row], event: OrderEvent) -> None:
    row = orders.get((event.trader, event.order_id))
    if row is None:
        orders[(event.trader, event.order_id)] = {
            "order_id": event.order_id,
            "trader": event.trader,
            "market": event.market,
            "side": event.side.value,
            "type": event.type.value,
            "price": event.price,
            "size": event.size,
            "remaining": event.remaining_size,
            "status": event.kind,
            "reason": event.reason,
            "created_height": event.height,
            "updated_height": event.height,
        }
        return
    row["remaining"] = event.remaining_size
    row["status"] = event.kind
    row["reason"] = event.reason
    row["updated_height"] = event.height


def _start(markets: list[Market], validators: set[str], genesis: State | None) -> State:
    if genesis is None:
        return State(markets, validators)
    return State.from_bytes(genesis.to_bytes())


def _funding_row(event: FundingEvent) -> Row:
    return {
        "height": event.height,
        "market": event.market,
        "index": event.index,
        "rate": event.rate,
        "ts": event.ts,
    }


def _before_fill(row: Row, before: Cursor | None) -> bool:
    if before is None:
        return True
    return (int(row["height"]), int(row["tx_index"]), int(row["id"])) < before


def _page_fills(
    rows: Sequence[Row],
    *,
    market: str,
    trader: str,
    limit: int,
    before: Cursor | None,
) -> list[Row]:
    chosen = [
        row
        for row in rows
        if (not market or row["market"] == market)
        and (not trader or row["taker"] == trader or row["maker"] == trader)
        and _before_fill(row, before)
    ]
    chosen.sort(
        key=lambda row: (int(row["height"]), int(row["tx_index"]), int(row["id"])), reverse=True
    )
    return [dict(row) for row in chosen[:limit]]


def _candles(
    rows: Sequence[Row], market: str, interval: str, start: int | None, end: int | None
) -> list[Row]:
    width = INTERVALS.get(interval)
    if width is None:
        raise ValueError(f"unknown interval {interval!r}")
    buckets: dict[int, list[Row]] = {}
    for row in rows:
        if row["market"] != market:
            continue
        ts = int(row["ts"])
        if start is not None and ts < start:
            continue
        if end is not None and ts >= end:
            continue
        buckets.setdefault(ts // width * width, []).append(row)
    out: list[Row] = []
    for bucket in sorted(buckets):
        group = sorted(
            buckets[bucket],
            key=lambda row: (int(row["height"]), int(row["tx_index"]), int(row["id"])),
        )
        prices = [int(row["price"]) for row in group]
        out.append(
            {
                "ts": bucket,
                "open": prices[0],
                "high": max(prices),
                "low": min(prices),
                "close": prices[-1],
                "volume": sum(int(row["size"]) for row in group),
            }
        )
    return out


class Store(Protocol):
    def append_block(
        self,
        block: Block,
        events: Sequence[Fill | OrderEvent | FundingEvent],
        qc: QC | None = None,
    ) -> None: ...

    def committed_blocks(self) -> tuple[Block, ...]: ...

    def tip_qc(self) -> QC | None: ...

    def recent_trades(self, market: str, limit: int, before: Cursor | None = None) -> list[Row]: ...

    def trades_for(self, trader: str, limit: int, before: Cursor | None = None) -> list[Row]: ...

    def open_orders(self, trader: str) -> list[Row]: ...

    def order_history(
        self, trader: str, limit: int, before: OrderCursor | None = None
    ) -> list[Row]: ...

    def candles(
        self, market: str, interval: str, start: int | None, end: int | None
    ) -> list[Row]: ...

    def funding_history(self, market: str, limit: int) -> list[Row]: ...

    def funding_since(self, market: str, ts: int) -> Row | None: ...

    def rebuild_indexes(self, genesis: State | None = None) -> None: ...


class MemoryStore:
    """The sim's store. Same reads as SqliteStore, no file."""

    def __init__(self, markets: list[Market], validators: Iterable[str] = ()) -> None:
        self.markets = list(markets)
        self.validators = set(validators)
        self._lock = threading.Lock()
        self._blocks: list[Block] = []
        self._tip: QC | None = None
        self._fills: list[Row] = []
        self._orders: dict[tuple[str, int], Row] = {}
        self._funding: list[Row] = []
        self._next_fill = 1

    def append_block(
        self,
        block: Block,
        events: Sequence[Fill | OrderEvent | FundingEvent],
        qc: QC | None = None,
    ) -> None:
        with self._lock:
            self._blocks.append(block)
            if qc is not None:
                self._tip = qc
            self._apply(events)

    def committed_blocks(self) -> tuple[Block, ...]:
        with self._lock:
            return tuple(self._blocks)

    def tip_qc(self) -> QC | None:
        return self._tip

    def recent_trades(self, market: str, limit: int, before: Cursor | None = None) -> list[Row]:
        with self._lock:
            return _page_fills(self._fills, market=market, trader="", limit=limit, before=before)

    def trades_for(self, trader: str, limit: int, before: Cursor | None = None) -> list[Row]:
        with self._lock:
            return _page_fills(self._fills, market="", trader=trader, limit=limit, before=before)

    def open_orders(self, trader: str) -> list[Row]:
        with self._lock:
            rows = [
                dict(row)
                for row in self._orders.values()
                if row["trader"] == trader
                and row["status"] in ("placed", "partial")
                and int(row["remaining"]) > 0
            ]
        rows.sort(key=lambda row: (int(row["updated_height"]), int(row["order_id"])), reverse=True)
        return rows

    def order_history(
        self, trader: str, limit: int, before: OrderCursor | None = None
    ) -> list[Row]:
        with self._lock:
            rows = [dict(row) for row in self._orders.values() if row["trader"] == trader]
        if before is not None:
            rows = [
                row for row in rows if (int(row["updated_height"]), int(row["order_id"])) < before
            ]
        rows.sort(key=lambda row: (int(row["updated_height"]), int(row["order_id"])), reverse=True)
        return rows[:limit]

    def candles(self, market: str, interval: str, start: int | None, end: int | None) -> list[Row]:
        with self._lock:
            return _candles(self._fills, market, interval, start, end)

    def funding_history(self, market: str, limit: int) -> list[Row]:
        with self._lock:
            rows = [dict(row) for row in self._funding if row["market"] == market]
        rows.sort(key=lambda row: int(row["height"]), reverse=True)
        return rows[:limit]

    def funding_since(self, market: str, ts: int) -> Row | None:
        with self._lock:
            rows = [row for row in self._funding if row["market"] == market and row["ts"] >= ts]
        return dict(rows[0]) if rows else None

    def rebuild_indexes(self, genesis: State | None = None) -> None:
        """Replay the log. Pass `genesis` when balances were credited before block 1."""
        with self._lock:
            blocks = list(self._blocks)
            self._clear()
            state = _start(self.markets, self.validators, genesis)
            for block in blocks:
                state.apply_block(block)
                self._apply(state.events)

    def _clear(self) -> None:
        self._fills = []
        self._orders = {}
        self._funding = []
        self._next_fill = 1

    def _apply(self, events: Sequence[Fill | OrderEvent | FundingEvent]) -> None:
        for event in events:
            if isinstance(event, Fill):
                self._fills.append(_fill_row(event, self._next_fill))
                self._next_fill += 1
            elif isinstance(event, OrderEvent):
                _insert_order(self._orders, event)
            elif isinstance(event, FundingEvent):
                self._funding.append(_funding_row(event))
            else:
                raise TypeError(f"unknown event {type(event).__name__}")


_SCHEMA = """
CREATE TABLE IF NOT EXISTS blocks (
    height INTEGER PRIMARY KEY,
    body BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS fills (
    id INTEGER PRIMARY KEY,
    height INTEGER NOT NULL,
    tx_index INTEGER NOT NULL,
    market TEXT NOT NULL,
    price INTEGER NOT NULL,
    size INTEGER NOT NULL,
    taker TEXT NOT NULL,
    maker TEXT NOT NULL,
    side TEXT NOT NULL,
    liquidation INTEGER NOT NULL,
    ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fills_market_height ON fills (market, height);
CREATE INDEX IF NOT EXISTS fills_taker ON fills (taker);
CREATE INDEX IF NOT EXISTS fills_maker ON fills (maker);
CREATE INDEX IF NOT EXISTS fills_market_ts ON fills (market, ts);
CREATE TABLE IF NOT EXISTS orders (
    order_id INTEGER NOT NULL,
    trader TEXT NOT NULL,
    market TEXT NOT NULL,
    side TEXT NOT NULL,
    type TEXT NOT NULL,
    price INTEGER NOT NULL,
    size INTEGER NOT NULL,
    remaining INTEGER NOT NULL,
    status TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_height INTEGER NOT NULL,
    updated_height INTEGER NOT NULL,
    PRIMARY KEY (trader, order_id)
);
CREATE INDEX IF NOT EXISTS orders_trader_status ON orders (trader, status);
CREATE INDEX IF NOT EXISTS orders_market_status ON orders (market, status);
CREATE TABLE IF NOT EXISTS funding (
    height INTEGER NOT NULL,
    market TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    rate INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    PRIMARY KEY (height, market)
);
CREATE INDEX IF NOT EXISTS funding_market_ts ON funding (market, ts);
CREATE TABLE IF NOT EXISTS tip (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    qc BLOB NOT NULL
);
"""

_NEWEST_COLUMN = {"orders": "reason", "funding": "ts"}

_STATEMENTS = [statement.strip() for statement in _SCHEMA.split(";") if statement.strip()]

# Fill ids grow in commit order, so a bucket's open and close are its lowest and highest id.
_CANDLES = """
WITH buckets AS (
    SELECT
        (ts / ?1) * ?1 AS bucket,
        MIN(id) AS first_id,
        MAX(id) AS last_id,
        MAX(price) AS high,
        MIN(price) AS low,
        SUM(size) AS volume
    FROM fills
    WHERE market = ?2
      AND (?3 IS NULL OR ts >= ?3)
      AND (?4 IS NULL OR ts < ?4)
    GROUP BY bucket
)
SELECT b.bucket AS ts, f.price AS open, b.high, b.low, l.price AS close, b.volume
FROM buckets b
JOIN fills f ON f.id = b.first_id
JOIN fills l ON l.id = b.last_id
ORDER BY ts
"""


class SqliteStore:
    def __init__(
        self, path: str | Path, markets: list[Market], validators: Iterable[str] = ()
    ) -> None:
        self.path = str(Path(path).resolve())
        self.markets = list(markets)
        self.validators = set(validators)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        # No migrations: an older file's blocks may not replay under today's rules.
        for table, column in _NEWEST_COLUMN.items():
            columns = [row[1] for row in self._db.execute(f"PRAGMA table_info({table})")]
            if columns and column not in columns:
                self._db.close()
                raise RuntimeError(f"{self.path} is from an older version of tiny. Delete it.")
        self._ensure()

    def _ensure(self) -> None:
        for statement in _STATEMENTS:
            self._db.execute(statement)

    def close(self) -> None:
        self._db.close()

    def append_block(
        self,
        block: Block,
        events: Sequence[Fill | OrderEvent | FundingEvent],
        qc: QC | None = None,
    ) -> None:
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                self._db.execute(
                    "INSERT INTO blocks (height, body) VALUES (?, ?)",
                    (block.height, block.to_bytes()),
                )
                if qc is not None:
                    self._db.execute(
                        """
                        INSERT INTO tip (id, qc) VALUES (1, ?)
                        ON CONFLICT(id) DO UPDATE SET qc = excluded.qc
                        """,
                        (encode(qc),),
                    )
                self._write_events(events)
                self._db.execute("COMMIT")
            except Exception:
                self._db.execute("ROLLBACK")
                raise

    def committed_blocks(self) -> tuple[Block, ...]:
        with self._lock:
            rows = self._db.execute("SELECT body FROM blocks ORDER BY height")
            return tuple(decode_block(bytes(row[0])) for row in rows)

    def tip_qc(self) -> QC | None:
        with self._lock:
            row = self._db.execute("SELECT qc FROM tip WHERE id = 1").fetchone()
        if row is None:
            return None
        return decode_qc(bytes(row[0]))

    def recent_trades(self, market: str, limit: int, before: Cursor | None = None) -> list[Row]:
        return self._fills("market = ?", (market,), limit, before)

    def trades_for(self, trader: str, limit: int, before: Cursor | None = None) -> list[Row]:
        return self._fills("(taker = ? OR maker = ?)", (trader, trader), limit, before)

    def open_orders(self, trader: str) -> list[Row]:
        sql = """
            SELECT * FROM orders
            WHERE trader = ? AND status IN ('placed', 'partial') AND remaining > 0
            ORDER BY updated_height DESC, order_id DESC
        """
        return self._rows(sql, (trader,))

    def order_history(
        self, trader: str, limit: int, before: OrderCursor | None = None
    ) -> list[Row]:
        height, order_id = (None, None) if before is None else before
        sql = """
            SELECT * FROM orders
            WHERE trader = ?1
              AND (?2 IS NULL OR (updated_height, order_id) < (?3, ?4))
            ORDER BY updated_height DESC, order_id DESC
            LIMIT ?5
        """
        return self._rows(sql, (trader, height, height, order_id, limit))

    def candles(self, market: str, interval: str, start: int | None, end: int | None) -> list[Row]:
        width = INTERVALS.get(interval)
        if width is None:
            raise ValueError(f"unknown interval {interval!r}")
        return self._rows(_CANDLES, (width, market, start, end))

    def funding_history(self, market: str, limit: int) -> list[Row]:
        sql = """
            SELECT height, market, "index", rate, ts FROM funding
            WHERE market = ?
            ORDER BY height DESC
            LIMIT ?
        """
        return self._rows(sql, (market, limit))

    def funding_since(self, market: str, ts: int) -> Row | None:
        sql = """
            SELECT height, market, "index", rate, ts FROM funding
            WHERE market = ? AND ts >= ?
            ORDER BY ts
            LIMIT 1
        """
        rows = self._rows(sql, (market, ts))
        return rows[0] if rows else None

    def rebuild_indexes(self, genesis: State | None = None) -> None:
        """Replay the log. Pass `genesis` when balances were credited before block 1."""
        with self._lock:
            bodies = [
                bytes(row[0]) for row in self._db.execute("SELECT body FROM blocks ORDER BY height")
            ]
            blocks = [decode_block(body) for body in bodies]
            state = _start(self.markets, self.validators, genesis)
            self._db.execute("BEGIN IMMEDIATE")
            try:
                self._db.execute("DROP TABLE IF EXISTS fills")
                self._db.execute("DROP TABLE IF EXISTS orders")
                self._db.execute("DROP TABLE IF EXISTS funding")
                self._ensure()
                for block in blocks:
                    state.apply_block(block)
                    self._write_events(state.events)
                self._db.execute("COMMIT")
            except Exception:
                self._db.execute("ROLLBACK")
                raise

    def _write_events(self, events: Sequence[Fill | OrderEvent | FundingEvent]) -> None:
        for event in events:
            if isinstance(event, Fill):
                self._db.execute(
                    """
                    INSERT INTO fills (
                        height, tx_index, market, price, size, taker, maker, side, liquidation, ts
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        event.height,
                        event.tx_index,
                        event.market,
                        event.price,
                        event.size,
                        event.taker,
                        event.maker,
                        event.taker_side.value,
                        int(event.liquidation),
                        event.ts,
                    ),
                )
            elif isinstance(event, OrderEvent):
                self._db.execute(
                    """
                    INSERT INTO orders (
                        order_id, trader, market, side, type, price, size, remaining, status,
                        reason, created_height, updated_height
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(trader, order_id) DO UPDATE SET
                        remaining = excluded.remaining,
                        status = excluded.status,
                        reason = excluded.reason,
                        updated_height = excluded.updated_height
                    """,
                    (
                        event.order_id,
                        event.trader,
                        event.market,
                        event.side.value,
                        event.type.value,
                        event.price,
                        event.size,
                        event.remaining_size,
                        event.kind,
                        event.reason,
                        event.height,
                        event.height,
                    ),
                )
            elif isinstance(event, FundingEvent):
                self._db.execute(
                    'INSERT INTO funding (height, market, "index", rate, ts) VALUES (?, ?, ?, ?, ?)',
                    (event.height, event.market, event.index, event.rate, event.ts),
                )
            else:
                raise TypeError(f"unknown event {type(event).__name__}")

    def _fills(
        self, where: str, args: tuple[object, ...], limit: int, before: Cursor | None
    ) -> list[Row]:
        height, tx_index, row_id = (None, None, None) if before is None else before
        sql = f"""
            SELECT id, height, tx_index, market, price, size, taker, maker, side, liquidation, ts
            FROM fills
            WHERE {where}
              AND (? IS NULL OR (height, tx_index, id) < (?, ?, ?))
            ORDER BY height DESC, tx_index DESC, id DESC
            LIMIT ?
        """
        params = (*args, height, height, tx_index, row_id, limit)
        rows = self._rows(sql, params)
        for row in rows:
            row["liquidation"] = bool(row["liquidation"])
        return rows

    def _rows(self, sql: str, params: tuple[object, ...]) -> list[Row]:
        conn = sqlite3.connect(
            "file:" + pathname2url(self.path) + "?mode=ro",
            uri=True,
            check_same_thread=False,
        )
        try:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA query_only=ON")
            return [dict(row) for row in conn.execute(sql, params)]
        finally:
            conn.close()
