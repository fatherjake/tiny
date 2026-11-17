import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { foldTrades, spreadMid, toBars, type CandleRow } from "./series";

describe("toBars", () => {
  it("builds open high low close in time order, at the block time", () => {
    const next = toBars([
      {
        ts: 1_700_000_060_000,
        open: 2_000_000,
        high: 4_000_000,
        low: 1_000_000,
        close: 3_000_000,
      },
      {
        ts: 1_700_000_000_000,
        open: 1_000_000,
        high: 1_000_000,
        low: 1_000_000,
        close: 1_000_000,
      },
    ]);
    expect(next).toEqual([
      { time: 1_700_000_000, open: 1, high: 1, low: 1, close: 1 },
      { time: 1_700_000_060, open: 2, high: 4, low: 1, close: 3 },
    ]);
  });

  it("keeps each second as its own candle", () => {
    const next = toBars([
      {
        ts: 1_700_000_000_000,
        open: 1_000_000,
        high: 1_000_000,
        low: 1_000_000,
        close: 1_000_000,
      },
      {
        ts: 1_700_000_001_000,
        open: 2_000_000,
        high: 3_000_000,
        low: 2_000_000,
        close: 3_000_000,
      },
    ]);
    expect(next.map((bar) => bar.time)).toEqual([1_700_000_000, 1_700_000_001]);
  });

  it("is empty for no rows", () => {
    expect(toBars([])).toEqual([]);
  });
});

describe("foldTrades", () => {
  const bars = [{ time: 120, open: 1, high: 1, low: 1, close: 1 }];

  it("keeps the same array when every trade is older than the last bar", () => {
    expect(
      foldTrades(bars, [{ timestamp_ms: 60_000, price: 9_000_000 }], 60_000),
    ).toBe(bars);
  });

  it("updates the last bar and opens new ones in order", () => {
    expect(
      foldTrades(
        bars,
        [
          { timestamp_ms: 150_000, price: 3_000_000 },
          { timestamp_ms: 170_000, price: 500_000 },
          { timestamp_ms: 185_000, price: 2_000_000 },
        ],
        60_000,
      ),
    ).toEqual([
      { time: 120, open: 1, high: 3, low: 0.5, close: 0.5 },
      { time: 180, open: 2, high: 2, low: 2, close: 2 },
    ]);
    expect(bars[0].close).toBe(1);
  });
});

describe("spreadMid", () => {
  it("gives the spread, the mid and the spread as a percent of the mid", () => {
    expect(spreadMid({ best_bid: 99_000_000n, best_ask: "101000000" })).toEqual(
      { spread: 2_000_000n, mid: 100_000_000n, pct: "2.000%" },
    );
    expect(
      spreadMid({ best_bid: 60_000_000_000, best_ask: 60_001_000_000 }),
    ).toEqual({
      spread: 1_000_000n,
      mid: 60_000_500_000n,
      pct: "0.001%",
    });
  });

  it("has no percent when the mid is not positive", () => {
    expect(spreadMid({ best_bid: 0, best_ask: 1 })).toEqual({
      spread: 1n,
      mid: 0n,
      pct: "-",
    });
  });

  it("is empty without both sides of the book", () => {
    const empty = { spread: null, mid: null, pct: "-" };
    expect(spreadMid(null)).toEqual(empty);
    expect(spreadMid(undefined)).toEqual(empty);
    expect(spreadMid({ best_ask: 1n })).toEqual(empty);
    expect(spreadMid({ best_bid: 1n, best_ask: null })).toEqual(empty);
  });
});

const candle = fc.record({
  ts: fc.integer({ min: 0, max: 600_000 }),
  open: fc.integer({ min: 0, max: 10 ** 12 }),
  high: fc.integer({ min: 0, max: 10 ** 12 }),
  low: fc.integer({ min: 0, max: 10 ** 12 }),
  close: fc.integer({ min: 0, max: 10 ** 12 }),
});

function candleModel(rows: CandleRow[]) {
  const bySecond = new Map<number, CandleRow>();
  for (const row of [...rows].sort((a, b) => Number(a.ts) - Number(b.ts))) {
    bySecond.set(Math.floor(Number(row.ts) / 1000), row);
  }
  return [...bySecond.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, row]) => ({
      time,
      open: Number(row.open) / 1e6,
      high: Number(row.high) / 1e6,
      low: Number(row.low) / 1e6,
      close: Number(row.close) / 1e6,
    }));
}

describe("series properties", () => {
  it("builds one bar per second from the latest row in that second", () => {
    fc.assert(
      fc.property(fc.array(candle, { minLength: 1 }), (rows) => {
        expect(toBars(rows)).toEqual(candleModel(rows));
      }),
    );
  });
});
