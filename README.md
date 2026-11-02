# tiny

A teaching-sized Hyperliquid in Python. Each chain component is one file in `core/`, and no file there may reach 1,000 lines. The playground in `sim/` and the tests have no limit.

| File | What it is |
| --- | --- |
| `core/types.py` | Shared data types only, no logic |
| `core/consensus.py` | Chained HotStuff consensus engine and pacemaker |
| `core/__main__.py` | Process entry for one validator over TCP (`python -m core`) |
| `core/node.py` | One validator: keys, mempool, consensus, state, price submissions |
| `core/net.py` | The `Transport` interface and TCP |
| `core/state.py` | Deterministic state machine: accounts, positions, oracle prices, funding, liquidations |
| `core/book.py` | Price-time priority order book |
| `core/bridge.py` | On-chain side of a LayerZero v1 style bridge: stores oracle-posted headers, verifies relayer Merkle proofs |
| `core/store.py` | Block log and query indexes for trades, orders and funding |
| `core/api.py` | REST and WebSocket API |
| `ui/` | Trading UI (Vite, TypeScript, React). `npm run dev` proxies the API |
| `sim/` | Playground: a whole cluster in one process with bots (`bots.py`), a fake price feed (`feed.py`), an in-memory network with faults (`net.py`), the bridge's source chain, oracle and relayer (`bridge.py`) and the API |

Consensus only orders transactions. Every validator applies committed blocks to `State` and must get the same result, so the state machine uses integers only, block timestamps instead of the clock, and no randomness.

```
uv sync
uv run pytest
cd ui && npm install && npm test && npm run build
uv run python -m sim --validators 4
uv run python -m core --id 0 --config cluster.json --key-file key.hex
```

`npm run dev` in `ui/` reloads the UI and proxies the API on port 8000.

Fault scenarios (crashes, partitions, lossy links) are pytest cases in `tests/test_faults.py`. They are marked xfail until the components are built.

Always run from the repo root. One validator is `python -m core`. A component module is `python -m core.<name>`, and the playground is `python -m sim`. Running a file directly puts `core/` on the path and `types.py` shadows the standard library.

## Persistence

Each commit appends the block and the events from applying it. The sim keeps that in a `MemoryStore`. A validator keeps it in SQLite when given `--db`:

```
uv run python -m core --id 0 --config cluster.json --key-file key.hex --db tiny.sqlite
```

The file has the block log plus three query tables, written in the same transaction:

| Table | Rows |
| --- | --- |
| `fills` | trades, indexed by `(market, height)` and by taker and maker |
| `orders` | one row per order id, upserted as it is placed, filled, partially filled, cancelled or rejected |
| `funding` | the funding index and the rate added at that height |

Candles (`1m`, `5m`, `1h`) are a query that buckets `fills` by timestamp. They are not stored.

Consensus does not read these tables, and they are not part of `state_root`. `SqliteStore.rebuild_indexes()` drops them and replays the block log through a fresh `State`. An order id is the primary key, so reusing an id replaces the old row. A snapshot that skips blocks is not in the log, so a rebuild cannot see those blocks.

The history routes read the store on their own connection: `GET /trades/{market}`, `/accounts/{addr}/fills`, `/accounts/{addr}/orders?status=open|history`, `/candles/{market}?interval=1m|5m|1h` and `/funding/{market}`.

## Networking notes

Validator-to-validator messaging in `core/net.py` is plain TCP with length-prefixed JSON frames. It is not encrypted, and the `Hello` handshake is not authenticated: a peer is trusted to be whichever node id it claims. Safety rests on signatures above the transport (signed txs, validator-signed votes and QCs), so a fake peer cannot forge blocks, but it can read traffic, spam, or take a node's connection slot.

If we ever need it, two upgrades fit behind the `Transport` interface without touching consensus or state: sign the `Hello` (each side signs a fresh challenge with its validator key) to stop impersonation, and wrap the streams in TLS or a Noise handshake (as libp2p does) for encryption.

Agent setup (skills, MCP) comes from [agent-boilerplate-v2](https://github.com/fatherjake/agent-boilerplate-v2); see `.agents/BOILERPLATE.md`.
