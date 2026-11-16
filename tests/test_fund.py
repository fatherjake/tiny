from core.node import public_key
from core.types import USDC_SCALE
from sim.__main__ import build
from sim.bridge import ORACLE_KEY, RELAYER_KEY
from sim.fund import deposit_txs

TRADER = "ab" * 32


def _fund(net, nodes, amount: int, stamp: int) -> None:
    node = nodes[0]
    post, deposit = deposit_txs(
        TRADER,
        amount,
        stamp,
        stamp,
        node.state.nonce(public_key(ORACLE_KEY).hex()) + 1,
        node.state.nonce(public_key(RELAYER_KEY).hex()) + 1,
    )
    assert node.submit(post)
    net.run_for(500)
    assert node.submit(deposit)
    net.run_for(500)


def test_a_running_chain_credits_a_deposit_on_every_validator() -> None:
    net, nodes, _funded = build(4, (0, 0), 0.0, seed=0, traders=2)
    net.run_for(500)
    _fund(net, nodes, 250 * USDC_SCALE, 1_000)
    assert [node.state.accounts[TRADER].collateral for node in nodes] == [250 * USDC_SCALE] * 4
    assert len({node.state.state_root() for node in nodes}) == 1


def test_funding_again_with_a_fresh_stamp_adds_to_the_balance() -> None:
    net, nodes, _funded = build(4, (0, 0), 0.0, seed=0, traders=0)
    net.run_for(500)
    _fund(net, nodes, 100 * USDC_SCALE, 1_000)
    _fund(net, nodes, 100 * USDC_SCALE, 2_000)
    assert nodes[0].state.accounts[TRADER].collateral == 200 * USDC_SCALE
