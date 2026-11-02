---
name: verify-tiny
description: Drive tiny's sim and history API the way the trading UI does. Use after a change to trades, orders, candles, funding, or the sim server.
---

# Verify tiny

The surface is the sim on one machine: a Vite UI in `ui/` and the FastAPI process from `python -m sim`. History is proven over HTTP. The UI buttons are the dock tabs `positions`, `orders`, `fills`, `history`, `funding`, `trades`, and `blocks`.

## Launch

From the repo root, on a free port:

```
uv run python -m sim --validators 4 --bots 2 --api-port 8765
```

Ready when the log contains `Uvicorn running on http://127.0.0.1:8765`. Record the pid. The UI dev server is separate: `npm run dev` in `ui/` proxies port 8000, so point it at 8765 only if you started the API there.

## Doctor

```
curl -sf http://127.0.0.1:8765/status
```

A JSON object with `height` greater than 0 means this instance is committing. If the connection is refused, it is not running.

## Drive

History routes, newest first. An unknown market or trader is an empty list, not an error.

```
curl -sf http://127.0.0.1:8765/trades/BTC-PERP?limit=2
curl -sf http://127.0.0.1:8765/candles/BTC-PERP?interval=1m
curl -sf http://127.0.0.1:8765/funding/BTC-PERP?limit=5
```

With a trader public key from the sim log (`funded <hex>`):

```
curl -sf http://127.0.0.1:8765/accounts/<hex>/orders?status=open
curl -sf http://127.0.0.1:8765/accounts/<hex>/orders?status=history\&limit=5
curl -sf http://127.0.0.1:8765/accounts/<hex>/fills?limit=5
```

Page trades with `before_height`, `before_tx`, and `before_id` taken from the last row of the previous page. Page orders with `before_height` and `before_order`.

## Evidence

Write response bodies to `.qa/verify-tiny/`. That directory is gitignored. A proof is the status height plus one non-empty `/trades/BTC-PERP` body whose first object has `market`, `price`, `size`, `side`, and `ts`. Pytest (`uv run pytest`) is the deterministic check for the same routes.

## Cleanup

Kill the pid you started. Do not kill by process name. Leave `.qa/verify-tiny/` in place.
