"""
    Chained HotStuff validators.

    Consensus orders transactions. It never looks inside them.
    Committed blocks are handed to the state machine
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import replace

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from core.types import (
    QC,
    TC,
    Block,
    Hash,
    NewView,
    NodeId,
    Proposal,
    Timeout,
    Tx,
    View,
    Vote,
    encode,
)

log = logging.getLogger(__name__)

GENESIS = bytes(32)
ROUND_MS = 50
TIMEOUT_MS = 300
RELAYS = 4


def num_faulty(n: int) -> int:
    return (n - 1) // 3


def quorum_size(n: int) -> int:
    f = num_faulty(n)
    return -(-(n + f + 1) // 2)  # ceil((n + f + 1) / 2)


def leader(view: View, n: int) -> NodeId:
    return view % n


def vote_payload(view: View, block_hash: Hash, voter: NodeId) -> bytes:
    return encode(("vote", view, block_hash, voter))


def timeout_payload(view: View, sender: NodeId) -> bytes:
    return encode(("timeout", view, sender))


class Consensus:
    """One validator's HotStuff consensus engine (called a replica in the HotStuff paper)."""

    def __init__(
        self,
        node_id: NodeId,
        n: int,
        send: Callable[[NodeId, object], None],
        broadcast: Callable[[object], None],
        on_commit: Callable[[Block], None],
        mempool: Callable[[], list[Tx]],
        private_key: bytes,
        pubkeys: dict[NodeId, bytes],
        state_root_of: Callable[[Block], Hash | None],
    ) -> None:
        self.id = node_id
        self.n = n
        self.send = send
        self.broadcast = broadcast
        self.on_commit = on_commit
        self.mempool = mempool
        self.state_root_of = state_root_of
        self.private_key = private_key
        self.pubkeys = pubkeys
        self.quorum = quorum_size(n)

        self.view: View = 1
        self.last_voted_view: View = 0
        self.blocks: dict[Hash, Block] = {}
        self.high_qc: QC | None = None  # set to genesis QC on start
        self.b_lock: Block | None = None
        self.b_exec: Block | None = None
        self.votes: dict[Hash, dict[NodeId, bytes]] = {}
        self.timeouts: dict[View, dict[NodeId, Timeout]] = {}
        self.pending: list[Proposal] = []
        self.certified: set[Hash] = set()
        self.last_vote: Vote | None = None
        self.carry_tc: TC | None = None
        self.proposed_for = -1
        self.head: Block | None = None
        self.schedule: Callable[[int, Callable[[], None]], int] | None = None
        self.cancel: Callable[[int], None] | None = None
        self.now_ms: Callable[[], int] = lambda: 0
        self._timer: int | None = None
        self._propose_token: int | None = None
        self._draining = False

    def start(self) -> None:
        if self.high_qc is None:
            self.high_qc = QC(0, GENESIS, {})
        self._arm_timer()
        self._maybe_propose()

    def stop(self) -> None:
        self._cancel(self._timer)
        self._cancel(self._propose_token)
        self._timer = None
        self._propose_token = None

    # --- message handlers -------------------------------------------------

    def on_proposal(self, p: Proposal) -> None:
        self._ingest(p)
        self._drain()

    def on_vote(self, v: Vote) -> None:
        if v.voter not in self.pubkeys or v.view < 1:
            return
        if not self._ok(v.voter, vote_payload(v.view, v.block_hash, v.voter), v.sig):
            return
        bucket = self.votes.setdefault(v.block_hash, {})
        if v.voter in bucket:
            return
        bucket[v.voter] = v.sig
        if len(bucket) != self.quorum:
            return
        qc = QC(v.view, v.block_hash, dict(bucket))
        self.advance_view(qc=qc)
        certified = self.blocks.get(v.block_hash)
        if certified is not None:
            self.try_commit(certified)

    def on_timeout(self, t: Timeout) -> None:
        if t.sender not in self.pubkeys or t.view < 1:
            return
        if not self._ok(t.sender, timeout_payload(t.view, t.sender), t.sig):
            return
        if not self.verify_qc(t.high_qc):
            return
        if t.view < self.view:
            self._rebroadcast()
            return
        bucket = self.timeouts.setdefault(t.view, {})
        if t.sender in bucket:
            return
        bucket[t.sender] = t
        self.update_high_qc(t.high_qc)
        if len(bucket) < self.quorum or t.view != self.view:
            return
        best = self._best_qc(bucket)
        sigs = {
            sender: msg.sig
            for sender, msg in bucket.items()
            if self._ok(sender, timeout_payload(t.view, sender), msg.sig)
        }
        if len(sigs) < self.quorum or best is None:
            return
        self.advance_view(tc=TC(t.view, best, sigs))

    def on_new_view(self, nv: NewView) -> None:
        self.update_high_qc(nv.high_qc)
        if nv.view == self.view:
            self._maybe_propose()

    def on_local_timeout(self) -> None:
        view = self.view
        self._rebroadcast()
        if self.high_qc is None:
            return
        payload = timeout_payload(view, self.id)
        self.broadcast(Timeout(view, self.high_qc, self.id, self.sign(payload)))
        if self.view == view:
            self._arm_timer()

    # --- rules ------------------------------------------------------------

    def safe_to_vote(self, b: Block) -> bool:
        """Vote if the block extends our lock, or its QC is newer than that lock."""
        if self.b_lock is None:
            return True
        if b.qc.view > self.b_lock.view:
            return True
        return self._extends(b, self.b_lock)

    def _commit_certified(self, block: Block) -> None:
        """Commit from QCs only. A proposal that never collects a quorum must not move the chain."""
        if block.hash in self.certified:
            self.try_commit(block)
        parent = self.blocks.get(block.parent)
        if parent is not None:
            self.try_commit(parent)

    def try_commit(self, b: Block) -> None:
        """Commit the tail of a three-chain of consecutive views, and its uncommitted prefix."""
        parent = self.blocks.get(b.parent)
        if parent is None or b.view != parent.view + 1:
            return
        grand = self.blocks.get(parent.parent)
        if grand is None or parent.view != grand.view + 1:
            return
        self._commit_through(grand)

    def update_high_qc(self, qc: QC) -> None:
        if not self.verify_qc(qc):
            return
        if qc.view > 0:
            self.certified.add(qc.block_hash)
        current = self.high_qc
        if current is not None and (qc.view, qc.block_hash) <= (current.view, current.block_hash):
            return
        self.high_qc = qc

    def advance_view(self, qc: QC | None = None, tc: TC | None = None) -> None:
        """Jump to the view after a newer QC or TC. The new leader proposes."""
        target = self.view
        if qc is not None and self.verify_qc(qc):
            self.update_high_qc(qc)
            target = max(target, qc.view + 1)
        if tc is not None and self.verify_tc(tc):
            self.update_high_qc(tc.high_qc)
            target = max(target, tc.view + 1)
            self.carry_tc = tc
        if target > self.view:
            self._enter_view(target)

    def propose(self) -> None:
        self._maybe_propose()

    def sign(self, payload: bytes) -> bytes:
        return Ed25519PrivateKey.from_private_bytes(self.private_key).sign(payload)

    def verify_qc(self, qc: QC) -> bool:
        if qc.view == 0 and qc.block_hash == GENESIS and not qc.sigs:
            return True
        if len(qc.sigs) < self.quorum:
            return False
        return all(
            self._ok(voter, vote_payload(qc.view, qc.block_hash, voter), sig)
            for voter, sig in qc.sigs.items()
        )

    def verify_tc(self, tc: TC) -> bool:
        if len(tc.sigs) < self.quorum or not self.verify_qc(tc.high_qc):
            return False
        return all(
            self._ok(sender, timeout_payload(tc.view, sender), sig)
            for sender, sig in tc.sigs.items()
        )

    def _enter_view(self, view: View) -> None:
        self.view = view
        self.proposed_for = -1
        log.info("node %d: enter view %d", self.id, view)
        self._arm_timer()
        if self.id != leader(view, self.n) and self.high_qc is not None:
            self.send(leader(view, self.n), NewView(view, self.high_qc, self.id))
        self._maybe_propose()

    def _maybe_propose(self) -> None:
        if self.id != leader(self.view, self.n) or self.proposed_for == self.view:
            return
        if self.high_qc is None:
            return
        if self.high_qc.view != 0 and self.high_qc.block_hash not in self.blocks:
            return
        self.proposed_for = self.view
        if self.schedule is None:
            self._propose_now()
            return
        view = self.view

        def fire(view: View = view) -> None:
            if self.view == view:
                self._propose_now()

        self._cancel(self._propose_token)
        self._propose_token = self.schedule(ROUND_MS, fire)

    def _propose_now(self) -> None:
        if self.high_qc is None or self.id != leader(self.view, self.n):
            return
        parent = self.blocks.get(self.high_qc.block_hash)
        if self.high_qc.view != 0 and parent is None:
            self.proposed_for = -1
            return
        height = 1 if parent is None else parent.height + 1
        draft = Block(
            self.high_qc.block_hash,
            self.id,
            self.view,
            self.high_qc,
            tuple(self.mempool()),
            self.now_ms(),
            height,
            bytes(32),
        )
        root = self.state_root_of(draft)
        if root is None:
            self.proposed_for = -1
            return
        block = replace(draft, state_root=root)
        tc = self.carry_tc if self.carry_tc and self.carry_tc.view + 1 == self.view else None
        self.carry_tc = None
        log.info("node %d: propose view %d height %d", self.id, block.view, block.height)
        self.broadcast(Proposal(block, tc))

    def _ingest(self, p: Proposal) -> None:
        block = p.block
        if block.hash in self.blocks:
            self._commit_certified(block)
            self._consider_vote(block)
            return
        if block.parent != GENESIS and block.parent not in self.blocks:
            self._hold(p)
            return
        if not self._well_formed(block):
            return
        self.blocks[block.hash] = block
        if self.head is None or block.view >= self.head.view:
            self.head = block
        self.update_high_qc(block.qc)
        if block.view > self.view and self._justifies_jump(p):
            if p.tc is not None and self.verify_tc(p.tc):
                self.carry_tc = p.tc
            self._enter_view(block.view)
        elif self.high_qc is not None and self.high_qc.view + 1 > self.view:
            self._enter_view(self.high_qc.view + 1)
        self._commit_certified(block)
        self._consider_vote(block)
        self._maybe_propose()
        self._relay(p)

    def _drain(self) -> None:
        if self._draining:
            return
        self._draining = True
        try:
            while True:
                ready = [
                    p
                    for p in self.pending
                    if p.block.parent == GENESIS or p.block.parent in self.blocks
                ]
                if not ready:
                    return
                ready_ids = {p.block.hash for p in ready}
                self.pending = [p for p in self.pending if p.block.hash not in ready_ids]
                for proposal in ready:
                    self._ingest(proposal)
        finally:
            self._draining = False

    def _hold(self, p: Proposal) -> None:
        if p.block.hash in self.blocks or any(q.block.hash == p.block.hash for q in self.pending):
            return
        self.pending.append(p)

    def _well_formed(self, block: Block) -> bool:
        if block.proposer != leader(block.view, self.n) or block.view < 1:
            return False
        if block.qc.block_hash != block.parent or not self.verify_qc(block.qc):
            return False
        if block.view <= block.qc.view:
            return False
        parent = self.blocks.get(block.parent)
        if block.parent == GENESIS:
            return block.qc.view == 0 and block.height == 1 and self._rooted(block)
        if parent is None:
            return False
        linked = parent.view == block.qc.view and block.height == parent.height + 1
        return linked and self._rooted(block)

    def _rooted(self, block: Block) -> bool:
        if self.state_root_of(block) == block.state_root:
            return True
        log.info(
            "node %d: reject view %d height %d state_root",
            self.id,
            block.view,
            block.height,
        )
        return False

    def _justifies_jump(self, p: Proposal) -> bool:
        block = p.block
        if p.tc is not None and self.verify_tc(p.tc) and p.tc.view + 1 == block.view:
            return True
        return block.view == self.view + 1 and block.qc.view + 1 == block.view

    def _consider_vote(self, block: Block) -> None:
        if block.view != self.view:
            return
        if self.last_vote is not None and self.last_vote.block_hash == block.hash:
            self.broadcast(self.last_vote)
            return
        if block.view <= self.last_voted_view or not self.safe_to_vote(block):
            return
        parent = self.blocks.get(block.parent)
        if parent is not None and (self.b_lock is None or parent.view > self.b_lock.view):
            self.b_lock = parent
        payload = vote_payload(block.view, block.hash, self.id)
        vote = Vote(block.view, block.hash, self.id, self.sign(payload))
        self.last_voted_view = block.view
        self.last_vote = vote
        self.broadcast(vote)

    def _extends(self, block: Block, ancestor: Block) -> bool:
        current: Block | None = block
        for _ in range(self.n * 4 + len(self.blocks) + 2):
            if current is None:
                return False
            if current.hash == ancestor.hash:
                return True
            current = self.blocks.get(current.parent)
        return False

    def _commit_through(self, block: Block) -> None:
        chain: list[Block] = []
        current: Block | None = block
        while current is not None:
            if self.b_exec is not None and current.hash == self.b_exec.hash:
                break
            chain.append(current)
            if current.parent == GENESIS:
                if self.b_exec is not None:
                    return
                break
            parent = self.blocks.get(current.parent)
            if parent is None:
                return
            current = parent
        for committed in reversed(chain):
            if self.b_exec is not None and committed.hash == self.b_exec.hash:
                continue
            if not self._rooted(committed):
                return
            log.info(
                "node %d: commit height %d view %d %s",
                self.id,
                committed.height,
                committed.view,
                committed.hash[:4].hex(),
            )
            self.on_commit(committed)
            self.b_exec = committed

    def _best_qc(self, bucket: dict[NodeId, Timeout]) -> QC | None:
        best: QC | None = None
        for timeout in bucket.values():
            qc = timeout.high_qc
            if not self.verify_qc(qc):
                continue
            if best is None or (qc.view, qc.block_hash) > (best.view, best.block_hash):
                best = qc
        return best

    def _rebroadcast(self) -> None:
        blocks = sorted(self.blocks.values(), key=lambda item: (item.view, item.height))
        for block in blocks:
            self.broadcast(Proposal(block))

    def _relay(self, proposal: Proposal) -> None:
        for _ in range(RELAYS):
            self.broadcast(proposal)

    def _arm_timer(self) -> None:
        self._cancel(self._timer)
        self._timer = None
        if self.schedule is None:
            return
        view = self.view

        def fire(view: View = view) -> None:
            if self.view == view:
                self.on_local_timeout()

        self._timer = self.schedule(TIMEOUT_MS, fire)

    def _cancel(self, token: int | None) -> None:
        if token is not None and self.cancel is not None:
            self.cancel(token)

    def _ok(self, node_id: NodeId, payload: bytes, sig: bytes) -> bool:
        pub = self.pubkeys.get(node_id)
        if pub is None:
            return False
        try:
            Ed25519PublicKey.from_public_bytes(pub).verify(sig, payload)
        except (InvalidSignature, ValueError):
            return False
        return True
