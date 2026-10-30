# tiny

A teaching-sized Hyperliquid in Python. Each component is one file, and no file may reach 1,000 lines.

| File | What it is |
| --- | --- |
| `tiny/types.py` | Shared data types only, no logic |
| `tiny/consensus.py` | Chained HotStuff validators and pacemaker |
| `tiny/state.py` | Deterministic state machine: accounts, positions, funding, liquidations |
| `tiny/book.py` | Price-time priority order book |
| `tiny/oracle.py` | Price oracle submissions and median |
| `tiny/bridge.py` | LayerZero v1 style bridge: oracle posts headers, relayer posts Merkle proofs |
| `tiny/api.py` | REST and WebSocket API |
| `tiny/ui.html` | Single-page trading UI |
| `tiny/sim.py` | Runs a cluster with bots, faults and the API |

Consensus only orders transactions. Every validator applies committed blocks to `State` and must get the same result, so the state machine uses integers only, block timestamps instead of the clock, and no randomness.

```
uv sync
uv run pytest
uv run python -m tiny.sim --validators 4
```

Always run modules with `python -m tiny.<name>`. Running a file directly puts `tiny/` on the path and `types.py` shadows the standard library.

Agent setup (skills, MCP) comes from [agent-boilerplate-v2](https://github.com/fatherjake/agent-boilerplate-v2); see `.agents/BOILERPLATE.md`.
