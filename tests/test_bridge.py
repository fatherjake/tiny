"""A deposit credits the recipient once. A withdrawal debits them and queues the payout."""

from dataclasses import replace

from core.bridge import merkle_root, message_leaf
from core.node import public_key, sign, sign_tx
from core.state import State
from core.types import (
    BlockHeader,
    BridgeMessage,
    Deposit,
    Market,
    MessageProof,
    PostHeader,
    Withdraw,
    encode,
)
from sim.bridge import DEPOSIT_SENDER, ORACLE_KEY, RELAYER_KEY, FakeSourceChain, Oracle, Relayer
from tests.cluster import Cluster

MARKET = Market("BTC-PERP", tick_size=1, lot_size=1, max_leverage=10, maintenance_margin_bps=300)
TRADER = bytes(range(50, 82))
AMOUNT = 1_000_000
DEST = "0x" + "33" * 20
# sha256 of the packed leaf bytes. contracts/test/BridgeInbox.t.sol asserts the same hex.
LEAF0 = "c37a9f9a2c628abc2075812731e642f6aa5e5817583dbe607dad87cee7fe3241"
ROOT2 = "cb66821c5746b104715a85051aa66d1d5fb182b607cb4da46a609337cc11f38b"
ROOT3 = "0902f47722b3eebadd2321601e43ed78b15a85664eca7e427ca608e8bc6ef481"


def test_leaves_match_the_inbox_contract() -> None:
    first = BridgeMessage(1, 4, 0, DEPOSIT_SENDER, "22" * 32, 1_000_000)
    second = BridgeMessage(1, 4, 1, DEPOSIT_SENDER, "22" * 32, 2_000_000)
    third = BridgeMessage(1, 4, 2, DEPOSIT_SENDER, "22" * 32, 3_000_000)
    assert message_leaf(first).hex() == LEAF0
    assert merkle_root([message_leaf(first), message_leaf(second)]).hex() == ROOT2
    leaves = [message_leaf(first), message_leaf(second), message_leaf(third)]
    assert merkle_root(leaves).hex() == ROOT3


def test_deposit_credits_once_and_a_bad_proof_credits_nothing() -> None:
    who = public_key(TRADER).hex()
    header, sig, proofs = _seal([(who, AMOUNT)])
    state = State([MARKET])
    _apply(state, header, sig, proofs)
    assert state.accounts[who].collateral == AMOUNT
    state.apply_tx(sign_tx(RELAYER_KEY, Deposit(proofs[0]), 2), 0)
    assert state.accounts[who].collateral == AMOUNT

    missed = State([MARKET])
    missed.bridge.oracle_pubkey = public_key(ORACLE_KEY)
    missed.apply_tx(sign_tx(ORACLE_KEY, PostHeader(header, sig), 1), 0)
    bad = replace(proofs[0], siblings=(bytes(32),))
    missed.apply_tx(sign_tx(RELAYER_KEY, Deposit(bad), 1), 0)
    assert who not in missed.accounts


def test_header_needs_the_oracle_and_the_first_one_sticks() -> None:
    who = public_key(TRADER).hex()
    header, sig, proofs = _seal([(who, AMOUNT)])
    state = State([MARKET])
    state.bridge.oracle_pubkey = public_key(ORACLE_KEY)
    wrong = sign(bytes(range(90, 122)), encode(header))
    state.apply_tx(sign_tx(ORACLE_KEY, PostHeader(header, wrong), 1), 0)
    state.apply_tx(sign_tx(RELAYER_KEY, Deposit(proofs[0]), 1), 0)
    assert who not in state.accounts
    assert state.bridge.headers == {}

    state.apply_tx(sign_tx(ORACLE_KEY, PostHeader(header, sig), 2), 0)
    forged = replace(header, receipts_root=bytes(32))
    forged_sig = sign(ORACLE_KEY, encode(forged))
    state.apply_tx(sign_tx(ORACLE_KEY, PostHeader(forged, forged_sig), 3), 0)
    assert state.bridge.headers[(1, header.height)] == header
    state.apply_tx(sign_tx(RELAYER_KEY, Deposit(proofs[0]), 2), 0)
    assert state.accounts[who].collateral == AMOUNT


def test_three_deposits_in_one_seal_all_credit() -> None:
    keys = [bytes(range(start, start + 32)) for start in (10, 40, 70)]
    amounts = (10, 20, 30)
    pairs = [(public_key(key).hex(), amount) for key, amount in zip(keys, amounts, strict=True)]
    header, sig, proofs = _seal(pairs)
    state = State([MARKET])
    _apply(state, header, sig, proofs)
    assert [state.accounts[who].collateral for who, _amount in pairs] == [10, 20, 30]


def test_withdraw_pays_the_address_and_refuses_a_bad_one() -> None:
    who = public_key(TRADER).hex()
    header, sig, proofs = _seal([(who, AMOUNT)])
    state = State([MARKET])
    _apply(state, header, sig, proofs)
    state.apply_tx(sign_tx(TRADER, Withdraw(who, 400_000, 1, DEST), 1), 0)
    assert state.accounts[who].collateral == 600_000
    assert state.bridge.outbox == [BridgeMessage(1, 1, 1, who, DEST, 400_000)]
    state.apply_tx(sign_tx(TRADER, Withdraw(who, 1, 1, "dest"), 2), 0)
    assert state.accounts[who].collateral == 600_000
    assert len(state.bridge.outbox) == 1


def test_committed_deposit_and_withdraw_agree_across_the_cluster() -> None:
    who = public_key(TRADER).hex()
    header, sig, proofs = _seal([(who, AMOUNT)])
    cluster = Cluster(n=4, markets=[MARKET])
    for node in cluster.nodes:
        node.state.bridge.oracle_pubkey = public_key(ORACLE_KEY)
    assert cluster.nodes[0].submit(sign_tx(ORACLE_KEY, PostHeader(header, sig), 1))
    cluster.run_for(2_000)
    assert cluster.nodes[0].state.bridge.headers[(1, header.height)] == header
    assert cluster.nodes[0].submit(sign_tx(RELAYER_KEY, Deposit(proofs[0]), 1))
    cluster.run_for(2_000)
    assert {node.state.accounts[who].collateral for node in cluster.nodes} == {AMOUNT}
    assert cluster.nodes[0].submit(sign_tx(TRADER, Withdraw(who, 400_000, 1, DEST), 1))
    cluster.run_for(2_000)
    assert {node.state.accounts[who].collateral for node in cluster.nodes} == {600_000}
    outbox = cluster.nodes[0].state.bridge.outbox
    assert len(outbox) == 1
    assert outbox[0] == BridgeMessage(1, outbox[0].src_height, 1, who, DEST, 400_000)
    assert {tuple(node.state.bridge.outbox) for node in cluster.nodes} == {tuple(outbox)}
    assert len(cluster.state_roots()) == 1


def _seal(deposits: list[tuple[str, int]]) -> tuple[BlockHeader, bytes, list[MessageProof]]:
    chain = FakeSourceChain(1)
    for recipient, amount in deposits:
        chain.deposit(DEPOSIT_SENDER, recipient, amount)
    chain.mine()
    oracle = Oracle(ORACLE_KEY)
    header = oracle.poll(chain)[0]
    return header, oracle.sign_header(header), Relayer().poll(chain)


def _apply(state: State, header: BlockHeader, sig: bytes, proofs: list[MessageProof]) -> None:
    state.bridge.oracle_pubkey = public_key(ORACLE_KEY)
    state.apply_tx(sign_tx(ORACLE_KEY, PostHeader(header, sig), 1), 0)
    for nonce, proof in enumerate(proofs, start=1):
        state.apply_tx(sign_tx(RELAYER_KEY, Deposit(proof), nonce), 0)
