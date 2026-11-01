"""A validator: everything one participant runs, wired together.

    keypair -> signs votes, timeouts, proposals and oracle price txs
    mempool -> pending txs, deduped by (signer, nonce); feeds proposals when this node leads
    Consensus -> HotStuff (consensus.py); on_commit hands blocks to State
    State   -> deterministic state machine (state.py); state_root() compared across nodes in tests
    sync    -> snapshot plus block replay so a new or lagging node can catch up
    price submitter -> each block, sign a SetOraclePrice tx from the price feed
    transport -> net.py, in-memory or TCP

Run one validator per process over TCP:

    uv run python -m core.node --id 0 --config cluster.json --key-file key.hex

`cluster.json` lists every validator's id, host, port and public key, plus markets.
`key.hex` is this process's private key. The public key in the config has to match it.

Budget: < 1,000 lines.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import signal
from collections import deque
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from core.consensus import GENESIS, Consensus
from core.net import TcpTransport, Transport
from core.state import State
from core.types import (
    Block,
    Hash,
    Market,
    NewView,
    NodeId,
    OraclePrice,
    Proposal,
    SetOraclePrice,
    Snapshot,
    SyncBlocks,
    SyncRequest,
    Timeout,
    Tx,
    TxBody,
    Vote,
)

log = logging.getLogger(__name__)

MAX_SYNC_BLOCKS = 100
MAX_SYNC_BYTES = 4 * 1024 * 1024
SNAPSHOT_GAP = 100
SNAPSHOT_EVERY = 100
SYNC_TIMEOUT = 1_000
SYNC_PER_SECOND = 5

TxKey = tuple[str, int]  # (signer, nonce)


# ---------------------------------------------------------------- keys and signatures


def public_key(private_key: bytes) -> bytes:
    key = Ed25519PrivateKey.from_private_bytes(private_key).public_key()
    return key.public_bytes(Encoding.Raw, PublicFormat.Raw)


def sign(private_key: bytes, payload: bytes) -> bytes:
    return Ed25519PrivateKey.from_private_bytes(private_key).sign(payload)


def verify(public: bytes, payload: bytes, sig: bytes) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(public).verify(sig, payload)
    except (InvalidSignature, ValueError):
        return False
    return True


def sign_tx(private_key: bytes, body: TxBody, nonce: int) -> Tx:
    """What a client (bot, UI, test) does before POSTing to /tx."""
    unsigned = Tx(body, public_key(private_key).hex(), nonce, b"")
    return replace(unsigned, sig=sign(private_key, unsigned.signing_bytes()))


def verify_tx(tx: Tx) -> bool:
    try:
        signer = bytes.fromhex(tx.signer)
    except ValueError:
        return False
    return verify(signer, tx.signing_bytes(), tx.sig)


# ---------------------------------------------------------------- mempool


class Mempool:
    """Pending txs keyed by (signer, nonce).

    Node.accept lets a signer queue up to `nonce_window` nonces ahead of their committed nonce, so a
    bot can send a burst without waiting for each commit. A tx stuck behind a nonce that never
    arrives is evicted once it has waited `max_age` commits.

    Deduping here only saves work. What stops a tx applying twice is State's nonce rule, so a
    duplicate that slips into two blocks is rejected when the second one is applied.

    In chained HotStuff the next block is proposed before the last one commits, so txs already in
    an uncommitted proposal are marked proposed and skipped by take(). If that proposal never
    commits (its leader timed out), they become takeable again after `retry_after` commits.
    """

    def __init__(
        self,
        max_block_txs: int = 500,
        max_pending: int = 10_000,
        nonce_window: int = 16,
        max_age: int = 50,
        retry_after: int = 5,
    ) -> None:
        self.max_block_txs = max_block_txs
        self.max_pending = max_pending
        self.nonce_window = nonce_window
        self.max_age = max_age
        self.retry_after = retry_after
        self.pending: dict[TxKey, Tx] = {}
        self.arrived: dict[TxKey, int] = {}  # key -> self.commits when it was added
        self.proposed: dict[TxKey, int] = {}  # key -> self.commits when it was first proposed
        self.commits = 0

    def add(self, tx: Tx) -> bool:
        key = (tx.signer, tx.nonce)
        if key in self.pending or len(self.pending) >= self.max_pending:
            return False
        self.pending[key] = tx
        self.arrived[key] = self.commits
        return True

    def take(self) -> list[Tx]:
        """Txs for a new proposal, sorted by (signer, nonce) so each signer's nonces go in order."""
        ready = sorted(key for key in self.pending if key not in self.proposed)
        txs = [self.pending[key] for key in ready[: self.max_block_txs]]
        self.mark_proposed(txs)
        return txs

    def mark_proposed(self, txs: tuple[Tx, ...] | list[Tx]) -> None:
        for tx in txs:
            self.proposed.setdefault((tx.signer, tx.nonce), self.commits)

    def remove_committed(self, block: Block, nonce_of: Callable[[str], int]) -> None:
        """Drop the block's txs, txs whose nonce is now used or that waited too long, and release
        proposed marks on txs whose proposal looks abandoned."""
        self.commits += 1
        for tx in block.txs:
            self.drop((tx.signer, tx.nonce))
        for key in list(self.pending):
            used = key[1] <= nonce_of(key[0])
            if used or self.commits - self.arrived[key] > self.max_age:
                self.drop(key)
        abandoned = [
            key for key, at in self.proposed.items() if self.commits - at > self.retry_after
        ]
        for key in abandoned:
            del self.proposed[key]

    def drop(self, key: TxKey) -> None:
        self.pending.pop(key, None)
        self.arrived.pop(key, None)
        self.proposed.pop(key, None)


# ---------------------------------------------------------------- node


class Node:
    def __init__(
        self,
        node_id: NodeId,
        n: int,
        private_key: bytes,
        validator_pubkeys: dict[NodeId, bytes],
        markets: list[Market],
        transport: Transport,
        price_feed: Callable[[], dict[str, int]] | None = None,
    ) -> None:
        self.id = node_id
        self.private_key = private_key
        self.validator_pubkeys = validator_pubkeys
        self.transport = transport
        self.price_feed = price_feed
        self.mempool = Mempool()
        own = public_key(private_key).hex()
        validators = {pub.hex() for pub in validator_pubkeys.values()}
        # A follower that is not in the validator set must hash the same set as the chain.
        if not validators or node_id in validator_pubkeys:
            validators.add(own)
        self.state = State(markets, validators)
        self.committed: list[Block] = []
        self.by_height: dict[int, Block] = {}
        self.latest_snapshot: Snapshot | None = None
        self.future: dict[int, Block] = {}
        self._held_snapshot: Snapshot | None = None
        self.catching_up = False
        self._sync_tick = -1
        self._sync_used: dict[NodeId, int] = {}
        self._sync_token: int | None = None
        self._sync_mark = -1
        self._sync_tries = 0
        self._rr = 0
        self._oracle_i = 0
        self.trade_seq = 0
        self.trades: deque[dict[str, object]] = deque(maxlen=20_000)
        pubs = dict(validator_pubkeys)
        pubs[node_id] = public_key(private_key)
        self.consensus = Consensus(
            node_id,
            n,
            send=transport.send,
            broadcast=transport.broadcast,
            on_commit=self.on_commit,
            mempool=self.mempool.take,
            private_key=private_key,
            pubkeys=pubs,
            state_root_of=self.preview_root,
        )
        transport.on_message(self.on_message)

    def start(self) -> None:
        """Start the pacemaker, then queue the first oracle prices so block 1 can carry them."""
        schedule = getattr(self.transport, "call_later", None)
        cancel = getattr(self.transport, "cancel", None)
        now_ms = getattr(self.transport, "now_ms", None)
        if callable(schedule):
            self.consensus.schedule = schedule
        if callable(cancel):
            self.consensus.cancel = cancel
        if callable(now_ms):
            self.consensus.now_ms = now_ms
        self.submit_prices()
        self.consensus.start()
        self._request_sync(None)

    def stop(self) -> None:
        self.consensus.stop()

    def submit(self, tx: Tx) -> bool:
        """Entry point for the API: check it, add it to the mempool, gossip it to the other nodes.

        Returns False for a bad signature, a used or too-far-ahead nonce, a duplicate or a full
        mempool. True only means "pending": the tx takes effect, or is rejected, when its block is
        applied.
        """
        if not self.accept(tx):
            return False
        self.transport.broadcast(tx)
        return True

    def accept(self, tx: Tx) -> bool:
        """Cheap checks only, cheapest first. State has the final say on every tx.

        The nonce must be unused and at most `nonce_window` ahead of the signer's committed nonce.
        """
        committed = self.state.nonce(tx.signer)
        if not committed < tx.nonce <= committed + self.mempool.nonce_window:
            return False
        if not verify_tx(tx):
            return False
        return self.mempool.add(tx)

    def on_message(self, sender: NodeId, msg: object) -> None:
        """Route consensus messages to the consensus engine, and sync messages to the catch-up path."""
        match msg:
            case Tx():
                self.accept(msg)  # gossiped by the node it was submitted to; don't re-broadcast
            case Proposal():
                self._on_proposal(msg)
            case Vote():
                self.consensus.on_vote(msg)
            case Timeout():
                self.consensus.on_timeout(msg)
            case NewView():
                self.consensus.on_new_view(msg)
            case SyncRequest():
                self._serve_sync(sender, msg)
            case Snapshot():
                self._held_snapshot = msg
            case SyncBlocks():
                self._on_sync_blocks(sender, msg)
            case _:
                log.warning("node %d: dropping unknown message from %d: %r", self.id, sender, msg)

    def on_commit(self, block: Block) -> None:
        if block.height <= self.state.height:
            return
        self.state.apply_block(block)
        for fill in self.state.block_fills:
            self.trade_seq += 1
            self.trades.append(
                {
                    "seq": self.trade_seq,
                    "height": block.height,
                    "timestamp_ms": block.timestamp_ms,
                    "market": fill.market,
                    "side": fill.taker_side.value,
                    "price": fill.price,
                    "size": fill.size,
                }
            )
        self.mempool.remove_committed(block, self.state.nonce)
        self.committed.append(block)
        self.by_height[block.height] = block
        self.consensus.blocks[block.hash] = block
        if block.height % SNAPSHOT_EVERY == 0:
            self.latest_snapshot = Snapshot(block.height, self.state.to_bytes())
        if not self.catching_up:
            self.submit_prices()

    def preview_root(self, block: Block) -> Hash | None:
        """State root after `block`, replaying any committed-but-not-yet-applied parents."""
        saved = self.by_height.get(block.height)
        if block.height <= self.state.height:
            if saved is not None and saved.hash == block.hash:
                return block.state_root
            return None
        chain = self._chain_after(block)
        if chain is None:
            return None
        preview = State.from_bytes(self.state.to_bytes())
        for item in chain:
            if item.height != preview.height + 1:
                return None
            preview.apply_block(item)
        return preview.state_root()

    def _chain_after(self, block: Block) -> list[Block] | None:
        chain: list[Block] = []
        current: Block | None = block
        while current is not None and current.height > self.state.height:
            chain.append(current)
            if current.height == self.state.height + 1:
                break
            parent = self.consensus.blocks.get(current.parent)
            if parent is None:
                return None
            current = parent
        chain.reverse()
        if not chain or chain[0].height != self.state.height + 1:
            return None
        for index, item in enumerate(chain):
            if item.height != self.state.height + 1 + index:
                return None
        return chain

    def _on_proposal(self, msg: Proposal) -> None:
        block = msg.block
        # HotStuff proposes a block or two ahead of the commit. That is not a gap.
        if block.height > self.state.height + 1 and self._parent_unknown(block):
            self.catching_up = True
            self._buffer(block)
            self._request_sync(block.proposer)
            return
        if self.catching_up:
            if block.height > self.state.height:
                self._buffer(block)
            return
        self.mempool.mark_proposed(block.txs)
        self.consensus.on_proposal(msg)

    def _parent_unknown(self, block: Block) -> bool:
        if block.parent == GENESIS:
            return False
        if block.parent in self.consensus.blocks:
            return False
        return all(item.hash != block.parent for item in self.committed)

    def _buffer(self, block: Block) -> None:
        self.future[block.height] = block
        while len(self.future) > MAX_SYNC_BLOCKS:
            del self.future[max(self.future)]

    def _serve_sync(self, sender: NodeId, req: SyncRequest) -> None:
        if not self._allow_sync(sender):
            return
        if req.from_height < 1 or req.from_height > self.state.height:
            return
        limit = min(max(req.limit, 0), MAX_SYNC_BLOCKS)
        if limit == 0:
            return
        start = req.from_height
        behind = self.state.height - (req.from_height - 1)
        snap = self.latest_snapshot
        if (
            behind > SNAPSHOT_GAP
            and snap is not None
            and req.from_height <= snap.height < self.state.height
            and snap.height in self.by_height
        ):
            self.transport.send(sender, snap)
            start = snap.height
        blocks = self._page(start, limit)
        if blocks:
            self.transport.send(sender, SyncBlocks(blocks))

    def _page(self, start: int, limit: int) -> tuple[Block, ...]:
        chosen: list[Block] = []
        size = 0
        height = start
        while len(chosen) < limit and height <= self.state.height:
            block = self.by_height.get(height)
            if block is None:
                break
            weight = len(block.to_bytes())
            if chosen and size + weight > MAX_SYNC_BYTES:
                break
            chosen.append(block)
            size += weight
            height += 1
        return tuple(chosen)

    def _allow_sync(self, peer: NodeId) -> bool:
        tick = self._now_ms() // 1_000
        if tick != self._sync_tick:
            self._sync_tick = tick
            self._sync_used = {}
        used = self._sync_used.get(peer, 0)
        if used >= SYNC_PER_SECOND:
            return False
        self._sync_used[peer] = used + 1
        return True

    def _now_ms(self) -> int:
        now = getattr(self.transport, "now_ms", None)
        if not callable(now):
            return 0
        return int(now())

    def _on_sync_blocks(self, sender: NodeId, msg: SyncBlocks) -> None:
        blocks = msg.blocks
        if not blocks or not self._chain_ok(blocks):
            self._held_snapshot = None
            return
        if self._held_snapshot is not None and not self._apply_held_snapshot(blocks):
            self._held_snapshot = None
            return
        self._held_snapshot = None
        for block in blocks:
            if block.height <= self.state.height:
                self.by_height.setdefault(block.height, block)
                self.consensus.blocks.setdefault(block.hash, block)
                continue
            if not self._extends_tip(block) or not self._adopt(block):
                break
        self._drain_future()
        self._after_sync(sender, blocks)

    def _chain_ok(self, blocks: tuple[Block, ...]) -> bool:
        prev: Block | None = None
        for block in blocks:
            if block.qc.block_hash != block.parent or not self.consensus.verify_qc(block.qc):
                return False
            if prev is not None and (block.parent != prev.hash or block.height != prev.height + 1):
                return False
            prev = block
        return True

    def _apply_held_snapshot(self, blocks: tuple[Block, ...]) -> bool:
        snap = self._held_snapshot
        if snap is None:
            return True
        header = next((block for block in blocks if block.height == snap.height), None)
        if header is None:
            return False
        proof = next(
            (
                block.qc
                for block in blocks
                if block.qc.block_hash == header.hash and self.consensus.verify_qc(block.qc)
            ),
            None,
        )
        if proof is None:
            return False
        try:
            loaded = State.from_bytes(snap.state_bytes)
        except (ValueError, KeyError, TypeError):
            return False
        if loaded.height != snap.height or loaded.state_root() != header.state_root:
            return False
        if snap.height <= self.state.height:
            return True
        self.state = loaded
        self.by_height[header.height] = header
        self.consensus.blocks[header.hash] = header
        self.consensus.b_exec = header
        self.latest_snapshot = snap
        return True

    def _extends_tip(self, block: Block) -> bool:
        if self.state.height == 0:
            return block.height == 1 and block.parent == GENESIS
        tip = self.by_height.get(self.state.height)
        return tip is not None and block.parent == tip.hash and block.height == tip.height + 1

    def _adopt(self, block: Block) -> bool:
        if self.preview_root(block) != block.state_root:
            return False
        self.on_commit(block)
        self.consensus.b_exec = block
        self.consensus.view = max(self.consensus.view, block.view)
        return block.height <= self.state.height

    def _drain_future(self) -> None:
        self.future = {
            height: block for height, block in self.future.items() if height > self.state.height
        }
        while (block := self.future.get(self.state.height + 1)) is not None:
            if block.qc.block_hash != block.parent or not self.consensus.verify_qc(block.qc):
                break
            if not self._extends_tip(block) or not self._adopt(block):
                break
            del self.future[block.height]

    def _after_sync(self, sender: NodeId, blocks: tuple[Block, ...]) -> None:
        self._cancel_sync_timer()
        consumed = blocks[-1].height <= self.state.height
        ahead = any(height > self.state.height for height in self.future)
        # A full page, or a gap still sitting in the buffer, means the tip is higher.
        if (ahead and consumed) or (consumed and len(blocks) >= MAX_SYNC_BLOCKS):
            self._sync_tries = 0
            self._request_sync(sender)
            return
        if consumed:
            self._sync_tries = 0
            self.catching_up = False
            self._vote_tip()
            return
        self._arm_sync(sender, self.state.height)

    def _vote_tip(self) -> None:
        if any(height > self.state.height for height in self.future):
            return
        block = self.by_height.get(self.state.height)
        if block is None:
            return
        self.consensus.blocks[block.hash] = block
        self.consensus.b_exec = block
        self.consensus.view = max(self.consensus.view, block.view)
        self.consensus.update_high_qc(block.qc)
        if self.consensus.view == block.view:
            self.consensus._consider_vote(block)

    def _peers(self) -> list[NodeId]:
        return sorted(peer for peer in self.validator_pubkeys if peer != self.id)

    def _request_sync(self, peer: NodeId | None) -> None:
        peers = self._peers()
        if not peers:
            return
        if self._sync_token is not None and self._sync_mark == self.state.height:
            return
        if peer not in peers:
            peer = peers[self._rr % len(peers)]
        self._rr = (peers.index(peer) + 1) % len(peers)
        self._sync_tries += 1
        mark = self.state.height
        self._arm_sync(peer, mark)
        self.transport.send(peer, SyncRequest(mark + 1, MAX_SYNC_BLOCKS))

    def _arm_sync(self, peer: NodeId, mark: int) -> None:
        self._cancel_sync_timer()
        schedule = getattr(self.transport, "call_later", None)
        if not callable(schedule):
            return
        self._sync_mark = mark

        def fire(peer: NodeId = peer, mark: int = mark) -> None:
            self._sync_token = None
            if self.state.height != mark:
                self._sync_tries = 0
                self._request_sync(peer)
                return
            peers = self._peers()
            behind = self.catching_up or any(height > self.state.height for height in self.future)
            if not behind and self._sync_tries >= len(peers):
                return
            self._request_sync(self._other(peer))

        self._sync_token = schedule(SYNC_TIMEOUT, fire)

    def _other(self, peer: NodeId) -> NodeId:
        peers = self._peers()
        if peer not in peers:
            return peers[0]
        return peers[(peers.index(peer) + 1) % len(peers)]

    def _cancel_sync_timer(self) -> None:
        cancel = getattr(self.transport, "cancel", None)
        if self._sync_token is not None and callable(cancel):
            cancel(self._sync_token)
        self._sync_token = None

    def submit_prices(self) -> None:
        """Sign one oracle price into the mempool. State accepts one vote per validator per block."""
        if self.price_feed is None:
            return
        prices = self.price_feed()
        if not prices:
            return
        names = sorted(prices)
        market = names[self._oracle_i % len(names)]
        self._oracle_i += 1
        signer = public_key(self.private_key).hex()
        pending = [nonce for who, nonce in self.mempool.pending if who == signer]
        nonce = max([self.state.nonce(signer), *pending]) + 1
        body = SetOraclePrice(OraclePrice(market, prices[market], self.consensus.now_ms(), {}))
        self.submit(sign_tx(self.private_key, body, nonce))


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one tiny validator over TCP")
    parser.add_argument("--id", type=int, required=True)
    parser.add_argument("--config", required=True, help="cluster.json: validators and markets")
    parser.add_argument("--key-file", required=True, help="hex ed25519 private key for --id")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        markets, peers, pubs = _cluster(Path(args.config))
        private_key = _private_key(Path(args.key_file))
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc
    if args.id not in peers:
        raise SystemExit(f"validator {args.id} is not in the config")
    if public_key(private_key) != pubs[args.id]:
        raise SystemExit(f"key file does not match validator {args.id}")
    others = {i: addr for i, addr in peers.items() if i != args.id}
    transport = TcpTransport(args.id, others, peers[args.id])
    node = Node(args.id, len(peers), private_key, pubs, markets, transport)
    try:
        asyncio.run(_serve(node, transport))
    except KeyboardInterrupt:
        return


async def _serve(node: Node, transport: TcpTransport) -> None:
    await transport.serve()
    node.start()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    try:
        await stop.wait()
    finally:
        node.stop()
        await transport.close()


def _cluster(
    path: Path,
) -> tuple[list[Market], dict[NodeId, tuple[str, int]], dict[NodeId, bytes]]:
    raw = json.loads(path.read_text())
    if not isinstance(raw, dict):
        raise TypeError("config must be an object")
    markets = [_market(item) for item in _list(raw.get("markets"), "markets")]
    validators = [_validator(item) for item in _list(raw.get("validators"), "validators")]
    ids = [item[0] for item in validators]
    if sorted(ids) != list(range(len(ids))):
        raise ValueError("validator ids must be 0..n-1")
    peers = {node_id: (host, port) for node_id, host, port, _pub in validators}
    pubs = {node_id: pub for node_id, _host, _port, pub in validators}
    return markets, peers, pubs


def _validator(value: object) -> tuple[int, str, int, bytes]:
    raw = _obj(value, "validator")
    port = _int(raw.get("port"), "port")
    if not 0 < port < 65536:
        raise ValueError("port must be 1..65535")
    return (
        _int(raw.get("id"), "id"),
        _str(raw.get("host"), "host"),
        port,
        _hex32(raw.get("public_key"), "public_key"),
    )


def _market(value: object) -> Market:
    raw = _obj(value, "market")
    return Market(
        _str(raw.get("name"), "name"),
        _int(raw.get("tick_size"), "tick_size"),
        _int(raw.get("lot_size"), "lot_size"),
        _int(raw.get("max_leverage"), "max_leverage"),
        _int(raw.get("maintenance_margin_bps"), "maintenance_margin_bps"),
    )


def _private_key(path: Path) -> bytes:
    return _hex32(path.read_text().strip(), "private key")


def _obj(value: object, name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise TypeError(f"{name} must be an object")
    out: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise TypeError(f"{name} has a non-string key")
        out[key] = item
    return out


def _list(value: object, name: str) -> list[object]:
    if not isinstance(value, list):
        raise TypeError(f"{name} must be a list")
    return list(value)


def _int(value: object, name: str) -> int:
    if type(value) is not int:
        raise ValueError(f"{name} must be an int")
    return value


def _str(value: object, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a string")
    return value


def _hex32(value: object, name: str) -> bytes:
    if not isinstance(value, str):
        raise TypeError(f"{name} must be hex")
    try:
        raw = bytes.fromhex(value.strip())
    except ValueError as exc:
        raise ValueError(f"{name} must be hex") from exc
    if len(raw) != 32:
        raise ValueError(f"{name} must be 32 bytes")
    return raw


if __name__ == "__main__":
    main()
