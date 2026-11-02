---
status: in-progress
slug: api-indexes
created: 2026-11-02
targets: [core, ui, tests]
tickets: []
---

# API index tables

## Goal

The UI can show trade history, order history, candles and funding from query tables. Consensus still hashes only the state machine. The tables can be dropped and rebuilt from the block log.

## Exit condition

`uv run pytest` passes, including event capture, an unchanged state root, `rebuild_indexes()` parity, API pagination on the sim's MemoryStore, and history that survives reopening a SqliteStore.

## Context

This branch had no `core/store.py`. The block log and the index tables live together in the store so a commit writes both in one transaction. `core/types.py` already has the book match; that type is `Match`. The log record is `Fill`. Order events also carry side, type, price and size, because a liquidation order is not a transaction and the orders table cannot be filled from the block alone.

`preview_root` applies a copy with `record_events` off. Only `Node.on_commit` appends to the store.

Files: `core/types.py`, `core/state.py`, `core/book.py`, `core/node.py`, `core/store.py`, `core/api.py`, `ui/src/`, `README.md`.

## Units

### 1. Committed blocks emit fills, order events and funding events

- **Change:** dataclasses in `types.py`. `State.apply_block` appends them to a side list. Previews do not record.
- **Check:** `uv run pytest tests/test_events.py` and the existing state tests. Roots and `to_bytes` match with recording on and off.
- **Depends on:** none.

### 2. Index tables commit with the block and can be rebuilt

- **Change:** `SqliteStore` and `MemoryStore` append the block and the events in one transaction. `rebuild_indexes()` drops the index tables and replays the log through a fresh `State`.
- **Check:** `uv run pytest tests/test_store.py` — rebuild rows equal live rows.
- **Depends on:** 1.

### 3. The API reads history without the node lock

- **Change:** store read methods and REST routes. MemoryStore serves the sim.
- **Check:** `uv run pytest tests/test_api.py tests/test_sim.py`.
- **Depends on:** 2.

### 4. The UI shows the new history

- **Change:** trades tape, open orders, order history, fills, candles, funding. Existing styling.
- **Check:** `cd ui && npm test && npm run build`.
- **Depends on:** 3.

### 5. Restart, pagination and the README

- **Change:** API pagination and a SqliteStore reopen test. Persistence section in the README.
- **Check:** `uv run pytest` and `uv run ruff check . && uv run ruff format --check . && uv run python scripts/check_loc.py`.
- **Depends on:** 4.

## Risks and unknowns

Order ids are the primary key, as specified. A reused id overwrites the old row. Bots already allocate ids from disjoint ranges.

A snapshot sync that skips blocks will not have those blocks in the log, so a rebuild cannot see them. Normal commit and catch-up that applies every block are covered.

Nothing here is irreversible.

## Out of scope

Consensus reads of the indexes. A materialised candle table. Encrypting validator TCP. Pushing the branch.
