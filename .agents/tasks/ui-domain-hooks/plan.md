---
status: in-progress
slug: ui-domain-hooks
created: 2026-11-14
targets: [ui]
tickets: []
---

# Split UI domain hooks

## Goal

Move the trading UI's live-market, wallet-session, account, and transaction concerns out of
`App.tsx` without changing the rendered workflow. Ensure the order preview uses the same market
order margin price as the chain.

## Exit condition

`cd ui && npm test && npm run build` pass, and the local simulator's history API passes
`verify-tiny` evidence checks.

## Context

`ui/src/App.tsx` currently owns polling, WebSocket messages, wallet-derived keys, account reads,
and transaction submission. `ui/src/components/OrderForm.tsx` independently derives the order
preview. `core/state.py` is the authoritative margin calculation.

## Units

### 1. Order preview is a tested pure domain function

- **Change:** Extract preview and validation calculations from `OrderForm` into `ui/src/lib/orders.ts`,
  and price market-order margin at the submitted cap.
- **Check:** Add focused Vitest cases for the preview, including a buy whose cap requires more margin
  than its touch price.
- **Depends on:** None.

### 2. Live market and wallet session have focused hooks

- **Change:** Move market/stream/history loading into `useMarketData`, and wallet signing/key reset
  into `useTraderSession`; migrate `App` in the same change.
- **Check:** `cd ui && npm test && npm run build`.
- **Depends on:** 1.

### 3. Account polling and transaction actions have focused hooks

- **Change:** Move account/history polling into `useTradingAccount`, and order IDs, nonces,
  submission, cancellation, and close actions into `useOrderActions`; leave `App` as composition.
- **Check:** `cd ui && npm test && npm run build`.
- **Depends on:** 2.

### 4. Refactored UI is verified against the simulator

- **Change:** Run the UI's full static checks and the sim/history verification surface; record the
  final task state.
- **Check:** `uv run pytest`, UI tests/build, and the `verify-tiny` API evidence.
- **Depends on:** 3.

## Risks and unknowns

Polling and WebSocket timing can regress while moving effects. Keep the existing request cadence
and cleanup semantics, then prove the same API paths against a simulator. No deploys, migrations,
or external writes are involved.

## Out of scope

Changing the server API, adding a state-management library, changing wallet providers, or adding
custom leverage controls.
