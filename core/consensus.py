"""Chained HotStuff validators.

Consensus only orders transactions. It never looks inside them: committed blocks are handed to
the state machine (state.py), which every validator runs identically.

Pieces:
- Replica: safe-to-vote rule, locking (b_lock), three-chain commit, vote collection into QCs.
- Pacemaker: view timers, Timeout messages, TCs, jumping ahead on any newer QC or TC.
- Leader rotation: round-robin on view.
- Crypto: Ed25519 signatures over Block.to_bytes() / vote payloads.

Budget: < 1,000 lines.
"""

from __future__ import annotations

from collections.abc import Callable

from core.types import QC, TC, Block, Hash, NewView, NodeId, Proposal, Timeout, Tx, View, Vote


def num_faulty(n: int) -> int:
    return (n - 1) // 3


def quorum_size(n: int) -> int:
    f = num_faulty(n)
    return -(-(n + f + 1) // 2)  # ceil((n + f + 1) / 2)


def leader(view: View, n: int) -> NodeId:
    return view % n


class Replica:
    def __init__(
        self,
        node_id: NodeId,
        n: int,
        send: Callable[[NodeId, object], None],
        broadcast: Callable[[object], None],
        on_commit: Callable[[Block], None],
        mempool: Callable[[], list[Tx]],
    ) -> None:
        self.id = node_id
        self.n = n
        self.send = send
        self.broadcast = broadcast
        self.on_commit = on_commit
        self.mempool = mempool

        self.view: View = 1
        self.last_voted_view: View = 0
        self.blocks: dict[Hash, Block] = {}
        self.high_qc: QC | None = None  # set to genesis QC on start
        self.b_lock: Block | None = None
        self.b_exec: Block | None = None
        self.votes: dict[Hash, dict[NodeId, bytes]] = {}
        self.timeouts: dict[View, dict[NodeId, Timeout]] = {}

    # --- message handlers -------------------------------------------------

    def on_proposal(self, p: Proposal) -> None:
        raise NotImplementedError

    def on_vote(self, v: Vote) -> None:
        raise NotImplementedError

    def on_timeout(self, t: Timeout) -> None:
        raise NotImplementedError

    def on_new_view(self, nv: NewView) -> None:
        raise NotImplementedError

    def on_local_timeout(self) -> None:
        raise NotImplementedError

    # --- rules ------------------------------------------------------------

    def safe_to_vote(self, b: Block) -> bool:
        raise NotImplementedError

    def try_commit(self, b: Block) -> None:
        raise NotImplementedError

    def update_high_qc(self, qc: QC) -> None:
        raise NotImplementedError

    def advance_view(self, qc: QC | None = None, tc: TC | None = None) -> None:
        raise NotImplementedError

    def propose(self) -> None:
        raise NotImplementedError

    # --- crypto -------------------------------------------------------------

    def sign(self, payload: bytes) -> bytes:
        raise NotImplementedError

    def verify_qc(self, qc: QC) -> bool:
        raise NotImplementedError
