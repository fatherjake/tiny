import type { Candle, Depth, Scaled } from "../types";
import { bi } from "./scale";

export type Spread = { spread: bigint | null; mid: bigint | null; pct: string };

export function spreadMid(book: Depth | null | undefined): Spread {
  if (book == null || book.best_bid == null || book.best_ask == null) {
    return { spread: null, mid: null, pct: "-" };
  }
  const bid = bi(book.best_bid);
  const ask = bi(book.best_ask);
  const mid = (bid + ask) / 2n;
  const spread = ask - bid;
  let pct = "-";
  if (mid > 0n) {
    const milli = (spread * 100000n) / mid;
    pct =
      (milli / 1000n).toString() +
      "." +
      (milli % 1000n).toString().padStart(3, "0") +
      "%";
  }
  return { spread, mid, pct };
}

function lastOf<T>(rows: T[]): T | undefined {
  return rows.length === 0 ? undefined : rows[rows.length - 1];
}

export type CandleRow = {
  ts: Scaled;
  open: Scaled;
  high: Scaled;
  low: Scaled;
  close: Scaled;
};

export function toBars(rows: CandleRow[]): Candle[] {
  const bars: Candle[] = [];
  for (const row of [...rows].sort((a, b) => Number(a.ts) - Number(b.ts))) {
    const bar = {
      time: Math.floor(Number(row.ts) / 1000),
      open: Number(bi(row.open)) / 1e6,
      high: Number(bi(row.high)) / 1e6,
      low: Number(bi(row.low)) / 1e6,
      close: Number(bi(row.close)) / 1e6,
    };
    const last = lastOf(bars);
    if (last && bar.time === last.time) bars[bars.length - 1] = bar;
    else bars.push(bar);
  }
  return bars;
}

type Print = { timestamp_ms: number; price: Scaled };

export function foldTrades(
  bars: Candle[],
  trades: Print[],
  width: number,
): Candle[] {
  let next: Candle[] | null = null;
  for (const trade of trades) {
    const time = (Math.floor(trade.timestamp_ms / width) * width) / 1000;
    const price = Number(bi(trade.price)) / 1e6;
    const last = lastOf(next ?? bars);
    if (last && time < last.time) continue;
    next ??= [...bars];
    if (last && time === last.time) {
      next[next.length - 1] = {
        ...last,
        high: Math.max(last.high, price),
        low: Math.min(last.low, price),
        close: price,
      };
    } else {
      next.push({ time, open: price, high: price, low: price, close: price });
    }
  }
  return next ?? bars;
}
