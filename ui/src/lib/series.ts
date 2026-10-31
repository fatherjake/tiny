import type { Depth, Scaled, Series } from "../types";
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
    pct = (milli / 1000n).toString() + "." + (milli % 1000n).toString().padStart(3, "0") + "%";
  }
  return { spread, mid, pct };
}

type PriceSource = {
  mark_price?: Scaled | null;
  best_bid?: Scaled | null;
  best_ask?: Scaled | null;
  oracle_price?: Scaled | null;
};

function priceOf(src: PriceSource | null | undefined): Scaled | null {
  if (!src) return null;
  if (src.mark_price != null) return src.mark_price;
  if (src.best_bid != null && src.best_ask != null) return (bi(src.best_bid) + bi(src.best_ask)) / 2n;
  return src.best_bid ?? src.best_ask ?? src.oracle_price ?? null;
}

function lastOf<T>(rows: T[]): T | undefined {
  return rows.length === 0 ? undefined : rows[rows.length - 1];
}

function note(book: Series, price: Scaled, at?: Scaled | null): Series {
  const value = Number(bi(price)) / 1e6;
  const sec = book.sec ?? [];
  const lastS = lastOf(sec);
  const offset = book.offset;
  if (at != null && offset == null) return book;
  const stamped =
    at != null && offset != null && Number(at) > 0 ? Math.floor(Number(at) / 1000) + offset : null;
  const time = stamped == null ? (lastS ? lastS.time : null) : stamped;
  if (time == null || (lastS && time < lastS.time)) return book;
  const nextSec = (lastS && lastS.time === time ? sec.slice(0, -1) : sec)
    .concat([{ time, value }])
    .slice(-180);
  const minute = time - (time % 60);
  const bars = book.bars ?? [];
  const lastB = lastOf(bars);
  if (lastB && minute < lastB.time) return { ...book, sec: nextSec };
  const bar =
    !lastB || lastB.time !== minute
      ? { time: minute, open: value, high: value, low: value, close: value }
      : {
          ...lastB,
          high: Math.max(lastB.high, value),
          low: Math.min(lastB.low, value),
          close: value,
        };
  const nextBars = (lastB && lastB.time === minute ? bars.slice(0, -1) : bars)
    .concat([bar])
    .slice(-60);
  return { offset, sec: nextSec, bars: nextBars };
}

type SeedRow = { timestamp_ms?: Scaled | null; price?: Scaled | null };

export function seed(book: Series, rows: SeedRow[]): Series {
  let max = 0;
  for (const row of rows) if (Number(row.timestamp_ms) > max) max = Number(row.timestamp_ms);
  // Chain time starts at the sim clock. Shift it onto the wall clock so the axis reads as now.
  let next =
    book.offset != null
      ? book
      : {
          ...book,
          offset: max > 0 ? Math.floor(Date.now() / 1000) - Math.floor(max / 1000) : 0,
        };
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.price != null) next = note(next, row.price, row.timestamp_ms);
  }
  return next;
}

export function remember(
  series: Record<string, Series>,
  market: string,
  src: PriceSource,
): Record<string, Series> {
  const price = priceOf(src);
  if (price == null) return series;
  return { ...series, [market]: note(series[market] || {}, price) };
}

export function rememberPrint(
  series: Record<string, Series>,
  market: string,
  trade: { price?: Scaled | null; timestamp_ms?: Scaled | null },
): Record<string, Series> {
  if (trade.price == null) return series;
  return { ...series, [market]: note(series[market] || {}, trade.price, trade.timestamp_ms) };
}
