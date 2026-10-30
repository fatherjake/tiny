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
    PostHeader,
    SetOraclePrice,
    Tx,
    Withdraw,
)


def median_price(submissions: list[OraclePrice]) -> int:
    raise NotImplementedError


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
        for fill in book.place(order):
            self.settle_fill(fill)

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
        if body.amount > account.collateral:
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
        raise NotImplementedError

    def update_oracle_prices(self) -> None:
        """Median of this block's submissions per market."""
        return

    def update_mark_prices(self) -> None:
        return

    def apply_funding(self, timestamp_ms: int) -> None:
        return

    def margin(self, trader: str) -> tuple[int, int]:
        """(account value, maintenance margin required)."""
        raise NotImplementedError

    def liquidate(self) -> None:
        return

    def state_root(self) -> bytes:
        """Hash of canonical state, so validators can compare results."""
        raise NotImplementedError
