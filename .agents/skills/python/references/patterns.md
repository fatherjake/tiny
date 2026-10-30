# Python patterns

Examples for the rules in `SKILL.md`, drawn from this repo's domain.

## Union of dataclasses plus exhaustive match

```python
from typing import assert_never

TxBody = PlaceOrder | CancelOrder | SetOraclePrice | Deposit | Withdraw

def apply(self, body: TxBody) -> None:
    match body:
        case PlaceOrder(order=o):
            self.place(o)
        case CancelOrder(trader=t, market=m, order_id=i):
            self.books[m].cancel(i)
        case SetOraclePrice(price=p):
            self.oracle_submissions.setdefault(p.market, []).append(p)
        case Deposit(proof=p):
            self.credit(self.bridge.deliver(p))
        case Withdraw():
            self.withdraw(body)
        case _:
            assert_never(body)
```

Don't model this as `Tx(kind: str, data: dict)`. Every handler then has to guess what's in `data`.

## Guard clauses instead of nesting

```python
# Don't: 4 levels deep, 12 lines
def on_vote(self, v: Vote) -> None:
    if v.view == self.view:
        if self.verify(v):
            if v.voter not in self.votes.get(v.block_hash, {}):
                self.votes.setdefault(v.block_hash, {})[v.voter] = v.sig
                if len(self.votes[v.block_hash]) >= self.quorum:
                    self.form_qc(v.block_hash)

# Do: flat, 7 lines, reads top to bottom
def on_vote(self, v: Vote) -> None:
    if v.view != self.view or not self.verify(v):
        return
    sigs = self.votes.setdefault(v.block_hash, {})
    sigs[v.voter] = v.sig
    if len(sigs) == self.quorum:  # == so the QC forms exactly once
        self.form_qc(v.block_hash)
```

## Compact but still readable

```python
# Good: one transform, obvious
live = [n for n in self.nodes if n.id not in self.net.down]

# Too clever: three ideas in one line. Expand it.
roots = {n.state.state_root() for n in (x for x in self.nodes if x.id not in d) if n.committed}

# Better
live = [n for n in self.nodes if n.id not in self.net.down and n.committed]
roots = {n.state.state_root() for n in live}
```

## Standard library over hand-rolled

```python
# Price levels: a sorted list of prices plus a dict of FIFO queues
from bisect import insort
from collections import deque

if price not in self.bids:
    insort(self.bid_prices, price)
    self.bids[price] = deque()
self.bids[price].append(order)
```

## Deterministic iteration

```python
# Don't: set order is unspecified, so validators can disagree
for trader in self.accounts_to_liquidate:
    self.liquidate(trader)

# Do
for trader in sorted(self.accounts_to_liquidate):
    self.liquidate(trader)
```

## Protocol for interfaces

```python
class Transport(Protocol):
    def send(self, to: NodeId, msg: object) -> None: ...
    def broadcast(self, msg: object) -> None: ...
```

`core/` depends on `Transport`; `sim/net.py` and `core/net.py` both satisfy it without inheriting from anything.
