# History

The dock and the chart read committed trades, orders, fills, candles, and funding from the store.

## Sub-features

- Recent trades for BTC-PERP.
- 1m candles for the chart.
- Funding samples.
- A trader's open orders, order history, and fills.

## How to get to it (user POV)

Start the sim, open the UI, pick BTC-PERP. The tape is the Trades tab on the ladder. The chart's 1m button shows candles. The bottom dock has orders, fills, history, and funding.

## Driving it with curl

See the parent skill. `GET /trades/BTC-PERP?limit=2` is the check that does not need a key. The first object is the newest trade.

## Gotchas

The sim clock is not the wall clock. Candle `ts` is milliseconds. The UI adds an offset before drawing. An empty market returns `[]`. `status` on orders is `open` or `history`.
