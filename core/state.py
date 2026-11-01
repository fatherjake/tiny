"""The deterministic state machine, applied block by block to committed blocks.

Owns accounts, positions, order books, oracle prices, funding, liquidations and bridge credits.
Oracle prices arrive as SetOraclePrice txs from validators; the median per market becomes the
oracle price for that block.
Rules: integers only, no wall clock (use block timestamps), no randomness, no I/O.

Budget: < 1,000 lines.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import assert_never

from core.book import OrderBook
from core.bridge import Bridge, releasable
from core.types import (
    PRICE_SCALE,
    SIZE_SCALE,
    Account,
    Block,
    BlockHeader,
    BridgeMessage,
    CancelOrder,
    Deposit,
    Fill,
    Hash,
    Market,
    MessageProof,
    OraclePrice,
    Order,
    OrderType,
    PlaceOrder,
    Position,
    PostHeader,
    SetOraclePrice,
    Side,
    Tx,
    Withdraw,
    encode,
    sha256,
)

MAKER_FEE_BPS = 2
TAKER_FEE_BPS = 5
HOUR_MS = 3_600_000
LIQUIDATION_SLIPPAGE_BPS = 500


def median(values: list[int]) -> int:
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) // 2


def median_price(submissions: list[OraclePrice]) -> int:
    return median([item.price for item in submissions])


def _tx_class(tx: Tx) -> int:
    """Lower runs first. Post-only places join class 0."""
    match tx.body:
        case CancelOrder():
            return 0
        case _:
            return 1


class State:
    def __init__(self, markets: list[Market], validators: Iterable[str] = ()) -> None:
        self.height = 0
        self.markets = {m.name: m for m in markets}
        self.books = {m.name: OrderBook(m.name) for m in markets}
        self.accounts: dict[str, Account] = {}
        self.validators = set(validators)
        self.oracle_prices: dict[str, int] = {}
        self.oracle_submissions: dict[str, list[OraclePrice]] = {}  # this block's, cleared after
        self.oracle_voters: set[str] = set()
        self.mark_prices: dict[str, int] = {}
        self.funding_index: dict[str, int] = {m.name: 0 for m in markets}
        self.last_funding_ms: int | None = None
        self.next_order_id = 1
        self.bridge = Bridge()
        self.withdrawal_nonce = 0
        self.block_fills: list[Fill] = []

    def nonce(self, trader: str) -> int:
        """Last committed nonce; 0 for an account that has never sent a tx."""
        account = self.accounts.get(trader)
        return account.nonce if account else 0

    def apply_block(self, block: Block) -> None:
        """Apply every tx, then end-of-block work: oracle median, marks, funding, liquidations.

        Cancels (class 0) run before every other tx (class 1). Within a class the
        block order is kept, so a maker cancel in this block beats a taker.
        """
        assert block.height == self.height + 1, "block height must be the next height"
        self.block_fills = []
        self._apply_txs(block.txs)
        self.update_oracle_prices()
        self.oracle_submissions.clear()
        self.oracle_voters.clear()
        self.update_mark_prices()
        self.apply_funding(block.timestamp_ms)
        self.liquidate()
        self.height = block.height

    def _apply_txs(self, txs: tuple[Tx, ...]) -> None:
        # Nonce must be exactly the previous one plus one, judged in block order.
        # The class sort runs a later-nonce cancel before that signer's earlier tx.
        # Checking the nonce at execution time would drop the cancel and keep the
        # earlier tx, so commit the nonce sequence first and only then run bodies.
        accepted: list[tuple[int, Tx]] = []
        for index, tx in enumerate(txs):
            if tx.nonce != self.nonce(tx.signer) + 1:
                continue
            self._account(tx.signer).nonce = tx.nonce
            accepted.append((index, tx))
        for _, tx in sorted(accepted, key=lambda item: (_tx_class(item[1]), item[0])):
            self._apply_body(tx)

    def apply_tx(self, tx: Tx, timestamp_ms: int) -> None:
        """Nonce must be exactly one ahead. A body that does nothing still consumes it.

        `timestamp_ms` is the block time. Funding uses it once, at the end of the block.
        """
        if tx.nonce != self.nonce(tx.signer) + 1:
            return
        self._account(tx.signer).nonce = tx.nonce
        self._apply_body(tx)

    def _apply_body(self, tx: Tx) -> None:
        match tx.body:
            case PlaceOrder(order=order):
                self._place(tx.signer, order)
            case CancelOrder() as body:
                self._cancel(tx.signer, body)
            case SetOraclePrice(price=price):
                self._submit_oracle(tx.signer, price)
            case PostHeader(header=header, oracle_sig=sig):
                self.bridge.post_header(header, sig)
            case Deposit(proof=proof):
                self._deposit(proof)
            case Withdraw() as body:
                self._withdraw(tx.signer, body)
            case _:
                assert_never(tx.body)

    def _account(self, trader: str) -> Account:
        account = self.accounts.get(trader)
        if account is None:
            account = Account(trader)
            self.accounts[trader] = account
        return account

    def _place(self, signer: str, order: Order) -> None:
        market = self.markets.get(order.market)
        if order.trader != signer or market is None or order.size <= 0:
            return
        off_tick = order.type == OrderType.LIMIT and (
            order.price <= 0 or order.price % market.tick_size != 0
        )
        if off_tick or order.size % market.lot_size != 0:
            return
        book = self.books[order.market]
        if order.id in book.orders:
            return
        fills = book.place(order, position_of=lambda trader: self._open_size(trader, order.market))
        for fill in fills:
            self.settle_fill(fill)

    def _open_size(self, trader: str, market: str) -> int:
        account = self.accounts.get(trader)
        if account is None:
            return 0
        position = account.positions.get(market)
        return position.size if position else 0

    def _cancel(self, signer: str, body: CancelOrder) -> None:
        if body.trader != signer:
            return
        book = self.books.get(body.market)
        if book is None:
            return
        order = book.orders.get(body.order_id)
        if order is None or order.trader != signer:
            return
        book.cancel(body.order_id)

    def _submit_oracle(self, signer: str, price: OraclePrice) -> None:
        if signer not in self.validators or signer in self.oracle_voters:
            return
        self.oracle_voters.add(signer)
        if price.market not in self.markets or price.price <= 0:
            return
        self.oracle_submissions.setdefault(price.market, []).append(price)

    def _deposit(self, proof: MessageProof) -> None:
        message = self.bridge.deliver(proof)
        if message is None:
            return
        self._account(message.recipient).collateral += message.amount

    def _withdraw(self, signer: str, body: Withdraw) -> None:
        if body.trader != signer or not releasable(body.dest_chain, body.dest_address, body.amount):
            return
        account = self.accounts[signer]
        if body.amount > self._free_collateral(signer):
            return
        account.collateral -= body.amount
        self.withdrawal_nonce += 1
        # BridgeMessage is the outbox record too; dest_chain rides in src_chain.
        self.bridge.queue_withdrawal(
            BridgeMessage(
                src_chain=body.dest_chain,
                src_height=self.height + 1,
                nonce=self.withdrawal_nonce,
                sender=signer,
                recipient=body.dest_address,
                amount=body.amount,
            )
        )

    def settle_fill(self, fill: Fill) -> None:
        self.block_fills.append(fill)
        maker_side = Side.SELL if fill.taker_side == Side.BUY else Side.BUY
        self._apply_fill(fill.maker, fill.market, maker_side, fill.price, fill.size, MAKER_FEE_BPS)
        self._apply_fill(
            fill.taker, fill.market, fill.taker_side, fill.price, fill.size, TAKER_FEE_BPS
        )

    def _apply_fill(
        self, trader: str, market: str, side: Side, price: int, size: int, fee_bps: int
    ) -> None:
        account = self._account(trader)
        pos = account.positions.get(market)
        if pos is None:
            pos = Position(market, funding_index=self.funding_index[market])
            account.positions[market] = pos
        self._collect_funding(account, market)
        notional = price * size // PRICE_SCALE
        account.collateral -= notional * fee_bps // 10_000
        signed = size if side == Side.BUY else -size
        old = pos.size
        new = old + signed
        if old == 0 or (old > 0) == (signed > 0):
            pos.size = new
            pos.entry_notional += notional
            return
        closing = new == 0 or (new > 0) == (old > 0)
        closed = size if closing else abs(old)
        opened = 0 if closing else abs(new)
        closed_entry = (
            pos.entry_notional if closed == abs(old) else pos.entry_notional * closed // abs(old)
        )
        closed_notional = price * closed // PRICE_SCALE
        if old > 0:
            account.collateral += closed_notional - closed_entry
        else:
            account.collateral += closed_entry - closed_notional
        if new == 0:
            del account.positions[market]
            return
        pos.size = new
        pos.entry_notional = (
            price * opened // PRICE_SCALE if opened else pos.entry_notional - closed_entry
        )

    def update_oracle_prices(self) -> None:
        """Median of this block's submissions per market. No vote keeps the previous price."""
        for market in sorted(self.oracle_submissions):
            if self.oracle_submissions[market]:
                self.oracle_prices[market] = median_price(self.oracle_submissions[market])

    def update_mark_prices(self) -> None:
        """Median of bid, ask and oracle. A one-sided book leaves the mark at the oracle."""
        for market in sorted(self.markets):
            book = self.books[market]
            oracle = self.oracle_prices.get(market)
            bid, ask, mid = book.best_bid(), book.best_ask(), book.mid()
            if bid is not None and ask is not None and oracle is not None:
                self.mark_prices[market] = median([bid, ask, oracle])
            elif oracle is not None:
                self.mark_prices[market] = oracle
            elif mid is not None:
                self.mark_prices[market] = mid

    def apply_funding(self, timestamp_ms: int) -> None:
        """Longs pay the mark-oracle premium for the time since the previous block.

        Over one hour the payment on one unit is exactly `mark - oracle`. The first block
        only starts the clock, and a timestamp that does not move forward is ignored.
        """
        if self.last_funding_ms is None:
            self.last_funding_ms = timestamp_ms
            return
        elapsed = timestamp_ms - self.last_funding_ms
        if elapsed <= 0:
            return
        self.last_funding_ms = timestamp_ms
        for market in sorted(self.markets):
            oracle = self.oracle_prices.get(market)
            mark = self.mark_prices.get(market)
            if oracle is None or mark is None:
                continue
            self.funding_index[market] += (mark - oracle) * elapsed // HOUR_MS
        for trader in sorted(self.accounts):
            account = self.accounts[trader]
            for market in sorted(account.positions):
                self._collect_funding(account, market)

    def _collect_funding(self, account: Account, market: str) -> None:
        pos = account.positions.get(market)
        if pos is None:
            return
        delta = self.funding_index[market] - pos.funding_index
        pos.funding_index = self.funding_index[market]
        if delta == 0 or pos.size == 0:
            return
        account.collateral -= pos.size * delta // SIZE_SCALE

    def margin(self, trader: str) -> tuple[int, int]:
        """(account value, maintenance margin required), both at mark prices."""
        account = self.accounts.get(trader)
        if account is None:
            return 0, 0
        value = account.collateral
        required = 0
        for market in sorted(account.positions):
            pos = account.positions[market]
            if pos.size == 0:
                continue
            mark = self.mark_prices.get(market)
            if mark is None:
                continue
            notional = abs(pos.size) * mark // PRICE_SCALE
            if pos.size > 0:
                value += notional - pos.entry_notional
            else:
                value += pos.entry_notional - notional
            required += notional * self.markets[market].maintenance_margin_bps // 10_000
        return value, required

    def _free_collateral(self, trader: str) -> int:
        account = self.accounts[trader]
        value, required = self.margin(trader)
        if value < required:
            return 0
        return min(account.collateral, value - required)

    def liquidate(self) -> None:
        for trader in sorted(self.accounts):
            self._liquidate(trader)

    def _liquidate(self, trader: str) -> None:
        account = self.accounts[trader]
        for market in sorted(account.positions):
            value, required = self.margin(trader)
            if value >= required:
                return
            pos = account.positions.get(market)
            if pos is None or pos.size == 0:
                continue
            mark = self.mark_prices.get(market)
            if mark is None:
                continue
            side = Side.SELL if pos.size > 0 else Side.BUY
            band = (
                10_000 + LIQUIDATION_SLIPPAGE_BPS
                if side == Side.BUY
                else 10_000 - LIQUIDATION_SLIPPAGE_BPS
            )
            price = mark * band // 10_000
            if price <= 0:
                continue
            order = Order(
                id=self._take_order_id(market),
                trader=trader,
                market=market,
                side=side,
                type=OrderType.MARKET,
                price=price,
                size=abs(pos.size),
                reduce_only=True,
            )
            book = self.books[market]
            fills = book.place(order, position_of=lambda who, m=market: self._open_size(who, m))
            for fill in fills:
                self.settle_fill(fill)

    def _take_order_id(self, market: str) -> int:
        book = self.books[market]
        while self.next_order_id in book.orders:
            self.next_order_id += 1
        order_id = self.next_order_id
        self.next_order_id += 1
        return order_id

    def state_root(self) -> Hash:
        """Hash of canonical state, so validators can compare results."""
        return sha256(self.to_bytes())

    def to_bytes(self) -> bytes:
        return encode(self._canonical())

    @classmethod
    def from_bytes(cls, data: bytes) -> State:
        """Rebuild the state `to_bytes` wrote. Market params ride along so the copy can trade."""
        raw = _obj(json.loads(data))
        markets = [_market(item) for item in _seq(raw["markets"])]
        state = cls(markets, (_str(item) for item in _seq(raw["validators"])))
        state.height = _int(raw["height"])
        state.next_order_id = _int(raw["next_order_id"])
        state.withdrawal_nonce = _int(raw["withdrawal_nonce"])
        state.last_funding_ms = _opt_int(raw["last_funding_ms"])
        state.oracle_voters = {_str(item) for item in _seq(raw["oracle_voters"])}
        state.accounts = {trader: _account(body) for trader, body in _obj(raw["accounts"]).items()}
        for name, body in _obj(raw["books"]).items():
            book = _obj(body)
            state.books[name].restore(
                [_order(item) for item in _seq(book["bids"])],
                [_order(item) for item in _seq(book["asks"])],
            )
        state.oracle_prices = {key: _int(val) for key, val in _obj(raw["oracle_prices"]).items()}
        state.oracle_submissions = {
            market: [_oracle(item) for item in _seq(items)]
            for market, items in _obj(raw["oracle_submissions"]).items()
        }
        state.mark_prices = {key: _int(val) for key, val in _obj(raw["mark_prices"]).items()}
        state.funding_index = {key: _int(val) for key, val in _obj(raw["funding_index"]).items()}
        bridge = _obj(raw["bridge"])
        state.bridge.oracle_pubkey = _b(bridge["oracle_pubkey"])
        for item in _seq(bridge["headers"]):
            header = _header(item)
            state.bridge.headers[(header.chain_id, header.height)] = header
        state.bridge.delivered = {_pair(item) for item in _seq(bridge["delivered"])}
        state.bridge.outbox = [_message(item) for item in _seq(bridge["outbox"])]
        return state

    def _canonical(self) -> dict[str, object]:
        return {
            "height": self.height,
            "next_order_id": self.next_order_id,
            "withdrawal_nonce": self.withdrawal_nonce,
            "last_funding_ms": self.last_funding_ms,
            "markets": [self.markets[name] for name in sorted(self.markets)],
            "validators": sorted(self.validators),
            "oracle_voters": sorted(self.oracle_voters),
            "accounts": {trader: self.accounts[trader] for trader in sorted(self.accounts)},
            "books": {name: self.books[name].resting() for name in sorted(self.books)},
            "oracle_prices": dict(sorted(self.oracle_prices.items())),
            "oracle_submissions": {
                market: self.oracle_submissions[market]
                for market in sorted(self.oracle_submissions)
            },
            "mark_prices": dict(sorted(self.mark_prices.items())),
            "funding_index": dict(sorted(self.funding_index.items())),
            "bridge": {
                "oracle_pubkey": self.bridge.oracle_pubkey,
                "headers": [self.bridge.headers[key] for key in sorted(self.bridge.headers)],
                "delivered": sorted(self.bridge.delivered),
                "outbox": list(self.bridge.outbox),
            },
        }


def _obj(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise TypeError("expected object")
    out: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise TypeError("expected string key")
        out[key] = item
    return out


def _seq(value: object) -> list[object]:
    if not isinstance(value, list):
        raise TypeError("expected list")
    return list(value)


def _str(value: object) -> str:
    if not isinstance(value, str):
        raise TypeError("expected string")
    return value


def _int(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError("expected int")
    return value


def _opt_int(value: object) -> int | None:
    if value is None:
        return None
    return _int(value)


def _bool(value: object) -> bool:
    if not isinstance(value, bool):
        raise TypeError("expected bool")
    return value


def _b(value: object) -> bytes:
    if not isinstance(value, str):
        raise TypeError("expected hex")
    return bytes.fromhex(value)


def _pair(value: object) -> tuple[int, int]:
    row = _seq(value)
    if len(row) != 2:
        raise ValueError("expected pair")
    return _int(row[0]), _int(row[1])


def _market(value: object) -> Market:
    raw = _obj(value)
    return Market(
        _str(raw["name"]),
        _int(raw["tick_size"]),
        _int(raw["lot_size"]),
        _int(raw["max_leverage"]),
        _int(raw["maintenance_margin_bps"]),
    )


def _order(value: object) -> Order:
    raw = _obj(value)
    return Order(
        _int(raw["id"]),
        _str(raw["trader"]),
        _str(raw["market"]),
        Side(_str(raw["side"])),
        OrderType(_str(raw["type"])),
        _int(raw["price"]),
        _int(raw["size"]),
        _bool(raw["reduce_only"]),
    )


def _position(value: object) -> Position:
    raw = _obj(value)
    return Position(
        _str(raw["market"]),
        _int(raw["size"]),
        _int(raw["entry_notional"]),
        _int(raw["funding_index"]),
    )


def _account(value: object) -> Account:
    raw = _obj(value)
    positions = {name: _position(pos) for name, pos in _obj(raw["positions"]).items()}
    return Account(_str(raw["trader"]), _int(raw["collateral"]), positions, _int(raw["nonce"]))


def _sigs(value: object) -> dict[int, bytes]:
    return {int(key): _b(item) for key, item in _obj(value).items()}


def _oracle(value: object) -> OraclePrice:
    raw = _obj(value)
    return OraclePrice(
        _str(raw["market"]), _int(raw["price"]), _int(raw["timestamp_ms"]), _sigs(raw["sigs"])
    )


def _header(value: object) -> BlockHeader:
    raw = _obj(value)
    return BlockHeader(
        _int(raw["chain_id"]),
        _int(raw["height"]),
        _b(raw["block_hash"]),
        _b(raw["receipts_root"]),
    )


def _message(value: object) -> BridgeMessage:
    raw = _obj(value)
    return BridgeMessage(
        _int(raw["src_chain"]),
        _int(raw["src_height"]),
        _int(raw["nonce"]),
        _str(raw["sender"]),
        _str(raw["recipient"]),
        _int(raw["amount"]),
    )
