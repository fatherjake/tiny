from dataclasses import replace

from core.net import Handler
from core.node import Mempool, Node, public_key, sign_tx, verify_tx
from core.types import QC, Account, Block, CancelOrder, Market, NodeId, Tx

KEY_A = bytes(range(32))
KEY_B = bytes(range(1, 33))
MARKET = Market("BTC-PERP", tick_size=1, lot_size=1, max_leverage=10, maintenance_margin_bps=300)


def cancel(nonce: int, key: bytes = KEY_A) -> Tx:
    return sign_tx(key, CancelOrder("alice", "BTC-PERP", 1), nonce)


def block_of(*txs: Tx) -> Block:
    return Block(bytes(32), 0, 1, QC(0, bytes(32), {}), txs, 0, 1)


class FakeTransport:
    def __init__(self) -> None:
        self.broadcasts: list[object] = []

    def send(self, to: NodeId, msg: object) -> None:
        pass

    def broadcast(self, msg: object) -> None:
        self.broadcasts.append(msg)

    def on_message(self, handler: Handler) -> None:
        pass


def make_node() -> tuple[Node, FakeTransport]:
    transport = FakeTransport()
    return Node(0, 4, KEY_B, {}, [MARKET], transport), transport


def test_node_state_includes_its_own_validator_key() -> None:
    node, _transport = make_node()
    assert node.state.validators == {public_key(KEY_B).hex()}


def test_signatures() -> None:
    tx = cancel(1)
    assert verify_tx(tx)
    assert not verify_tx(replace(tx, nonce=2))
    assert not verify_tx(replace(tx, signer=cancel(1, KEY_B).signer))
    assert not verify_tx(replace(tx, signer="not hex"))
    assert not verify_tx(replace(tx, signer="abcd"))


def test_block_hash_is_stable_and_covers_txs() -> None:
    assert block_of(cancel(1)).hash == block_of(cancel(1)).hash
    assert block_of(cancel(1)).hash != block_of(cancel(2)).hash


def test_submit_accepts_and_gossips_once() -> None:
    node, transport = make_node()
    tx = cancel(1)
    assert node.submit(tx)
    assert not node.submit(tx)  # duplicate
    assert transport.broadcasts == [tx]


def test_submit_rejects_bad_sig_and_nonces_outside_the_window() -> None:
    node, transport = make_node()
    assert not node.submit(replace(cancel(1), sig=bytes(64)))
    assert not node.submit(cancel(0))
    node.state.accounts[cancel(1).signer] = Account("alice", nonce=3)
    assert not node.submit(cancel(3))  # used
    assert not node.submit(cancel(20))  # more than 16 ahead
    assert node.submit(cancel(4))
    assert node.submit(cancel(19))  # queued behind a gap is fine
    assert len(transport.broadcasts) == 2


def test_gossiped_tx_is_not_rebroadcast() -> None:
    node, transport = make_node()
    node.on_message(1, cancel(1))
    assert len(node.mempool.pending) == 1
    assert transport.broadcasts == []


def test_take_orders_caps_and_skips_proposed() -> None:
    pool = Mempool(max_block_txs=2)
    for tx in [cancel(3), cancel(1), cancel(2)]:
        pool.add(tx)
    assert [tx.nonce for tx in pool.take()] == [1, 2]
    assert [tx.nonce for tx in pool.take()] == [3]
    assert pool.take() == []


def test_remove_committed_drops_used_nonces_and_retries_abandoned() -> None:
    pool = Mempool(retry_after=1)
    for tx in [cancel(1), cancel(2), cancel(5)]:
        pool.add(tx)
    pool.take()  # all three proposed in a block that will never commit
    pool.remove_committed(block_of(cancel(1)), lambda signer: 2)
    assert list(pool.pending) == [(cancel(5).signer, 5)]
    assert pool.take() == []  # still proposed
    pool.remove_committed(block_of(), lambda signer: 2)
    assert [tx.nonce for tx in pool.take()] == [5]


def test_tx_stuck_behind_a_gap_ages_out() -> None:
    pool = Mempool(max_age=2)
    pool.add(cancel(5))
    pool.remove_committed(block_of(), lambda signer: 0)
    pool.remove_committed(block_of(), lambda signer: 0)
    assert len(pool.pending) == 1
    pool.remove_committed(block_of(), lambda signer: 0)
    assert pool.pending == {}
    assert pool.arrived == {}
