"""The deterministic state machine, applied block by block to committed blocks.

Owns accounts, positions, order books, oracle prices, funding, liquidations and bridge credits.
Oracle prices arrive as SetOraclePrice txs from validators; the median per market becomes the
oracle price for that block.
Rules: integers only, no wall clock (use block timestamps), no randomness, no I/O.

Budget: < 1,000 lines.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import assert_never

from core.book import OrderBook
from core.bridge import Bridge
from core.types import (
    PRICE_SCALE,
    SIZE_SCALE,
    Account,
    Block,
    BridgeMessage,
    CancelOrder,
    Deposit,
    Fill,
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
)

MAKER_FEE_BPS = 2
TAKER_FEE_BPS = 5
HOUR_MS = 3_600_000


def median(values: list[int]) -> int:
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) // 2


def median_price(submissions: list[OraclePrice]) -> int:
    return median([item.price for item in submissions])


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
        self.bridge = Bridge()
        self.withdrawal_nonce = 0

    def nonce(self, trader: str) -> int:
        """Last committed nonce; 0 for an account that has never sent a tx."""
        account = self.accounts.get(trader)
        return account.nonce if account else 0

    def apply_block(self, block: Block) -> None:
        """Apply every tx, then end-of-block work: oracle median, marks, funding, liquidations."""
        assert block.height == self.height + 1, "block height must be the next height"
        for tx in block.txs:
            self.apply_tx(tx, block.timestamp_ms)
        self.update_oracle_prices()
        self.oracle_submissions.clear()
        self.oracle_voters.clear()
        self.update_mark_prices()
        self.apply_funding(block.timestamp_ms)
        self.liquidate()
        self.height = block.height

    def apply_tx(self, tx: Tx, timestamp_ms: int) -> None:
        """Nonce must be exactly one ahead. A body that does nothing still consumes it.

        `timestamp_ms` is the block time. Funding uses it once, at the end of the block.
        """
        if tx.nonce != self.nonce(tx.signer) + 1:
            return
        self._account(tx.signer).nonce = tx.nonce
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
        self._account(message.recipient).collateral += message.amount

    def _withdraw(self, signer: str, body: Withdraw) -> None:
        if body.trader != signer or body.amount <= 0:
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
        return

    def state_root(self) -> bytes:
        """Hash of canonical state, so validators can compare results."""
        raise NotImplementedError
