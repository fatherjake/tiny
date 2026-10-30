# tiny

A teaching-sized Hyperliquid in Python. Each component is one file, and no file may reach 1,000 lines.

| File | What it is |
| --- | --- |
| `core/types.py` | Shared data types only, no logic |
| `core/consensus.py` | Chained HotStuff replica and pacemaker |
| `core/node.py` | One validator: keys, mempool, replica, state, price submissions |
| `core/net.py` | Transports: in-memory network with faults, and TCP |
| `core/state.py` | Deterministic state machine: accounts, positions, oracle prices, funding, liquidations |
| `core/book.py` | Price-time priority order book |
| `core/bridge.py` | LayerZero v1 style bridge: oracle posts headers, relayer posts Merkle proofs |
| `core/api.py` | REST and WebSocket API |
| `core/ui.html` | Single-page trading UI |
| `sim/` | Playground: a whole cluster in one process with bots (`bots.py`), a fake price feed (`feed.py`) and the API |

Consensus only orders transactions. Every validator applies committed blocks to `State` and must get the same result, so the state machine uses integers only, block timestamps instead of the clock, and no randomness.

```
uv sync
uv run pytest
uv run python -m sim --validators 4
```

Fault scenarios (crashes, partitions, lossy links) are pytest cases in `tests/test_faults.py`. They are marked xfail until the components are built.

Always run modules from the repo root with `python -m core.<name>` or `python -m sim`. Running a file directly puts `core/` on the path and `types.py` shadows the standard library.

Agent setup (skills, MCP) comes from [agent-boilerplate-v2](https://github.com/fatherjake/agent-boilerplate-v2); see `.agents/BOILERPLATE.md`.
