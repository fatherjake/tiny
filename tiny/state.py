"""The deterministic state machine, applied block by block to committed blocks.

Owns accounts, positions, order books, oracle prices, funding, liquidations and bridge credits.
Rules: integers only, no wall clock (use block timestamps), no randomness, no I/O.

Budget: < 1,000 lines.
"""

from __future__ import annotations

from tiny.book import OrderBook
from tiny.bridge import Bridge
from tiny.types import Account, Block, Fill, Market, Tx


class State:
    def __init__(self, markets: list[Market]) -> None:
        self.height = 0
        self.markets = {m.name: m for m in markets}
        self.books = {m.name: OrderBook(m.name) for m in markets}
        self.accounts: dict[str, Account] = {}
        self.oracle_prices: dict[str, int] = {}
        self.mark_prices: dict[str, int] = {}
        self.funding_index: dict[str, int] = {m.name: 0 for m in markets}
        self.bridge = Bridge()

    def apply_block(self, block: Block) -> None:
        """Apply every tx, then end-of-block work: marks, funding, liquidations."""
        raise NotImplementedError

    def apply_tx(self, tx: Tx, timestamp_ms: int) -> None:
        raise NotImplementedError

    def settle_fill(self, fill: Fill) -> None:
        raise NotImplementedError

    def update_mark_prices(self) -> None:
        raise NotImplementedError

    def apply_funding(self, timestamp_ms: int) -> None:
        raise NotImplementedError

    def margin(self, trader: str) -> tuple[int, int]:
        """(account value, maintenance margin required)."""
        raise NotImplementedError

    def liquidate(self) -> None:
        raise NotImplementedError

    def state_root(self) -> bytes:
        """Hash of canonical state, so validators can compare results."""
        raise NotImplementedError
