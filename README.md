# tiny

A teaching-sized Hyperliquid in Python. Each chain component is one file in `core/`, and no file there may reach 1,000 lines. The playground in `sim/` and the tests have no limit.

| File | What it is |
| --- | --- |
| `core/types.py` | Shared data types only, no logic |
| `core/consensus.py` | Chained HotStuff consensus engine and pacemaker |
| `core/node.py` | One validator: keys, mempool, consensus, state, price submissions |
| `core/net.py` | The `Transport` interface and TCP |
| `core/state.py` | Deterministic state machine: accounts, positions, oracle prices, funding, liquidations |
| `core/book.py` | Price-time priority order book |
| `core/bridge.py` | On-chain side of a LayerZero v1 style bridge: stores oracle-posted headers, verifies relayer Merkle proofs |
| `core/api.py` | REST and WebSocket API |
| `ui/` | Trading UI (Vite, TypeScript, React). `npm run dev` proxies the API |
| `sim/` | Playground: a whole cluster in one process with bots (`bots.py`), a fake price feed (`feed.py`), an in-memory network with faults (`net.py`), the bridge's source chain, oracle and relayer (`bridge.py`) and the API |

Consensus only orders transactions. Every validator applies committed blocks to `State` and must get the same result, so the state machine uses integers only, block timestamps instead of the clock, and no randomness.

```
uv sync
uv run pytest
cd ui && npm install && npm test && npm run build
uv run python -m sim --validators 4
```

`npm run dev` in `ui/` reloads the UI and proxies the API on port 8000.

Fault scenarios (crashes, partitions, lossy links) are pytest cases in `tests/test_faults.py`. They are marked xfail until the components are built.

Always run modules from the repo root with `python -m core.<name>` or `python -m sim`. Running a file directly puts `core/` on the path and `types.py` shadows the standard library.

Agent setup (skills, MCP) comes from [agent-boilerplate-v2](https://github.com/fatherjake/agent-boilerplate-v2); see `.agents/BOILERPLATE.md`.
