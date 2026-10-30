import pytest

from core.types import QC, Block, Market

MARKET = Market("BTC-PERP", tick_size=1, lot_size=1, max_leverage=10, maintenance_margin_bps=300)


def block(height: int, timestamp_ms: int = 0) -> Block:
    return Block(bytes(32), 0, height, QC(0, bytes(32), {}), (), timestamp_ms, height)


def test_apply_block_commits_the_next_height() -> None:
    from core.state import State

    state = State([MARKET])
    state.apply_block(block(1, timestamp_ms=1_000))
    assert state.height == 1
    state.apply_block(block(2, timestamp_ms=2_000))
    assert state.height == 2


def test_apply_block_rejects_a_gap_or_a_replay() -> None:
    from core.state import State

    state = State([MARKET])
    with pytest.raises(AssertionError):
        state.apply_block(block(2))
    state.apply_block(block(1))
    with pytest.raises(AssertionError):
        state.apply_block(block(1))
    assert state.height == 1
