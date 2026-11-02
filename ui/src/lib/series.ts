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

function lastOf<T>(rows: T[]): T | undefined {
  return rows.length === 0 ? undefined : rows[rows.length - 1];
}

function noteBlock(book: Series, price: Scaled, height: number): Series {
  const ticks = book.ticks ?? [];
  const last = lastOf(ticks);
  if (last && height < last.time) return book;
  const value = Number(bi(price)) / 1e6;
  const next = (last && last.time === height ? ticks.slice(0, -1) : ticks).concat([
    { time: height, value },
  ]);
  return { ...book, ticks: next };
}

export type CandleRow = {
  ts: Scaled;
  open: Scaled;
  high: Scaled;
  low: Scaled;
  close: Scaled;
};

export function applyCandles(book: Series, rows: CandleRow[]): Series {
  const ordered = [...rows].sort((a, b) => Number(a.ts) - Number(b.ts));
  const latest = lastOf(ordered);
  const offset =
    book.offset != null
      ? book.offset
      : latest != null
        ? Math.floor(Date.now() / 1000) - Math.floor(Number(latest.ts) / 1000)
        : null;
  const bars: NonNullable<Series["bars"]> = [];
  for (const row of ordered) {
    const time = Math.floor(Number(row.ts) / 1000) + (offset ?? 0);
    const bar = {
      time,
      open: Number(bi(row.open)) / 1e6,
      high: Number(bi(row.high)) / 1e6,
      low: Number(bi(row.low)) / 1e6,
      close: Number(bi(row.close)) / 1e6,
    };
    const last = lastOf(bars);
    if (last && time < last.time) continue;
    if (last && time === last.time) bars[bars.length - 1] = bar;
    else bars.push(bar);
  }
  return { ...book, offset: offset ?? book.offset, bars };
}

type SeedRow = { height: number; price?: Scaled | null };

export function seed(book: Series, rows: SeedRow[]): Series {
  let next = book;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.price != null) next = noteBlock(next, row.price, row.height);
  }
  return next;
}

export function rememberPrint(
  series: Record<string, Series>,
  market: string,
  trade: { price?: Scaled | null; height?: number },
): Record<string, Series> {
  if (trade.price == null || trade.height == null) return series;
  return { ...series, [market]: noteBlock(series[market] || {}, trade.price, trade.height) };
}
